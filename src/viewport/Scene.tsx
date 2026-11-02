import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { CameraControls, CameraControlsImpl, Grid, Line, OrthographicCamera, PerspectiveCamera, TransformControls } from '@react-three/drei';
import {
  BufferGeometry,
  DirectionalLight,
  DoubleSide,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  OrthographicCamera as OrthoCam,
  PerspectiveCamera as PerspCam,
  PMREMGenerator,
  Raycaster,
  Vector2,
  Vector3,
  type Camera,
} from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { EDGE_INFO_STRIDE, FACE_INFO_STRIDE, type MeshData } from '../kernel/protocol';
import type { EdgeRef, FaceRef, Feature } from '../model/types';
import { fieldKind, fpDistance, partColor, useStore, type SelItem, type SelKind } from '../store/store';
import { liveMove } from './liveMove';
import { PartView, type PartLook } from './PartView';
import { cameraEvents, cameraPose, pickables, viewRefs } from './registry';
import { useSceneColors } from './sceneColors';
import { bindView, partsBox } from './viewApi';

export function Scene() {
  const projection = useStore((s) => s.prefs.projection);
  return (
    <>
      {projection === 'perspective' ? (
        <PerspectiveCamera makeDefault fov={35} near={0.1} far={400000} position={cameraPose.position.toArray()} />
      ) : (
        <OrthographicCamera makeDefault near={-200000} far={200000} position={cameraPose.position.toArray()} />
      )}
      <Controls />
      <Lighting />
      <GroundGrid />
      <Axes />
      <Parts />
      <Highlights />
      <Picker />
      <Gizmo />
    </>
  );
}

// ---------------------------------------------------------------- camera controls

function Controls() {
  const ref = useRef<CameraControlsImpl>(null);
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  const size = useThree((s) => s.size);
  const sizeRef = useRef(size);
  sizeRef.current = size;

  useEffect(() => {
    bindView(() => viewRefs.camera, invalidate);
    viewRefs.canvas = gl.domElement;
  }, [gl, invalidate]);

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const A = CameraControlsImpl.ACTION;
    const ortho = (camera as OrthoCam).isOrthographicCamera === true;
    c.mouseButtons.left = A.ROTATE;
    c.mouseButtons.middle = A.TRUCK;
    c.mouseButtons.right = A.TRUCK;
    c.mouseButtons.wheel = ortho ? A.ZOOM : A.DOLLY;
    c.touches.one = A.TOUCH_ROTATE;
    c.touches.two = ortho ? A.TOUCH_ZOOM_TRUCK : A.TOUCH_DOLLY_TRUCK;
    c.touches.three = A.TOUCH_TRUCK;
    c.dollyToCursor = true;
    c.smoothTime = 0.1;
    c.draggingSmoothTime = 0.03;
    c.minDistance = 0.5;
    c.maxDistance = 200000;
    c.minZoom = 0.001;
    c.maxZoom = 5000;
    c.updateCameraUp();
    const p = cameraPose.position;
    const t = cameraPose.target;
    void c.setLookAt(p.x, p.y, p.z, t.x, t.y, t.z, false);
    if (ortho) void c.zoomTo(sizeRef.current.height / cameraPose.visibleHeight, false);
    viewRefs.controls = c;
    viewRefs.camera = camera;

    const onUpdate = () => {
      c.getPosition(cameraPose.position);
      c.getTarget(cameraPose.target);
      const h = sizeRef.current.height || 1;
      if ((camera as OrthoCam).isOrthographicCamera) {
        cameraPose.visibleHeight = h / (camera as OrthoCam).zoom;
      } else {
        const fov = ((camera as PerspCam).fov * Math.PI) / 180;
        cameraPose.visibleHeight = 2 * cameraPose.position.distanceTo(cameraPose.target) * Math.tan(fov / 2);
      }
      cameraEvents.dispatchEvent(new Event('change'));
    };
    c.addEventListener('update', onUpdate);
    onUpdate();
    // Shift + left drag pans, like most CAD tools.
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Shift') c.mouseButtons.left = e.type === 'keydown' ? A.TRUCK : A.ROTATE;
    };
    window.addEventListener('keydown', key);
    window.addEventListener('keyup', key);
    return () => {
      c.removeEventListener('update', onUpdate);
      window.removeEventListener('keydown', key);
      window.removeEventListener('keyup', key);
      if (viewRefs.controls === c) viewRefs.controls = null;
    };
  }, [camera]);

  return <CameraControls ref={ref} makeDefault />;
}

// ---------------------------------------------------------------- lights

function Lighting() {
  const scene = useThree((s) => s.scene);
  const gl = useThree((s) => s.gl);
  const light = useRef<DirectionalLight>(null!);

  useEffect(() => {
    const pmrem = new PMREMGenerator(gl);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = env;
    scene.environmentIntensity = 0.8;
    scene.environmentRotation.set(Math.PI / 2, 0, 0); // RoomEnvironment is Y-up; our world is Z-up
    return () => {
      scene.environment = null;
      env.dispose();
      pmrem.dispose();
    };
  }, [gl, scene]);

  // A headlight that follows the camera keeps every visible face readable.
  useFrame(({ camera }) => {
    const l = light.current;
    l.position.copy(camera.position);
    l.target.position.copy(cameraPose.target);
    l.target.updateMatrixWorld();
  });

  return (
    <>
      <ambientLight intensity={0.15} />
      <directionalLight ref={light} intensity={1.35} />
      <directionalLight position={[80, -60, 260]} intensity={0.5} />
    </>
  );
}

// ---------------------------------------------------------------- grid and axes

function useGridScale() {
  const [cell, setCell] = useState(5);
  useEffect(() => {
    const onChange = () => {
      const h = cameraPose.visibleHeight;
      setCell(h < 40 ? 1 : h < 300 ? 5 : h < 1500 ? 25 : h < 8000 ? 100 : 500);
    };
    cameraEvents.addEventListener('change', onChange);
    onChange();
    return () => cameraEvents.removeEventListener('change', onChange);
  }, []);
  return cell;
}

function GroundGrid() {
  const show = useStore((s) => s.prefs.grid);
  const colors = useSceneColors();
  const cell = useGridScale();
  if (!show) return null;
  return (
    <Grid
      rotation={[Math.PI / 2, 0, 0]}
      infiniteGrid
      cellSize={cell}
      sectionSize={cell * 10}
      cellThickness={0.6}
      sectionThickness={1.1}
      cellColor={colors.gridCell}
      sectionColor={colors.gridSection}
      fadeDistance={cell * 600}
      fadeStrength={2}
      side={DoubleSide}
      renderOrder={-1}
      onUpdate={(m: Mesh) => {
        (m.material as MeshBasicMaterial).depthWrite = false;
      }}
    />
  );
}

function Axes() {
  const show = useStore((s) => s.prefs.grid);
  const colors = useSceneColors();
  const cell = useGridScale();
  if (!show) return null;
  const L = cell * 400;
  return (
    <group renderOrder={0}>
      <Line points={[[-L, 0, 0.01], [L, 0, 0.01]]} color={colors.axisX} lineWidth={1.4} transparent opacity={0.7} />
      <Line points={[[0, -L, 0.01], [0, L, 0.01]]} color={colors.axisY} lineWidth={1.4} transparent opacity={0.7} />
      <Line points={[[0, 0, 0], [0, 0, cell * 2.5]]} color={colors.axisZ} lineWidth={1.4} transparent opacity={0.75} />
    </group>
  );
}

// ---------------------------------------------------------------- parts

function draftPartIds(f: Feature | undefined): string[] {
  if (!f) return [];
  if (f.type === 'primitive') return [f.id];
  if (f.type === 'boolean') return [...f.targets, ...f.tools];
  if ('parts' in f) return f.parts;
  return [];
}

function Parts() {
  const parts = useStore((s) => s.parts);
  const meshes = useStore((s) => s.meshes);
  const doc = useStore((s) => s.doc);
  const display = useStore((s) => s.prefs.display);
  const sel = useStore((s) => s.sel);
  const hover = useStore((s) => s.hover);
  const draft = useStore((s) => s.draft);
  const colors = useSceneColors();
  const inDraft = useMemo(() => new Set(draftPartIds(draft?.feature)), [draft]);

  return (
    <>
      {parts.map((p) => {
        const data = meshes.get(p.key);
        if (!data || doc.parts[p.id]?.hidden) return null;
        let look: PartLook = 'none';
        if (inDraft.has(p.id) || sel.some((x) => x.kind === 'part' && x.part === p.id)) look = 'selected';
        else if (hover?.kind === 'part' && hover.part === p.id) look = 'hover';
        return (
          <PartView
            key={p.id}
            id={p.id}
            data={data}
            color={partColor(p.id, { doc, parts })}
            display={display}
            look={look}
            edgeColor={colors.edge}
            accent={colors.accent}
            hover={colors.hover}
          />
        );
      })}
    </>
  );
}

// ---------------------------------------------------------------- face / edge highlights

interface HighlightItem {
  kind: 'face' | 'edge';
  part: string;
  index: number;
  mode: 'hover' | 'selected';
}

/** Finds the displayed edge/face that matches a stored reference exactly (it may be gone after a fillet). */
function matchRef(data: MeshData, kind: 'edge' | 'face', fp: number[]): number {
  const stride = kind === 'edge' ? EDGE_INFO_STRIDE : FACE_INFO_STRIDE;
  const info = kind === 'edge' ? data.edgeInfo : data.faceInfo;
  const n = info.length / stride;
  for (let i = 0; i < n; i++) {
    if (fpDistance(Array.from(info.subarray(i * stride, i * stride + stride)), fp) < 0.01) return i;
  }
  return -1;
}

function Highlights() {
  const hover = useStore((s) => s.hover);
  const sel = useStore((s) => s.sel);
  const draft = useStore((s) => s.draft);
  const parts = useStore((s) => s.parts);
  const meshes = useStore((s) => s.meshes);
  const colors = useSceneColors();

  const items = useMemo(() => {
    const out: HighlightItem[] = [];
    const meshOf = (id: string) => {
      const p = parts.find((x) => x.id === id);
      return p ? meshes.get(p.key) : undefined;
    };
    for (const s of sel) if (s.kind !== 'part') out.push({ kind: s.kind, part: s.part, index: s.index, mode: 'selected' });
    const f = draft?.feature as (Feature & { edges?: EdgeRef[]; faces?: FaceRef[] }) | undefined;
    for (const r of f?.edges ?? []) {
      const m = meshOf(r.part);
      const i = m ? matchRef(m, 'edge', r.fp) : -1;
      if (i >= 0) out.push({ kind: 'edge', part: r.part, index: i, mode: 'selected' });
    }
    for (const r of f?.faces ?? []) {
      const m = meshOf(r.part);
      const i = m ? matchRef(m, 'face', r.fp) : -1;
      if (i >= 0) out.push({ kind: 'face', part: r.part, index: i, mode: 'selected' });
    }
    if (hover && hover.kind !== 'part') out.push({ kind: hover.kind, part: hover.part, index: hover.index, mode: 'hover' });
    return out.map((it) => ({ it, data: meshOf(it.part) })).filter((x): x is { it: HighlightItem; data: MeshData } => !!x.data);
  }, [hover, sel, draft, parts, meshes]);

  return (
    <>
      {items.map(({ it, data }) =>
        it.kind === 'face' ? (
          <FaceHighlight key={`${it.mode}:f:${it.part}:${it.index}`} data={data} index={it.index} color={it.mode === 'hover' ? colors.hover : colors.accent} opacity={it.mode === 'hover' ? 0.35 : 0.55} />
        ) : (
          <EdgeHighlight key={`${it.mode}:e:${it.part}:${it.index}`} data={data} index={it.index} color={it.mode === 'hover' ? colors.hover : colors.accent} />
        ),
      )}
    </>
  );
}

function FaceHighlight({ data, index, color, opacity }: { data: MeshData; index: number; color: string; opacity: number }) {
  const invalidate = useThree((s) => s.invalidate);
  const obj = useMemo(() => {
    const g = new BufferGeometry();
    const base = [...pickables.values()].find((p) => p.data === data)?.mesh.geometry;
    const start = data.faceRanges[index * 2];
    const count = data.faceRanges[index * 2 + 1];
    if (base) {
      g.setAttribute('position', base.getAttribute('position'));
      g.setIndex(base.getIndex());
    }
    g.setDrawRange(start, count);
    const m = new MeshBasicMaterial({ transparent: true, depthWrite: false, side: DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 });
    const mesh = new Mesh(g, m);
    mesh.raycast = () => {};
    mesh.renderOrder = 2;
    return mesh;
  }, [data, index]);
  useEffect(() => {
    const m = obj.material as MeshBasicMaterial;
    m.color.set(color);
    m.opacity = opacity;
    invalidate();
  }, [obj, color, opacity, invalidate]);
  useEffect(
    () => () => {
      (obj.material as MeshBasicMaterial).dispose();
    },
    [obj],
  );
  return <primitive object={obj} />;
}

function EdgeHighlight({ data, index, color }: { data: MeshData; index: number; color: string }) {
  const invalidate = useThree((s) => s.invalidate);
  const obj = useMemo(() => {
    const start = data.edgeRanges[index * 2];
    const count = data.edgeRanges[index * 2 + 1];
    const g = new LineSegmentsGeometry();
    g.setPositions(data.edgePositions.slice(start * 3, (start + count) * 3));
    const ls = new LineSegments2(g, new LineMaterial({ linewidth: 3.5, worldUnits: false, depthTest: false, transparent: true }));
    ls.renderOrder = 3;
    ls.raycast = () => {};
    return ls;
  }, [data, index]);
  useEffect(() => {
    (obj.material as LineMaterial).color.set(color);
    invalidate();
  }, [obj, color, invalidate]);
  useEffect(
    () => () => {
      obj.geometry.dispose();
      (obj.material as LineMaterial).dispose();
    },
    [obj],
  );
  return <primitive object={obj} />;
}

// ---------------------------------------------------------------- picking

const raycaster = new Raycaster();
(raycaster as Raycaster & { firstHitOnly?: boolean }).firstHitOnly = true;

function activeFilter(): SelKind | null {
  const s = useStore.getState();
  if (s.draft) return fieldKind(s.draft.field);
  return s.filter;
}

function faceIndexFor(data: MeshData, triangle: number): number {
  const at = triangle * 3;
  for (let i = 0; i < data.faceRanges.length / 2; i++) {
    const start = data.faceRanges[i * 2];
    if (at >= start && at < start + data.faceRanges[i * 2 + 1]) return i;
  }
  return -1;
}

function pickAt(el: HTMLElement, camera: Camera, clientX: number, clientY: number, filter: SelKind): SelItem | null {
  const rect = el.getBoundingClientRect();
  const sx = clientX - rect.left;
  const sy = clientY - rect.top;
  const ndc = new Vector2((sx / rect.width) * 2 - 1, -(sy / rect.height) * 2 + 1);
  const { doc } = useStore.getState();
  const entries = [...pickables.values()].filter((e) => !doc.parts[e.partId]?.hidden);
  raycaster.setFromCamera(ndc, camera);
  const hit = raycaster.intersectObjects(
    entries.map((e) => e.mesh),
    false,
  )[0];

  if (filter === 'edge') {
    const hitDepth = hit ? -hit.point.clone().applyMatrix4(camera.matrixWorldInverse).z : Infinity;
    return pickEdge(entries, camera, rect, sx, sy, hitDepth);
  }
  if (!hit) return null;
  const partId = hit.object.userData.partId as string;
  if (filter === 'part') return { kind: 'part', part: partId, index: -1 };
  const data = pickables.get(partId)?.data;
  if (!data || data.kind !== 'brep' || hit.faceIndex == null) return null;
  const index = faceIndexFor(data, hit.faceIndex);
  return index >= 0 ? { kind: 'face', part: partId, index } : null;
}

const _a = new Vector3();
const _b = new Vector3();
const _p = new Vector3();

/** Screen-space edge picking: nearest visible edge within a few pixels of the cursor. */
function pickEdge(
  entries: { partId: string; mesh: Mesh; data: MeshData }[],
  camera: Camera,
  rect: DOMRect,
  sx: number,
  sy: number,
  hitDepth: number,
): SelItem | null {
  const cands: { part: string; index: number; d: number; depth: number }[] = [];
  const toScreen = (v: Vector3) => {
    v.project(camera);
    return [((v.x + 1) / 2) * rect.width, ((1 - v.y) / 2) * rect.height, v.z] as const;
  };
  for (const e of entries) {
    const { edgeRanges, edgePositions } = e.data;
    const mw = e.mesh.matrixWorld;
    for (let i = 0; i < edgeRanges.length / 2; i++) {
      const start = edgeRanges[i * 2];
      const count = edgeRanges[i * 2 + 1];
      let best = Infinity;
      let bestDepth = 0;
      for (let k = start; k + 1 < start + count; k += 2) {
        _a.fromArray(edgePositions, k * 3).applyMatrix4(mw);
        _b.fromArray(edgePositions, (k + 1) * 3).applyMatrix4(mw);
        const [ax, ay, az] = toScreen(_a.clone());
        const [bx, by, bz] = toScreen(_b.clone());
        if (az > 1 || bz > 1) continue;
        const dx = bx - ax;
        const dy = by - ay;
        const len2 = dx * dx + dy * dy;
        const t = len2 > 0 ? Math.max(0, Math.min(1, ((sx - ax) * dx + (sy - ay) * dy) / len2)) : 0;
        const d = Math.hypot(sx - (ax + t * dx), sy - (ay + t * dy));
        if (d < best) {
          best = d;
          _p.copy(_a).lerp(_b, t);
          bestDepth = -_p.applyMatrix4(camera.matrixWorldInverse).z;
        }
      }
      if (best < 7) cands.push({ part: e.partId, index: i, d: best, depth: bestDepth });
    }
  }
  cands.sort((x, y) => x.d - y.d);
  const tol = Number.isFinite(hitDepth) ? Math.max(hitDepth * 0.01, 0.05) : Infinity;
  const visible = cands.find((c) => !Number.isFinite(hitDepth) || c.depth <= hitDepth + tol);
  return visible ? { kind: 'edge', part: visible.part, index: visible.index } : null;
}

function Picker() {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const camRef = useRef(camera);
  camRef.current = camera;

  useEffect(() => {
    const el = gl.domElement;
    let down: { x: number; y: number; button: number } | null = null;
    let raf = 0;
    let last: { x: number; y: number } | null = null;

    const hoverNow = () => {
      raf = 0;
      if (!last) return;
      const filter = activeFilter();
      const s = useStore.getState();
      s.setHover(filter && !viewRefs.gizmoAxis() ? pickAt(el, camRef.current, last.x, last.y, filter) : null);
    };
    const onDown = (e: PointerEvent) => {
      down = { x: e.clientX, y: e.clientY, button: e.button };
    };
    const onMove = (e: PointerEvent) => {
      if (e.buttons) {
        if (useStore.getState().hover) useStore.getState().setHover(null);
        return;
      }
      last = { x: e.clientX, y: e.clientY };
      if (!raf) raf = requestAnimationFrame(hoverNow);
    };
    const onUp = (e: PointerEvent) => {
      if (!down) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      const button = down.button;
      down = null;
      if (moved > 5) return;
      const s = useStore.getState();
      if (button === 0) {
        if (viewRefs.gizmoAxis() || viewRefs.gizmoDragging) return;
        const filter = activeFilter();
        const item = filter ? pickAt(el, camRef.current, e.clientX, e.clientY, filter) : null;
        if (s.draft) {
          if (item) s.pick(item);
          return;
        }
        if (item) s.select(item, e.shiftKey || e.ctrlKey || e.metaKey);
        else if (!e.shiftKey && !e.ctrlKey && !e.metaKey) s.select(null);
        s.setCtxMenu(null);
      } else if (button === 2) {
        const item = pickAt(el, camRef.current, e.clientX, e.clientY, 'part');
        if (item && !s.draft && !s.sel.some((x) => x.kind === 'part' && x.part === item.part)) s.select(item);
        s.setCtxMenu({ x: e.clientX, y: e.clientY, part: item?.part ?? null });
      }
    };
    const onLeave = () => {
      last = null;
      useStore.getState().setHover(null);
    };
    const onCtx = (e: Event) => e.preventDefault();
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointerleave', onLeave);
    el.addEventListener('contextmenu', onCtx);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointerleave', onLeave);
      el.removeEventListener('contextmenu', onCtx);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [gl]);
  return null;
}

// ---------------------------------------------------------------- move / rotate gizmo

function Gizmo() {
  const draft = useStore((s) => s.draft);
  const sel = useStore((s) => s.sel);
  const parts = useStore((s) => s.parts);
  const mode = useStore((s) => s.gizmo);
  const snap = useStore((s) => s.prefs.snap);
  const invalidate = useThree((s) => s.invalidate);
  const tcRef = useRef<{ axis: string | null } | null>(null);

  const ids = useMemo(() => {
    const raw = draft ? (draft.feature.type === 'primitive' ? [draft.feature.id] : []) : sel.filter((x) => x.kind === 'part').map((x) => x.part);
    return raw.filter((id) => parts.some((p) => p.id === id));
  }, [draft, sel, parts]);
  const idKey = ids.join('|');
  const center = useMemo(() => {
    const box = partsBox(ids);
    return box.isEmpty() ? null : box.getCenter(new Vector3());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idKey, parts]);

  const proxy = useMemo(() => new Object3D(), []);
  const start = useRef(new Matrix4());
  const dragging = useRef(false);

  useEffect(() => {
    if (!center || dragging.current) return;
    proxy.position.copy(center);
    proxy.quaternion.identity();
    proxy.updateMatrixWorld(true);
    invalidate();
  }, [center?.x, center?.y, center?.z, proxy, invalidate, center]);

  useEffect(() => {
    viewRefs.gizmoAxis = () => tcRef.current?.axis ?? null;
    return () => {
      viewRefs.gizmoAxis = () => null;
    };
  }, []);

  if (!center || !ids.length) return null;
  const delta = () => proxy.matrixWorld.clone().multiply(start.current.clone().invert());
  return (
    <>
      <primitive object={proxy} />
      <TransformControls
        ref={tcRef as never}
        object={proxy}
        mode={mode}
        space="world"
        size={0.8}
        translationSnap={snap > 0 ? snap : null}
        rotationSnap={Math.PI / 12}
        onMouseDown={() => {
          dragging.current = true;
          viewRefs.gizmoDragging = true;
          proxy.updateMatrixWorld(true);
          start.current.copy(proxy.matrixWorld);
        }}
        onObjectChange={() => {
          if (!dragging.current) return;
          proxy.updateMatrixWorld(true);
          liveMove.set(ids, delta());
        }}
        onMouseUp={() => {
          dragging.current = false;
          setTimeout(() => (viewRefs.gizmoDragging = false), 0);
          proxy.updateMatrixWorld(true);
          const d = delta();
          proxy.quaternion.identity();
          proxy.updateMatrixWorld(true);
          useStore.getState().commitMove(ids, d, center.toArray());
        }}
      />
    </>
  );
}
