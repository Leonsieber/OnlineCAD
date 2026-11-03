// Point-to-point measuring: click two spots on parts (snapping to corners, edge midpoints, and
// face centers) to see the distance and its X, Y, and Z components. Esc or the Measure button stops.
import { useEffect, useState } from 'react';
import { Html, Line } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { Raycaster, Vector2, Vector3, type Mesh } from 'three';
import { create } from 'zustand';
import { EDGE_INFO_STRIDE, FACE_INFO_STRIDE } from '../kernel/protocol';
import { formatNum } from '../model/expr';
import type { Vec3 } from '../model/types';
import { useStore } from '../store/store';
import { pickables } from './registry';
import { useSceneColors } from './sceneColors';

interface MeasureState {
  active: boolean;
  points: Vec3[];
  /** Snapped point under the cursor. */
  hover: { p: Vec3; kind: 'corner' | 'middle' | 'center' | 'surface' } | null;
}

export const useMeasure = create<MeasureState>(() => ({ active: false, points: [], hover: null }));

export function toggleMeasure(on = !useMeasure.getState().active) {
  useMeasure.setState({ active: on, points: [], hover: null });
  if (on) useStore.getState().select(null);
}

export const isMeasuring = () => useMeasure.getState().active;

const SNAP_PX = 12;

export function MeasureLayer() {
  const m = useMeasure();
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  const colors = useSceneColors();
  const [, force] = useState(0);

  useEffect(() => {
    if (!m.active) return;
    const el = gl.domElement;
    let down: { x: number; y: number } | null = null;

    const snapAt = (e: PointerEvent): MeasureState['hover'] => {
      const rect = el.getBoundingClientRect();
      const ndc = new Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      const ray = new Raycaster();
      ray.setFromCamera(ndc, camera);
      const { doc } = useStore.getState();
      const entries = [...pickables.values()].filter((p) => !doc.parts[p.partId]?.hidden);
      const hit = ray.intersectObjects(entries.map((p) => p.mesh as Mesh), false)[0];
      // Snap candidates from every visible part: edge ends and middles, face centers.
      const toScreen = (v: Vec3) => {
        const q = new Vector3(...v).project(camera);
        return [((q.x + 1) / 2) * rect.width, ((1 - q.y) / 2) * rect.height];
      };
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      let best: MeasureState['hover'] = null;
      let bestD = SNAP_PX;
      const consider = (p: Vec3, kind: 'corner' | 'middle' | 'center') => {
        const [sx, sy] = toScreen(p);
        const d = Math.hypot(sx - mx, sy - my);
        // Hidden behind the surface under the cursor? Skip it.
        if (hit && new Vector3(...p).distanceTo(camera.position) > hit.distance + 1e-3 * hit.distance + 0.5) return;
        if (d < bestD || (Math.abs(d - bestD) < 2 && kind === 'corner')) {
          bestD = d;
          best = { p, kind };
        }
      };
      for (const en of entries) {
        const info = en.data.edgeInfo;
        for (let i = 0; i + EDGE_INFO_STRIDE <= info.length; i += EDGE_INFO_STRIDE) {
          consider([info[i + 3], info[i + 4], info[i + 5]], 'corner');
          consider([info[i + 6], info[i + 7], info[i + 8]], 'corner');
          consider([info[i], info[i + 1], info[i + 2]], 'middle');
        }
        const faces = en.data.faceInfo;
        for (let i = 0; i + FACE_INFO_STRIDE <= faces.length; i += FACE_INFO_STRIDE) consider([faces[i], faces[i + 1], faces[i + 2]], 'center');
      }
      if (best) return best;
      return hit ? { p: hit.point.toArray() as Vec3, kind: 'surface' } : null;
    };

    const onMove = (e: PointerEvent) => {
      if (e.buttons) return;
      useMeasure.setState({ hover: snapAt(e) });
      invalidate();
    };
    const onDown = (e: PointerEvent) => {
      down = { x: e.clientX, y: e.clientY };
    };
    const onUp = (e: PointerEvent) => {
      if (!down || e.button !== 0) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5;
      down = null;
      if (moved) return;
      const h = snapAt(e);
      if (!h) return;
      const pts = useMeasure.getState().points;
      useMeasure.setState({ points: pts.length >= 2 ? [h.p] : [...pts, h.p] });
      force((x) => x + 1);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') toggleMeasure(false);
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointerup', onUp);
    window.addEventListener('keydown', onKey);
    return () => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointerup', onUp);
      window.removeEventListener('keydown', onKey);
    };
  }, [m.active, gl, camera, invalidate]);

  if (!m.active) return null;
  const [a, b] = m.points;
  const d = a && b ? new Vector3(...b).sub(new Vector3(...a)) : null;
  return (
    <>
      {m.hover && (
        <mesh position={m.hover.p} renderOrder={40}>
          <sphereGeometry args={[0.6, 12, 8]} />
          <meshBasicMaterial color={m.hover.kind === 'surface' ? colors.hover : colors.accent} depthTest={false} />
        </mesh>
      )}
      {m.points.map((p, i) => (
        <mesh key={i} position={p} renderOrder={41}>
          <sphereGeometry args={[0.8, 14, 10]} />
          <meshBasicMaterial color={colors.accent} depthTest={false} />
        </mesh>
      ))}
      {a && !b && m.hover && <Line points={[a, m.hover.p]} color={colors.accent} lineWidth={1.5} dashed dashSize={1} gapSize={0.8} depthTest={false} renderOrder={40} />}
      {a && b && d && (
        <>
          <Line points={[a, b]} color={colors.accent} lineWidth={2.5} depthTest={false} renderOrder={40} />
          {/* The X, Y, and Z legs, so the components are easy to read. */}
          <Line points={[a, [b[0], a[1], a[2]], [b[0], b[1], a[2]], b]} color={colors.edge} lineWidth={1} dashed dashSize={1} gapSize={0.8} depthTest={false} renderOrder={39} />
          <Html position={[(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]} center zIndexRange={[40, 30]}>
            <div className="measure-chip">
              <strong>{formatNum(d.length(), 3)} mm</strong>
              <span>
                X {formatNum(d.x, 2)} · Y {formatNum(d.y, 2)} · Z {formatNum(d.z, 2)}
              </span>
            </div>
          </Html>
        </>
      )}
    </>
  );
}
