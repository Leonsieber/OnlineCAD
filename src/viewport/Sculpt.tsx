// Sculpting: pick a brush in the Mesh tab, then drag over a part. Each stroke is recorded (in world
// coordinates) on that part's Sculpt step in the history, and the worker replays the strokes.
import { useEffect, useState } from 'react';
import { useThree } from '@react-three/fiber';
import { DoubleSide, Quaternion, Raycaster, Vector2, Vector3, type Mesh } from 'three';
import { create } from 'zustand';
import { createSculpt } from '../model/defaults';
import { insertFeature } from '../model/docOps';
import type { SculptBrush, SculptStroke, Vec3 } from '../model/types';
import { useStore } from '../store/store';
import { pickables } from './registry';
import { useSceneColors } from './sceneColors';

interface SculptState {
  brush: SculptBrush | null;
  radius: number;
  strength: number;
}

export const useSculpt = create<SculptState>(() => ({ brush: null, radius: 6, strength: 0.5 }));
export const isSculpting = () => useSculpt.getState().brush !== null;

export function setBrush(brush: SculptBrush | null) {
  useSculpt.setState({ brush: useSculpt.getState().brush === brush ? null : brush });
}

/** Adds a stroke to the part's Sculpt step: the last step if it sculpts this part, otherwise a new one. */
function commitStroke(part: string, stroke: SculptStroke) {
  const s = useStore.getState();
  s.commit((d) => {
    const last = d.features[d.rollback - 1];
    if (last?.type === 'sculpt' && last.part === part) {
      return { ...d, features: d.features.map((f) => (f === last ? { ...last, strokes: [...last.strokes, stroke] } : f)) };
    }
    const f = createSculpt(part, d.features);
    return insertFeature(d, { ...f, strokes: [stroke] }, d.rollback);
  });
}

export function SculptLayer() {
  const { brush, radius } = useSculpt();
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  const colors = useSceneColors();
  const [cursor, setCursor] = useState<{ p: Vec3; n: Vec3 } | null>(null);

  useEffect(() => {
    if (!brush) {
      setCursor(null);
      return;
    }
    const el = gl.domElement;
    let stroke: { part: string; points: Vec3[]; normal: Vec3 } | null = null;

    const hitAt = (e: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      const ray = new Raycaster();
      ray.setFromCamera(new Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1), camera);
      const { doc } = useStore.getState();
      const entries = [...pickables.values()].filter((p) => !doc.parts[p.partId]?.hidden);
      const hit = ray.intersectObjects(entries.map((p) => p.mesh as Mesh), false)[0];
      if (!hit?.face) return null;
      const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
      if (n.dot(ray.ray.direction) > 0) n.negate();
      return { part: (hit.object.userData as { partId: string }).partId, p: hit.point.toArray() as Vec3, n: n.toArray() as Vec3 };
    };

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const h = hitAt(e);
      if (!h) return;
      e.stopPropagation();
      stroke = { part: h.part, points: [h.p], normal: h.n };
      el.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      const h = hitAt(e);
      setCursor(h ? { p: h.p, n: h.n } : null);
      invalidate();
      if (!stroke || !h) return;
      const { radius: r, brush: b } = useSculpt.getState();
      if (b === 'grab') {
        // Grab keeps the start point and follows the cursor across the view plane.
        stroke.points[1] = h.p;
        return;
      }
      const last = stroke.points[stroke.points.length - 1];
      if (Math.hypot(h.p[0] - last[0], h.p[1] - last[1], h.p[2] - last[2]) > r * 0.25) stroke.points.push(h.p);
    };
    const onUp = (e: PointerEvent) => {
      if (!stroke) return;
      el.releasePointerCapture?.(e.pointerId);
      const s = stroke;
      stroke = null;
      const { radius: r, strength, brush: b } = useSculpt.getState();
      if (!b || (b === 'grab' && s.points.length < 2)) return;
      const round = (v: Vec3): Vec3 => v.map((x) => Math.round(x * 1000) / 1000) as Vec3;
      commitStroke(s.part, { brush: b, points: s.points.map(round), normal: round(s.normal), radius: r, strength });
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') useSculpt.setState({ brush: null });
      if (e.key === '[') useSculpt.setState((st) => ({ radius: Math.max(0.5, st.radius / 1.2) }));
      if (e.key === ']') useSculpt.setState((st) => ({ radius: Math.min(500, st.radius * 1.2) }));
    };
    el.addEventListener('pointerdown', onDown, { capture: true });
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    window.addEventListener('keydown', onKey);
    return () => {
      el.removeEventListener('pointerdown', onDown, { capture: true });
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      window.removeEventListener('keydown', onKey);
    };
  }, [brush, gl, camera, invalidate]);

  if (!brush || !cursor) return null;
  const q = new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), new Vector3(...cursor.n));
  return (
    <mesh position={cursor.p} quaternion={q.toArray() as [number, number, number, number]} renderOrder={40}>
      <ringGeometry args={[radius * 0.92, radius, 48]} />
      <meshBasicMaterial color={brush === 'deflate' ? colors.axisZ : colors.accent} side={DoubleSide} depthTest={false} transparent opacity={0.9} />
    </mesh>
  );
}
