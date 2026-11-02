// Drag arrows for dialog values (Onshape / Shapr3D style): pull the arrow to set a fillet radius,
// chamfer distance, or shell thickness. The arrow tip sits where the new surface ends up.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Html } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { CylinderGeometry, ConeGeometry, Group, MeshBasicMaterial, Quaternion, Vector3, type Ray } from 'three';
import { EDGE_INFO_STRIDE } from '../kernel/protocol';
import { evalNum, formatNum } from '../model/expr';
import type { Feature, NumExpr } from '../model/types';
import { useStore } from '../store/store';
import { closestOnAxis, useHandle, useHandleHovered, useScreenScale, type DragSession } from './handles';
import { useSceneColors } from './sceneColors';

interface ArrowSpec {
  key: string;
  base: Vector3;
  /** Unit direction the value grows in. */
  dir: Vector3;
  /** Tip distance from the base per unit of value. */
  k: number;
  value: number;
  label: string;
  apply: (f: Feature, v: number) => Feature;
}

function num(v: NumExpr, scope: Record<string, number>): number | null {
  try {
    return evalNum(v, scope);
  } catch {
    return null;
  }
}

function specFor(f: Feature | undefined, parts: { id: string; bbox: [number[], number[]] }[], scope: Record<string, number>): ArrowSpec | null {
  if (!f) return null;
  if ((f.type === 'fillet' || f.type === 'chamfer') && f.edges.length) {
    const fp = f.edges[0].fp;
    const value = num(f.type === 'fillet' ? f.radius : f.distance, scope);
    if (value === null) return null;
    const base = new Vector3(fp[0], fp[1], fp[2]);
    let d = fp.length >= EDGE_INFO_STRIDE ? new Vector3(fp[11], fp[12], fp[13]) : new Vector3();
    if (d.lengthSq() < 1e-10) {
      // Older reference without a direction: aim at the part's center.
      const p = parts.find((x) => x.id === f.edges[0].part);
      const center = p ? new Vector3(...(p.bbox[0] as [number, number, number])).add(new Vector3(...(p.bbox[1] as [number, number, number]))).multiplyScalar(0.5) : base.clone();
      d = center.sub(base);
    }
    // 1:1 mapping (drag 1 mm, change 1 mm) is easier to control than tracking the exact surface.
    return {
      key: `${f.id}:${f.type}`,
      base,
      dir: d.normalize(),
      k: 1,
      value,
      label: f.type === 'fillet' ? 'R' : '',
      apply: (x, v) => (x.type === 'fillet' ? { ...x, radius: v } : x.type === 'chamfer' ? { ...x, distance: v } : x),
    };
  }
  if (f.type === 'shell' && f.faces.length) {
    const fp = f.faces[0].fp;
    const value = num(f.thickness, scope);
    if (value === null) return null;
    const n = new Vector3(fp[3], fp[4], fp[5]).normalize();
    return {
      key: `${f.id}:shell`,
      base: new Vector3(fp[0], fp[1], fp[2]),
      dir: f.outward ? n : n.negate(),
      k: 1,
      value,
      label: '',
      apply: (x, v) => (x.type === 'shell' ? { ...x, thickness: v } : x),
    };
  }
  return null;
}

export function DraftArrows() {
  const draft = useStore((s) => s.draft);
  const parts = useStore((s) => s.parts);
  const scope = useStore((s) => s.varValues);
  const spec = useMemo(() => specFor(draft?.feature, parts, scope), [draft, parts, scope]);
  if (!spec) return null;
  return <ValueArrow spec={spec} />;
}

const SHAFT = new CylinderGeometry(1.4, 1.4, 36, 10).rotateX(Math.PI / 2).translate(0, 0, 14 + 18);
const HEAD = new ConeGeometry(6, 14, 18).rotateX(-Math.PI / 2).translate(0, 0, 7);

function ValueArrow({ spec }: { spec: ArrowSpec }) {
  const colors = useSceneColors();
  const invalidate = useThree((s) => s.invalidate);
  const id = `arrow:${spec.key}`;
  const hovered = useHandleHovered(id);
  const [dragging, setDragging] = useState(false);
  const group = useRef<Group | null>(null);
  const [object, setObject] = useState<Group | null>(null);
  const setRef = useCallback((g: Group | null) => {
    group.current = g;
    setObject(g);
  }, []);
  const material = useMemo(() => new MeshBasicMaterial({ depthTest: false, depthWrite: false, transparent: true }), []);
  useEffect(() => {
    material.color.set(hovered || dragging ? colors.hover : colors.accent);
    invalidate();
  }, [material, hovered, dragging, colors, invalidate]);
  useEffect(() => () => material.dispose(), [material]);
  // 1 local unit = 1 screen pixel, so the arrow keeps its size at any zoom.
  useScreenScale(group, 1);

  const tip = spec.base.clone().addScaledVector(spec.dir, spec.value * spec.k);
  // The arrow points along the value direction, so it sits on the outside pointing in.
  const quat = new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), spec.dir.clone().negate());

  useHandle(id, object, 'grab', (ray: Ray): DragSession | null => {
    const t0 = closestOnAxis(spec.base, spec.dir, ray);
    if (t0 === null) return null;
    const grab = t0 - spec.value * spec.k;
    let last = spec.value;
    setDragging(true);
    return {
      move(r, ev) {
        const t = closestOnAxis(spec.base, spec.dir, r);
        if (t === null) return;
        const step = ev.shiftKey ? 1 : ev.altKey ? 0.01 : 0.1;
        const v = Math.max(step, Math.round((t - grab) / spec.k / step) * step);
        const rounded = Math.round(v * 1000) / 1000;
        if (rounded === last) return;
        last = rounded;
        useStore.getState().patchDraft((f) => spec.apply(f, rounded));
      },
      end() {
        setDragging(false);
      },
      cancel() {
        setDragging(false);
      },
    };
  });

  return (
    <group ref={setRef} position={tip.toArray()} quaternion={quat.toArray() as [number, number, number, number]} renderOrder={25}>
      <mesh geometry={HEAD} material={material} renderOrder={25} />
      <mesh geometry={SHAFT} material={material} renderOrder={25} />
      <Html position={[0, 0, 64]} center zIndexRange={[40, 30]}>
        <div className={`dim-chip arrow-chip${dragging ? ' active' : ''}`}>
          {spec.label ? `${spec.label} ` : ''}
          {formatNum(spec.value, 2)} mm
        </div>
      </Html>
    </group>
  );
}
