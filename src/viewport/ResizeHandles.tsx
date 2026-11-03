// Tinkercad-style handles for the selected part(s): footprint corners and sides resize, the top
// square sets the height, the cone lifts, three arcs rotate (with a protractor), and the size labels
// take exact values. In the Pro interaction style, dragging the body of a part doesn't move it.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Html, Line } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { Matrix4, Plane, Quaternion, Vector3, type Group, type Ray } from 'three';
import { insertFeature, replaceFeature } from '../model/docOps';
import { isPlaced } from '../model/defaults';
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
    const raw = draft ? (isPlaced(draft.feature) ? [draft.feature.id] : []) : sel.filter((x) => x.kind === 'part').map((x) => x.part);
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
      isPlaced(draft?.feature) ? (draft!.isNew ? insertFeature(doc, draft!.feature, draft!.index) : replaceFeature(doc, draft!.feature)) : doc;
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
  const [rot, setRot] = useState<Protractor | null>(null);
  const [shift, setShift] = useState<Vec3 | null>(null);
  const style = useStore((s) => s.prefs.interaction);
  const invalidate = useThree((s) => s.invalidate);

  // During move, lift, and rotate drags the handles ride along with the part's live preview
  // (resizes redraw the box instead). It stays applied until the rebuilt geometry arrives.
  const follow = useRef<Group | null>(null);
  const following = useRef(false);
  useEffect(() => {
    const apply = () => {
      const g = follow.current;
      if (!g) return;
      if (following.current && liveMove.parts.length) g.matrix.copy(liveMove.matrix);
      else {
        following.current = false;
        g.matrix.identity();
      }
      g.matrixWorldNeedsUpdate = true;
      invalidate();
    };
    return liveMove.subscribe(apply);
  }, [invalidate]);
  const startFollowing = (kind: 'move' | 'rotate') => {
    following.current = true;
    setBusy(kind);
  };

  const idKey = ids.join('|');
  // Tinkercad style: dragging a selected part moves it on its ground plane (in every gizmo mode).
  useEffect(() => {
    if (!ids.length || !frame || style !== 'tinkercad') {
      bodyDrag.start = null;
      return;
    }
    const center = frame.min.clone().add(frame.max).multiplyScalar(0.5).applyQuaternion(frame.quat).add(frame.origin);
    bodyDrag.start = (_ray, _e, point) => {
      const plane = new Plane(new Vector3(0, 0, 1), -point.z);
      let delta = new Matrix4();
      startFollowing('move');
      return {
        move(r) {
          const p = r.intersectPlane(plane, new Vector3());
          if (!p) return;
          p.sub(point);
          const d: Vec3 = [snapDelta(p.x), snapDelta(p.y), 0];
          delta = new Matrix4().makeTranslation(...d);
          setShift(d);
          liveMove.set(ids, delta);
        },
        end() {
          setBusy(null);
          setShift(null);
          useStore.getState().commitMove(ids, delta, center.toArray());
        },
        cancel() {
          setBusy(null);
          setShift(null);
          liveMove.clear();
        },
      };
    };
    return () => {
      bodyDrag.start = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idKey, frame, style]);

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
            if (ev.altKey) {
              // Alt resizes from the center, so both opposite sides move.
              for (const [i, k] of [[0, 'x'], [1, 'y']] as const) {
                if (!sides[i]) continue;
                const mid = (min0[k] + max0[k]) / 2;
                const half = snapLen(2 * Math.abs(q[k] - mid)) / 2;
                nmin[k] = mid - half;
                nmax[k] = mid + half;
              }
            } else {
              if (sides[0] > 0) nmax.x = min0.x + snapLen(q.x - min0.x);
              if (sides[0] < 0) nmin.x = max0.x - snapLen(max0.x - q.x);
              if (sides[1] > 0) nmax.y = min0.y + snapLen(q.y - min0.y);
              if (sides[1] < 0) nmin.y = max0.y - snapLen(max0.y - q.y);
            }
          }
          const ratio = (k: 'x' | 'y' | 'z') => (size0[k] > 1e-9 ? (nmax[k] - nmin[k]) / size0[k] : 1);
          let s: Vec3 = [ratio('x'), ratio('y'), ratio('z')];
          const dragged = top ? [2] : [0, 1].filter((i) => sides[i] !== 0);
          const k = dragged.reduce((acc, i) => (Math.abs(s[i] - 1) > Math.abs(acc - 1) ? s[i] : acc), 1);
          const uniform = ev.shiftKey || !frame.canStretch;
          if (uniform) s = [k, k, k];
          const fromCenter = ev.altKey && !top;
          anchor = new Vector3(
            sides[0] > 0 && !fromCenter ? min0.x : sides[0] < 0 && !fromCenter ? max0.x : (min0.x + max0.x) / 2,
            sides[1] > 0 && !fromCenter ? min0.y : sides[1] < 0 && !fromCenter ? max0.y : (min0.y + max0.y) / 2,
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
    startFollowing('move');
    return {
      move(r) {
        const t = closestOnAxis(base, zAxis, r);
        if (t === null) return;
        const d = zAxis.clone().multiplyScalar(snapDelta(t - t0));
        delta = new Matrix4().makeTranslation(d.x, d.y, d.z);
        setShift(d.toArray());
        liveMove.set(ids, delta);
      },
      end() {
        setBusy(null);
        setShift(null);
        useStore.getState().commitMove(ids, delta, toWorld(c).toArray());
      },
      cancel() {
        setBusy(null);
        setShift(null);
        liveMove.clear();
      },
    };
  };

  const rotateStart =
    (axis: 0 | 1 | 2) =>
    (ray: Ray): DragSession | null => {
      const arc = arcFor(axis);
      const normal = arc.u.clone().cross(arc.v).applyQuaternion(quat).normalize();
      const center = toWorld(arc.center);
      const plane = new Plane().setFromNormalAndCoplanarPoint(normal, center);
      const p0 = ray.intersectPlane(plane, new Vector3());
      if (!p0) return null;
      const v0 = p0.sub(center);
      const radius = arc.r * 1.15;
      let delta = new Matrix4();
      following.current = false;
      setBusy('rotate');
      const show = (a: number, fine: boolean) => setRot({ center, normal, start: v0.clone().normalize(), radius, angle: a, fine, axis });
      show(0, false);
      return {
        move(r, ev) {
          const p = r.intersectPlane(plane, new Vector3());
          if (!p) return;
          const v = p.sub(center);
          let a = Math.atan2(normal.dot(v0.clone().cross(v)), v0.dot(v));
          // Like Tinkercad: on or outside the protractor ring it snaps to 22.5 degrees, inside to 1 (Shift: 1 anywhere).
          const fine = ev.shiftKey || v.length() < radius * 0.8;
          const step = ((fine ? 1 : 22.5) * Math.PI) / 180;
          a = Math.round(a / step) * step;
          show(a, fine);
          delta = new Matrix4()
            .makeTranslation(center.x, center.y, center.z)
            .multiply(new Matrix4().makeRotationFromQuaternion(new Quaternion().setFromAxisAngle(normal, a)))
            .multiply(new Matrix4().makeTranslation(-center.x, -center.y, -center.z));
          liveMove.set(ids, delta);
        },
        end() {
          setBusy(null);
          setRot(null);
          useStore.getState().commitMove(ids, delta, center.toArray());
        },
        cancel() {
          setBusy(null);
          setRot(null);
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
  /** Where each rotate arc sits: its center, the plane it lies in (u, v), its radius, and which way it faces. */
  function arcFor(axis: 0 | 1 | 2) {
    const sx = max.x - min.x;
    const sy = max.y - min.y;
    const sz = max.z - min.z;
    // Z turns on the floor at the front, Y over the top left, X over the top back, so the three never overlap.
    if (axis === 2) return { center: new Vector3(c.x, c.y, min.z), u: new Vector3(1, 0, 0), v: new Vector3(0, 1, 0), r: Math.hypot(sx, sy) / 2 + off, mid: -Math.PI / 2 };
    if (axis === 1) return { center: c.clone(), u: new Vector3(0, 0, 1), v: new Vector3(1, 0, 0), r: Math.hypot(sx, sz) / 2 + off, mid: -Math.PI / 4 };
    return { center: c.clone(), u: new Vector3(0, 1, 0), v: new Vector3(0, 0, 1), r: Math.hypot(sy, sz) / 2 + off, mid: Math.PI / 4 };
  }
  const arcs = ([2, 1, 0] as const).map((axis) => {
    const f = arcFor(axis);
    const at = (t: number) => f.center.clone().addScaledVector(f.u, f.r * Math.cos(t)).addScaledVector(f.v, f.r * Math.sin(t));
    const points: [number, number, number][] = [];
    for (let i = 0; i <= 24; i++) points.push(at(f.mid - 0.45 + (0.9 * i) / 24).toArray());
    return { axis, points, dot: at(f.mid).toArray() as [number, number, number] };
  });
  const axisColor = [colors.axisX, colors.axisY, colors.axisZ];
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
  const pro = style === 'pro';

  return (
    <>
      {rot && <ProtractorView p={rot} color={axisColor[rot.axis]} text={colors.edge} />}
      <group ref={follow} matrixAutoUpdate={false}>
        <group position={origin.toArray()} quaternion={quat.toArray() as [number, number, number, number]}>
          {shift && (
            <Html position={[c.x, c.y, max.z + off * 1.9]} center zIndexRange={[40, 30]}>
              <div className="dim-chip active">
                {Math.abs(shift[2]) > 1e-9 && !shift[0] && !shift[1]
                  ? `Z ${shift[2] > 0 ? '+' : ''}${formatNum(shift[2], 2)}`
                  : `X ${formatNum(shift[0], 2)} · Y ${formatNum(shift[1], 2)}`}
              </div>
            </Html>
          )}
          {busy !== 'rotate' && (
            <>
              <Line points={footprint} color={accent} lineWidth={1.3} dashed dashSize={dash} gapSize={dash * 0.7} depthTest={false} renderOrder={15} />
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
              {/* Pro has its own arrows and rings for moving and turning, so its box only resizes. */}
              {!pro && <Handle id="rs-lift" shape="cone" px={16} position={[c.x, c.y, max.z + off]} hoverColor={accent} cursor="ns-resize" onStart={liftStart} />}
              {!pro &&
                arcs.map((a) => (
                  <group key={a.axis}>
                    <Line points={a.points} color={axisColor[a.axis]} lineWidth={2.5} depthTest={false} renderOrder={15} />
                    <Handle id={`rs-rot${a.axis}`} shape="sphere" px={13} color={axisColor[a.axis]} position={a.dot} hoverColor={colors.hover} cursor="grab" onStart={rotateStart(a.axis)} />
                  </group>
                ))}
            </>
          )}
        </group>
      </group>
    </>
  );
}

interface Protractor {
  axis: 0 | 1 | 2;
  center: Vector3;
  normal: Vector3;
  /** Unit vector from the center to where the drag started. */
  start: Vector3;
  radius: number;
  angle: number;
  /** True while the cursor is inside the ring, where rotation snaps to 1 degree instead of 22.5. */
  fine: boolean;
}

/** Tinkercad-style protractor shown while a rotate arc is dragged. */
function ProtractorView({ p, color, text }: { p: Protractor; color: string; text: string }) {
  const { center, normal, start, radius, angle, fine } = p;
  const side = normal.clone().cross(start).normalize();
  const at = (t: number, r: number) => center.clone().addScaledVector(start, r * Math.cos(t)).addScaledVector(side, r * Math.sin(t)).toArray() as [number, number, number];
  const ring = (r: number) => Array.from({ length: 97 }, (_, i) => at((i / 96) * Math.PI * 2, r));
  const ticks: [number, number, number][][] = [];
  for (let i = 0; i < 16; i++) {
    const t = (i * Math.PI) / 8;
    ticks.push([at(t, radius * (i % 4 === 0 ? 0.88 : 0.93)), at(t, radius)]);
  }
  const fineTicks: [number, number, number][][] = [];
  for (let i = 0; i < 72; i++) {
    const t = (i * Math.PI) / 36;
    fineTicks.push([at(t, radius * 0.8), at(t, radius * (i % 2 ? 0.77 : 0.74))]);
  }
  const sweep = Array.from({ length: 33 }, (_, i) => at((angle * i) / 32, radius * 0.6));
  const deg = (angle * 180) / Math.PI;
  return (
    <group renderOrder={20}>
      <Line points={ring(radius)} color={color} lineWidth={fine ? 1 : 2} transparent opacity={fine ? 0.5 : 0.95} depthTest={false} renderOrder={20} />
      <Line points={ring(radius * 0.8)} color={color} lineWidth={fine ? 2 : 1} transparent opacity={fine ? 0.95 : 0.5} depthTest={false} renderOrder={20} />
      {ticks.map((t, i) => (
        <Line key={`t${i}`} points={t} color={color} lineWidth={1.5} depthTest={false} renderOrder={20} />
      ))}
      {fineTicks.map((t, i) => (
        <Line key={`f${i}`} points={t} color={color} lineWidth={1} transparent opacity={0.6} depthTest={false} renderOrder={20} />
      ))}
      <Line points={[center.toArray() as [number, number, number], at(0, radius)]} color={text} lineWidth={1} dashed dashSize={radius * 0.04} gapSize={radius * 0.03} depthTest={false} renderOrder={20} />
      <Line points={[center.toArray() as [number, number, number], at(angle, radius)]} color={color} lineWidth={2} depthTest={false} renderOrder={20} />
      {Math.abs(angle) > 1e-6 && <Line points={sweep} color={color} lineWidth={3} depthTest={false} renderOrder={20} />}
      <Html position={at(angle, radius * 1.18)} center zIndexRange={[40, 30]}>
        <div className="dim-chip active">
          {deg > 0 ? '+' : ''}
          {formatNum(deg, 1)}°<span className="chip-hint">{fine ? ' 1° steps' : ' 22.5° steps'}</span>
        </div>
      </Html>
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
