// Tinkercad-style shape creation: drag a shape button from the ribbon and drop it on the plate,
// or onto any face of another part (it stands on that face).
import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import { currentSeq } from '../kernel/seq';
import { createPrimitive } from '../model/defaults';
import type { PrimitiveKind, Vec3 } from '../model/types';
import { useStore } from '../store/store';
import { liveMove } from '../viewport/liveMove';
import { viewApi } from '../viewport/viewApi';

const R2D = 180 / Math.PI;
const r4 = (v: number) => Math.round(v * 1e4) / 1e4 + 0;

interface Pose {
  position: Vec3;
  rotation: Vec3;
}

function poseFromDrop(drop: { point: Vec3; normal: Vec3 }): Pose {
  const n = new Vector3(...drop.normal).normalize();
  const snap = useStore.getState().prefs.snap;
  const s = (v: number) => (snap > 0 ? Math.round(v / snap) * snap : v);
  if (n.z > 0.985) {
    // Flat on the plate or on a top face: snap to the grid.
    return { position: [r4(s(drop.point[0])), r4(s(drop.point[1])), r4(drop.point[2])], rotation: [0, 0, 0] };
  }
  // On a sloped or vertical face: stand the shape on it, its "up" along the face normal.
  const q = new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), n);
  const e = new Euler().setFromQuaternion(q, 'ZYX');
  return { position: drop.point.map(r4) as Vec3, rotation: [r4(e.x * R2D), r4(e.y * R2D), r4(e.z * R2D)] };
}

function poseMatrix(p: Pose): Matrix4 {
  const q = new Quaternion().setFromEuler(new Euler(p.rotation[0] / R2D, p.rotation[1] / R2D, p.rotation[2] / R2D, 'ZYX'));
  return new Matrix4().compose(new Vector3(...p.position), q, new Vector3(1, 1, 1));
}

let suppressClick = false;

/** True once after a drag ended, so the button's click handler can ignore the release. */
export function consumeDragClick(): boolean {
  const v = suppressClick;
  suppressClick = false;
  return v;
}

export function startShapeDrag(kind: PrimitiveKind, e: React.PointerEvent<HTMLElement>) {
  if (e.button !== 0) return;
  const el = e.currentTarget;
  const pointerId = e.pointerId;
  const sx = e.clientX;
  const sy = e.clientY;
  let dragging = false;
  let created: { id: string; base: Matrix4 } | null = null;
  let pose: Pose | null = null;
  try {
    el.setPointerCapture(pointerId);
  } catch {
    // capture isn't essential
  }

  const move = (ev: PointerEvent) => {
    if (!dragging) {
      if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 6) return;
      dragging = true;
      document.body.classList.add('dragging-shape');
    }
    const drop = viewApi.dropAt(ev.clientX, ev.clientY, created?.id);
    document.body.classList.toggle('drop-ok', !!drop);
    if (!drop) return;
    pose = poseFromDrop(drop);
    const s = useStore.getState();
    if (!created) {
      if (s.draft) s.cancelDraft();
      const f = createPrimitive(kind, useStore.getState().doc.features, pose.position);
      f.placement.rotation = pose.rotation;
      useStore.getState().startFeature(f);
      created = { id: f.id, base: poseMatrix(pose) };
    } else {
      liveMove.set([created.id], poseMatrix(pose).multiply(created.base.clone().invert()));
    }
  };

  const up = (ev: PointerEvent) => {
    el.removeEventListener('pointermove', move);
    el.removeEventListener('pointerup', up);
    el.removeEventListener('pointercancel', up);
    document.body.classList.remove('dragging-shape', 'drop-ok');
    if (!dragging) return;
    suppressClick = true;
    setTimeout(() => (suppressClick = false), 300);
    const s = useStore.getState();
    if (!created) return;
    const over = ev.type === 'pointerup' && viewApi.dropAt(ev.clientX, ev.clientY, created.id);
    if (!over || !pose) {
      s.cancelDraft();
      return;
    }
    const final = pose;
    s.patchDraft((f) => (f.type === 'primitive' ? { ...f, placement: { ...f.placement, position: final.position, rotation: final.rotation } } : f));
    useStore.getState().confirmDraft();
    liveMove.hold(currentSeq());
  };

  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
}
