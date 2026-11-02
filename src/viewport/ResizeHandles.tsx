// Tinkercad-style handles for the selected part(s): footprint corners and sides resize, the top
// square sets the height, the cone lifts, the arc rotates, and the size labels take exact values.
import { useEffect, useMemo, useState } from 'react';
import { Html, Line } from '@react-three/drei';
import { Matrix4, Plane, Quaternion, Vector3, type Ray } from 'three';
import { insertFeature, replaceFeature } from '../model/docOps';
import { evalNum, formatNum } from '../model/expr';
import type { Vec3 } from '../model/types';
import { resizeFrame, type ResizeFrame } from '../store/resize';
import { useStore } from '../store/store';
import { bodyDrag, closestOnAxis, Handle, type DragSession } from './handles';
import { liveMove } from './liveMove';
import { useSceneColors } from './sceneColors';

type Side = -1 | 0 | 1;
interface Box {
  min: Vector3;
  max: Vector3;
}

const snapStep = () => useStore.getState().prefs.snap;
const snapLen = (v: number) => {
  const s = snapStep();
  return s > 0 ? Math.max(s, Math.round(v / s) * s) : Math.max(v, 0.01);
};
const snapDelta = (v: number) => {
  const s = snapStep();
  return s > 0 ? Math.round(v / s) * s : v;
};

function useSelectionIds() {
  const sel = useStore((s) => s.sel);
  const draft = useStore((s) => s.draft);
  const parts = useStore((s) => s.parts);
  return useMemo(() => {
    const raw = draft ? (draft.feature.type === 'primitive' ? [draft.feature.id] : []) : sel.filter((x) => x.kind === 'part').map((x) => x.part);
    return raw.filter((id) => parts.some((p) => p.id === id));
  }, [draft, sel, parts]);
}

function useFrame3(ids: string[]): ResizeFrame | null {
  const draft = useStore((s) => s.draft);
  const doc = useStore((s) => s.doc);
  const parts = useStore((s) => s.parts);
  const scope = useStore((s) => s.varValues);
  return useMemo(() => {
    if (!ids.length) return null;
    const d =
      draft?.feature.type === 'primitive' ? (draft.isNew ? insertFeature(doc, draft.feature, draft.index) : replaceFeature(doc, draft.feature)) : doc;
    return resizeFrame(ids, d, parts, scope);
  }, [ids, draft, doc, parts, scope]);
}

export function ResizeHandles() {
  const mode = useStore((s) => s.gizmo);
  const ids = useSelectionIds();
  const frame = useFrame3(ids);
  const colors = useSceneColors();
  const [live, setLive] = useState<Box | null>(null);
  const [busy, setBusy] = useState<'move' | 'rotate' | null>(null);
  const [angle, setAngle] = useState(0);

  const idKey = ids.join('|');
  // Dragging a selected part moves it on its ground plane (works in every gizmo mode).
  useEffect(() => {
    if (!ids.length || !frame) {
      bodyDrag.start = null;
      return;
    }
    const center = frame.min.clone().add(frame.max).multiplyScalar(0.5).applyQuaternion(frame.quat).add(frame.origin);
    bodyDrag.start = (_ray, _e, point) => {
      const plane = new Plane(new Vector3(0, 0, 1), -point.z);
      let delta = new Matrix4();
      setBusy('move');
      return {
        move(r) {
          const p = r.intersectPlane(plane, new Vector3());
          if (!p) return;
          p.sub(point);
          delta = new Matrix4().makeTranslation(snapDelta(p.x), snapDelta(p.y), 0);
          liveMove.set(ids, delta);
        },
        end() {
          setBusy(null);
          useStore.getState().commitMove(ids, delta, center.toArray());
        },
        cancel() {
          setBusy(null);
          liveMove.clear();
        },
      };
    };
    return () => {
      bodyDrag.start = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idKey, frame]);

  if (!frame || mode !== 'handles') return null;
  const { quat, origin } = frame;
  const box = live ?? { min: frame.min, max: frame.max };
  const toWorld = (v: Vector3) => v.clone().applyQuaternion(quat).add(origin);
  const inv = quat.clone().invert();
  const toLocal = (w: Vector3) => w.clone().sub(origin).applyQuaternion(inv);
  const zAxis = new Vector3(0, 0, 1).applyQuaternion(quat);
  const size0 = frame.max.clone().sub(frame.min);
  const maxDim = Math.max(size0.x, size0.y, size0.z, 1);
  const c = box.min.clone().add(box.max).multiplyScalar(0.5);

  const applyLive = (s: Vec3, anchorLocal: Vector3) => {
    const Aw = toWorld(anchorLocal);
    const R = new Matrix4().makeRotationFromQuaternion(quat);
    const M = new Matrix4()
      .makeTranslation(Aw.x, Aw.y, Aw.z)
      .multiply(R)
      .multiply(new Matrix4().makeScale(s[0], s[1], s[2]))
      .multiply(R.clone().invert())
      .multiply(new Matrix4().makeTranslation(-Aw.x, -Aw.y, -Aw.z));
    liveMove.set(ids, M);
    const f = (k: 'x' | 'y' | 'z', i: number, v: number) => anchorLocal[k] + s[i] * (v - anchorLocal[k]);
    setLive({
      min: new Vector3(f('x', 0, frame.min.x), f('y', 1, frame.min.y), f('z', 2, frame.min.z)),
      max: new Vector3(f('x', 0, frame.max.x), f('y', 1, frame.max.y), f('z', 2, frame.max.z)),
    });
  };

  const commit = (s: Vec3, anchorLocal: Vector3, even: number) => {
    setLive(null);
    useStore.getState().commitResize(ids, quat, s, toWorld(anchorLocal).toArray(), even);
  };

  /** Resize from a footprint corner/side (sides on X and Y) or from the top square (Z). */
  const resizeStart =
    (sides: [Side, Side], top: boolean) =>
    (_ray: Ray): DragSession | null => {
      const min0 = frame.min.clone();
      const max0 = frame.max.clone();
      const plane = new Plane().setFromNormalAndCoplanarPoint(zAxis, toWorld(new Vector3(0, 0, min0.z)));
      const axisBase = toWorld(new Vector3((min0.x + max0.x) / 2, (min0.y + max0.y) / 2, 0));
      let S: Vec3 = [1, 1, 1];
      let anchor = min0.clone();
      let even = 1;
      return {
        move(r, ev) {
          const nmin = min0.clone();
          const nmax = max0.clone();
          if (top) {
            const t = closestOnAxis(axisBase, zAxis, r);
            if (t === null) return;
            nmax.z = min0.z + snapLen(t - min0.z);
          } else {
            const hit = r.intersectPlane(plane, new Vector3());
            if (!hit) return;
            const q = toLocal(hit);
            if (sides[0] > 0) nmax.x = min0.x + snapLen(q.x - min0.x);
            if (sides[0] < 0) nmin.x = max0.x - snapLen(max0.x - q.x);
            if (sides[1] > 0) nmax.y = min0.y + snapLen(q.y - min0.y);
            if (sides[1] < 0) nmin.y = max0.y - snapLen(max0.y - q.y);
          }
          const ratio = (k: 'x' | 'y' | 'z') => (size0[k] > 1e-9 ? (nmax[k] - nmin[k]) / size0[k] : 1);
          let s: Vec3 = [ratio('x'), ratio('y'), ratio('z')];
          const dragged = top ? [2] : [0, 1].filter((i) => sides[i] !== 0);
          const k = dragged.reduce((acc, i) => (Math.abs(s[i] - 1) > Math.abs(acc - 1) ? s[i] : acc), 1);
          const uniform = ev.shiftKey || !frame.canStretch;
          if (uniform) s = [k, k, k];
          anchor = new Vector3(
            sides[0] > 0 ? min0.x : sides[0] < 0 ? max0.x : (min0.x + max0.x) / 2,
            sides[1] > 0 ? min0.y : sides[1] < 0 ? max0.y : (min0.y + max0.y) / 2,
            min0.z,
          );
          S = s;
          even = k;
          applyLive(s, anchor);
        },
        end() {
          commit(S, anchor, even);
        },
        cancel() {
          setLive(null);
          liveMove.clear();
        },
      };
    };

  const liftStart = (ray: Ray): DragSession | null => {
    const base = toWorld(new Vector3(c.x, c.y, 0));
    const t0 = closestOnAxis(base, zAxis, ray);
    if (t0 === null) return null;
    let delta = new Matrix4();
    setBusy('move');
    return {
      move(r) {
        const t = closestOnAxis(base, zAxis, r);
        if (t === null) return;
        const d = zAxis.clone().multiplyScalar(snapDelta(t - t0));
        delta = new Matrix4().makeTranslation(d.x, d.y, d.z);
        liveMove.set(ids, delta);
      },
      end() {
        setBusy(null);
        useStore.getState().commitMove(ids, delta, toWorld(c).toArray());
      },
      cancel() {
        setBusy(null);
        liveMove.clear();
      },
    };
  };

  const rotateStart = (ray: Ray): DragSession | null => {
    const center = toWorld(new Vector3(c.x, c.y, frame.min.z));
    const plane = new Plane().setFromNormalAndCoplanarPoint(zAxis, center);
    const p0 = ray.intersectPlane(plane, new Vector3());
    if (!p0) return null;
    const v0 = p0.sub(center);
    let delta = new Matrix4();
    setBusy('rotate');
    setAngle(0);
    return {
      move(r, ev) {
        const p = r.intersectPlane(plane, new Vector3());
        if (!p) return;
        const v = p.sub(center);
        let a = Math.atan2(zAxis.dot(v0.clone().cross(v)), v0.dot(v));
        const step = ((ev.shiftKey ? 1 : 15) * Math.PI) / 180;
        a = Math.round(a / step) * step;
        setAngle((a * 180) / Math.PI);
        delta = new Matrix4()
          .makeTranslation(center.x, center.y, center.z)
          .multiply(new Matrix4().makeRotationFromQuaternion(new Quaternion().setFromAxisAngle(zAxis, a)))
          .multiply(new Matrix4().makeTranslation(-center.x, -center.y, -center.z));
        liveMove.set(ids, delta);
      },
      end() {
        setBusy(null);
        useStore.getState().commitMove(ids, delta, center.toArray());
      },
      cancel() {
        setBusy(null);
        liveMove.clear();
      },
    };
  };

  const commitSize = (axis: 0 | 1 | 2, text: string) => {
    let v: number;
    try {
      v = evalNum(text.trim(), useStore.getState().varValues);
    } catch {
      return;
    }
    const k = 'xyz'[axis] as 'x' | 'y' | 'z';
    if (!(v > 0) || size0[k] < 1e-9) return;
    const f = v / size0[k];
    const s: Vec3 = frame.canStretch ? [1, 1, 1] : [f, f, f];
    s[axis] = f;
    commit(s, frame.min.clone(), f);
  };

  const { min, max } = box;
  const z = min.z;
  const off = Math.max(maxDim * 0.12, 2);
  const corners: [Side, Side, number, number][] = [
    [-1, -1, min.x, min.y],
    [1, -1, max.x, min.y],
    [1, 1, max.x, max.y],
    [-1, 1, min.x, max.y],
  ];
  const mids: [Side, Side, number, number][] = [
    [1, 0, max.x, c.y],
    [-1, 0, min.x, c.y],
    [0, 1, c.x, max.y],
    [0, -1, c.x, min.y],
  ];
  const arcR = Math.hypot(max.x - min.x, max.y - min.y) / 2 + off;
  const arc: [number, number, number][] = [];
  for (let i = 0; i <= 24; i++) {
    const a = -Math.PI / 2 - 0.45 + (0.9 * i) / 24;
    arc.push([c.x + arcR * Math.cos(a), c.y + arcR * Math.sin(a), z]);
  }
  const accent = colors.accent;
  const footprint: [number, number, number][] = [
    [min.x, min.y, z],
    [max.x, min.y, z],
    [max.x, max.y, z],
    [min.x, max.y, z],
    [min.x, min.y, z],
  ];
  const dash = maxDim * 0.035;
  const size = max.clone().sub(min);

  return (
    <group position={origin.toArray()} quaternion={quat.toArray() as [number, number, number, number]}>
      {busy === 'rotate' && (
        <Html position={[c.x, c.y, z]} center zIndexRange={[40, 30]}>
          <div className="dim-chip">{formatNum(angle, 1)}°</div>
        </Html>
      )}
      {!busy && (
        <>
          <Line points={footprint} color={accent} lineWidth={1.3} dashed dashSize={dash} gapSize={dash * 0.7} depthTest={false} renderOrder={15} />
          <Line points={arc} color={accent} lineWidth={2.5} depthTest={false} renderOrder={15} />
          {/* Dimension lines with editable sizes */}
          <Line points={[[min.x, min.y - off, z], [max.x, min.y - off, z]]} color={colors.edge} lineWidth={1} depthTest={false} renderOrder={15} />
          <Line points={[[max.x + off, min.y, z], [max.x + off, max.y, z]]} color={colors.edge} lineWidth={1} depthTest={false} renderOrder={15} />
          <Line points={[[max.x + off, min.y - off, min.z], [max.x + off, min.y - off, max.z]]} color={colors.edge} lineWidth={1} depthTest={false} renderOrder={15} />
          <SizeLabel position={[c.x, min.y - off, z]} value={size.x} onCommit={(t) => commitSize(0, t)} title="Width (X)" />
          <SizeLabel position={[max.x + off, c.y, z]} value={size.y} onCommit={(t) => commitSize(1, t)} title="Depth (Y)" />
          <SizeLabel position={[max.x + off, min.y - off, c.z]} value={size.z} onCommit={(t) => commitSize(2, t)} title="Height (Z)" />

          {corners.map(([sx, sy, x, y]) => (
            <Handle key={`c${sx}${sy}`} id={`rs-c${sx}${sy}`} shape="square" position={[x, y, z]} hoverColor={accent} cursor="nwse-resize" onStart={resizeStart([sx, sy], false)} />
          ))}
          {mids.map(([sx, sy, x, y]) => (
            <Handle key={`m${sx}${sy}`} id={`rs-m${sx}${sy}`} shape="dot" px={8} position={[x, y, z]} hoverColor={accent} cursor={sx ? 'ew-resize' : 'ns-resize'} onStart={resizeStart([sx, sy], false)} />
          ))}
          <Handle id="rs-top" shape="square" position={[c.x, c.y, max.z]} hoverColor={accent} cursor="ns-resize" onStart={resizeStart([0, 0], true)} />
          <Handle id="rs-lift" shape="cone" px={16} position={[c.x, c.y, max.z + off]} hoverColor={accent} cursor="ns-resize" onStart={liftStart} />
          <Handle id="rs-rot" shape="sphere" px={13} color={accent} position={[c.x, c.y - arcR, z]} hoverColor={colors.hover} cursor="grab" onStart={rotateStart} />
        </>
      )}
    </group>
  );
}

function SizeLabel({ position, value, onCommit, title }: { position: [number, number, number]; value: number; onCommit: (text: string) => void; title: string }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  return (
    <Html position={position} center zIndexRange={[40, 30]}>
      {editing ? (
        <input
          className="dim-input"
          autoFocus
          value={text}
          aria-label={title}
          onChange={(e) => setText(e.target.value)}
          onFocus={(e) => e.target.select()}
          onBlur={() => setEditing(false)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') {
              onCommit(text);
              setEditing(false);
            }
            if (e.key === 'Escape') setEditing(false);
          }}
        />
      ) : (
        <button
          className="dim-chip"
          title={`${title}: click to type an exact size`}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => {
            setText(formatNum(value, 2));
            setEditing(true);
          }}
        >
          {formatNum(value, 2)}
        </button>
      )}
    </Html>
  );
}
