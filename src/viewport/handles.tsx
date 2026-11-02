// A tiny manipulator system for on-canvas handles (resize squares, drag arrows, the part body).
// It listens in the capture phase, so a press on a handle never reaches the camera controls.
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  BackSide,
  ConeGeometry,
  DoubleSide,
  FrontSide,
  PlaneGeometry,
  Quaternion,
  Group,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  PerspectiveCamera,
  Raycaster,
  SphereGeometry,
  Vector2,
  Vector3,
  type Object3D,
  type Ray,
} from 'three';
import { useStore } from '../store/store';
import { pickables, viewRefs } from './registry';

export interface DragSession {
  move(ray: Ray, e: PointerEvent): void;
  end(e: PointerEvent): void;
  cancel?(): void;
}

export interface HandleSpec {
  id: string;
  object: Object3D;
  cursor: string;
  start(ray: Ray, e: PointerEvent): DragSession | null;
}

const handles = new Map<string, HandleSpec>();

// ---- hover state shared with handle visuals ----
let hovered: string | null = null;
const hoverListeners = new Set<() => void>();
function setHovered(id: string | null) {
  if (hovered === id) return;
  hovered = id;
  viewRefs.handleHovered = id !== null;
  hoverListeners.forEach((l) => l());
}
const subscribeHover = (l: () => void) => {
  hoverListeners.add(l);
  return () => {
    hoverListeners.delete(l);
  };
};
export function useHandleHovered(id: string) {
  return useSyncExternalStore(subscribeHover, () => hovered === id);
}

/** Registers a draggable object. `start` is read through a ref, so it may close over fresh state. */
export function useHandle(id: string, object: Object3D | null, cursor: string, start: HandleSpec['start']) {
  const startRef = useRef(start);
  startRef.current = start;
  useEffect(() => {
    if (!object) return;
    const spec: HandleSpec = { id, object, cursor, start: (r, e) => startRef.current(r, e) };
    handles.set(id, spec);
    return () => {
      if (handles.get(id) === spec) handles.delete(id);
      if (hovered === id) setHovered(null);
    };
  }, [id, object, cursor]);
}

/** Pressing on a selected part and dragging moves it. The scene provides the implementation. */
export const bodyDrag: { start: ((ray: Ray, e: PointerEvent, point: Vector3, partId: string) => DragSession | null) | null } = { start: null };

export function HandleLayer() {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const camRef = useRef(camera);
  camRef.current = camera;

  useEffect(() => {
    const canvas = gl.domElement;
    const host = canvas.parentElement;
    if (!host) return;
    const raycaster = new Raycaster();
    const rayAt = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      raycaster.setFromCamera(new Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camRef.current);
      return raycaster;
    };
    const hitHandle = (rc: Raycaster): HandleSpec | null => {
      const specs = [...handles.values()].filter((h) => h.object.visible && h.object.parent);
      if (!specs.length) return null;
      for (const hit of rc.intersectObjects(
        specs.map((s) => s.object),
        true,
      )) {
        let o: Object3D | null = hit.object;
        while (o) {
          const spec = specs.find((s) => s.object === o);
          if (spec) return spec;
          o = o.parent;
        }
      }
      return null;
    };
    const selectedPartHit = (rc: Raycaster) => {
      const s = useStore.getState();
      if (s.draft && s.draft.feature.type !== 'primitive') return null;
      if (!s.draft && s.filter !== 'part') return null;
      const ids = s.draft ? [s.draft.feature.id] : s.sel.filter((x) => x.kind === 'part').map((x) => x.part);
      const meshes = ids.map((id) => pickables.get(id)?.mesh).filter((m): m is Mesh => !!m);
      if (!meshes.length) return null;
      const hit = rc.intersectObjects(meshes, false)[0];
      return hit ? { point: hit.point.clone(), partId: hit.object.userData.partId as string } : null;
    };

    let session: DragSession | null = null;
    let pending: { x: number; y: number; begin: () => DragSession | null } | null = null;
    let raf = 0;
    let lastHover: PointerEvent | null = null;

    const finishDrag = () => {
      setTimeout(() => {
        viewRefs.handleDragging = false;
      }, 0);
    };
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 || e.target !== canvas || e.altKey) return;
      const rc = rayAt(e);
      const spec = hitHandle(rc);
      if (spec) {
        const s = spec.start(rc.ray.clone(), e);
        if (!s) return;
        e.stopPropagation();
        e.preventDefault();
        session = s;
        viewRefs.handleDragging = true;
        return;
      }
      if (bodyDrag.start && !e.shiftKey && !e.ctrlKey && !e.metaKey && !viewRefs.gizmoAxis()) {
        const hit = selectedPartHit(rc);
        if (hit) {
          e.stopPropagation();
          e.preventDefault();
          const ray = rc.ray.clone();
          pending = { x: e.clientX, y: e.clientY, begin: () => bodyDrag.start?.(ray, e, hit.point, hit.partId) ?? null };
        }
      }
    };
    const hover = () => {
      raf = 0;
      if (!lastHover || session || pending) return;
      const rc = rayAt(lastHover);
      const spec = hitHandle(rc);
      setHovered(spec?.id ?? null);
      canvas.style.cursor = spec ? spec.cursor : selectedPartHit(rc) ? 'move' : '';
    };
    const onMove = (e: PointerEvent) => {
      if (pending) {
        if (Math.hypot(e.clientX - pending.x, e.clientY - pending.y) < 4) return;
        session = pending.begin();
        pending = null;
        viewRefs.handleDragging = !!session;
      }
      if (session) {
        session.move(rayAt(e).ray.clone(), e);
        return;
      }
      if (e.buttons || e.target !== canvas) {
        if (e.target !== canvas) setHovered(null);
        return;
      }
      lastHover = e;
      if (!raf) raf = requestAnimationFrame(hover);
    };
    const onUp = (e: PointerEvent) => {
      if (pending) {
        pending = null;
        return;
      }
      if (!session) return;
      const s = session;
      session = null;
      s.end(e);
      finishDrag();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && session) {
        session.cancel?.();
        session = null;
        finishDrag();
      }
    };
    host.addEventListener('pointerdown', onDown, { capture: true });
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('keydown', onKey);
    return () => {
      host.removeEventListener('pointerdown', onDown, { capture: true });
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('keydown', onKey);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [gl]);
  return null;
}

// ---------------------------------------------------------------- geometry helpers

const _v = new Vector3();

/** World size of one screen pixel at an object's position. */
export function worldPerPixel(camera: PerspectiveCamera | OrthographicCamera, at: Vector3, heightPx: number): number {
  if ((camera as OrthographicCamera).isOrthographicCamera) {
    const c = camera as OrthographicCamera;
    return (c.top - c.bottom) / c.zoom / heightPx;
  }
  const c = camera as PerspectiveCamera;
  const depth = Math.max(-_v.copy(at).applyMatrix4(c.matrixWorldInverse).z, 1e-3);
  return (2 * depth * Math.tan((c.fov * Math.PI) / 360)) / heightPx;
}

/** Keep an object a constant number of pixels tall, whatever the zoom; optionally keep it facing the camera. */
export function useScreenScale(ref: React.RefObject<Object3D | null>, px: number, billboard = false) {
  const p = new Vector3();
  const q = new Quaternion();
  useFrame(({ camera, size }) => {
    const o = ref.current;
    if (!o) return;
    o.getWorldPosition(p);
    o.scale.setScalar(px * worldPerPixel(camera as PerspectiveCamera, p, size.height));
    if (billboard && o.parent) {
      o.parent.getWorldQuaternion(q);
      o.quaternion.copy(q.invert().multiply(camera.quaternion));
    }
  });
}

/** Closest point parameter t on the line origin + t * dir to a ray (null if nearly parallel). */
export function closestOnAxis(origin: Vector3, dir: Vector3, ray: Ray): number | null {
  const w0 = origin.clone().sub(ray.origin);
  const a = dir.dot(dir);
  const b = dir.dot(ray.direction);
  const c = ray.direction.dot(ray.direction);
  const d = dir.dot(w0);
  const e = ray.direction.dot(w0);
  const den = a * c - b * b;
  if (Math.abs(den) < 1e-9) return null;
  return (b * e - c * d) / den;
}

// ---------------------------------------------------------------- handle visuals

const SQUARE = new PlaneGeometry(1, 1);
const SPHERE = new SphereGeometry(0.5, 16, 12);
const CONE = new ConeGeometry(0.45, 1, 18).rotateX(Math.PI / 2).translate(0, 0, 0.5);

function overlayMaterial(color: string, side: typeof FrontSide | typeof BackSide | typeof DoubleSide = FrontSide) {
  return new MeshBasicMaterial({ color, depthTest: false, depthWrite: false, transparent: true, side });
}

type Shape = 'square' | 'dot' | 'cone' | 'sphere';

/**
 * A pixel-sized handle that floats on top of the model. Shapes: white square (resize), small dark
 * square (resize one side), cone (lift or value arrow), sphere (rotate).
 */
export function Handle({
  id,
  position,
  shape,
  px = 11,
  cursor = 'pointer',
  color,
  hoverColor,
  quaternion,
  onStart,
  children,
}: {
  id: string;
  position: [number, number, number];
  shape: Shape;
  px?: number;
  cursor?: string;
  color?: string;
  hoverColor: string;
  quaternion?: [number, number, number, number];
  onStart: HandleSpec['start'];
  children?: ReactNode;
}) {
  const group = useRef<Group | null>(null);
  const [object, setObject] = useState<Group | null>(null);
  const setRef = useCallback((g: Group | null) => {
    group.current = g;
    setObject(g);
  }, []);
  const invalidate = useThree((s) => s.invalidate);
  const isHovered = useHandleHovered(id);
  const fillColor = color ?? (shape === 'dot' ? '#20242c' : shape === 'cone' ? '#20242c' : '#ffffff');
  const strokeColor = shape === 'dot' || shape === 'cone' ? '#ffffff' : '#20242c';
  const flat = shape === 'square' || shape === 'dot';
  const fill = useMemo(() => overlayMaterial(fillColor, flat ? DoubleSide : FrontSide), [fillColor, flat]);
  const stroke = useMemo(() => overlayMaterial(strokeColor, flat ? DoubleSide : BackSide), [strokeColor, flat]);
  useEffect(() => {
    fill.color.set(isHovered ? hoverColor : fillColor);
    invalidate();
  }, [isHovered, fill, hoverColor, fillColor, invalidate]);
  useEffect(
    () => () => {
      fill.dispose();
      stroke.dispose();
    },
    [fill, stroke],
  );
  // Squares are flat and always face the camera, like Tinkercad's handles.
  useScreenScale(group, px, flat);
  useHandle(id, object, cursor, onStart);
  const geo = shape === 'cone' ? CONE : shape === 'sphere' ? SPHERE : SQUARE;
  return (
    <group ref={setRef} position={position} quaternion={flat ? undefined : quaternion} renderOrder={20}>
      <mesh geometry={geo} material={stroke} scale={shape === 'cone' ? 1.25 : flat ? 1.45 : 1.4} renderOrder={20} />
      <mesh geometry={geo} material={fill} renderOrder={21} />
      {children}
    </group>
  );
}
