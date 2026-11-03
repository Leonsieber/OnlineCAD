// Sketch editing in the 3D view (Onshape style): draw lines, rectangles, circles, and arcs on the
// sketch plane, snap to points and lines, drag geometry while the constraints hold, and type exact
// dimensions. Everything is drawn in the sketch's own 2D coordinates inside one transformed group.
// Finished sketches that no feature uses yet are drawn too, so you can see what Extrude will take.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Grid, Html, Line } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { BufferAttribute, BufferGeometry, DoubleSide, Matrix4, Plane, Raycaster, Shape, Vector2, Vector3, Path } from 'three';
import { evalNum, formatNum } from '../model/expr';
import type { SkConstraint, SkEntity, SketchFeature } from '../model/types';
import { ccwSweep, sketchProfiles, type P2 } from '../sketch/profiles';
import {
  activeSketch,
  addPoint,
  applyEdit,
  current,
  deleteItems,
  eid,
  frameOf,
  resolveActive,
  useSketchUi,
  withConstraint,
} from '../sketch/sketchUi';
import type { SketchGeometry } from '../sketch/solver';
import { useStore } from '../store/store';
import { useSceneColors } from './sceneColors';
import { viewApi } from './viewApi';

const SNAP_PX = 10;
const HIT_PX = 7;
const D2R = Math.PI / 180;

// ---------------------------------------------------------------- shared geometry helpers

function pointMap(g: SketchGeometry) {
  return new Map(g.points.map((p) => [p.id, p]));
}

/** Polyline of an entity in sketch coordinates. */
function entityPolyline(e: SkEntity, pts: ReturnType<typeof pointMap>): P2[] {
  const P = (id: string): P2 => {
    const p = pts.get(id);
    return p ? [p.x, p.y] : [0, 0];
  };
  if (e.type === 'line') return [P(e.a), P(e.b)];
  const c = P(e.c);
  if (e.type === 'circle') {
    return Array.from({ length: 65 }, (_, i) => [c[0] + e.r * Math.cos((i / 64) * Math.PI * 2), c[1] + e.r * Math.sin((i / 64) * Math.PI * 2)] as P2);
  }
  const a = P(e.a);
  const r = Math.hypot(a[0] - c[0], a[1] - c[1]);
  const a0 = Math.atan2(a[1] - c[1], a[0] - c[0]);
  const sweep = ccwSweep(c, a, P(e.b));
  return Array.from({ length: 33 }, (_, i) => [c[0] + r * Math.cos(a0 + (sweep * i) / 32), c[1] + r * Math.sin(a0 + (sweep * i) / 32)] as P2);
}

function regionShapes(g: SketchGeometry): Shape[] {
  try {
    const { regions } = sketchProfiles(g);
    return regions.map((r) => {
      const s = new Shape(r.outer.poly.map(([x, y]) => new Vector2(x, y)));
      s.holes = r.holes.map((h) => new Path(h.poly.map(([x, y]) => new Vector2(x, y))));
      return s;
    });
  } catch {
    return [];
  }
}

function frameMatrix(f: SketchFeature, offset: number): Matrix4 {
  const fr = frameOf(f, offset);
  return new Matrix4()
    .makeBasis(new Vector3(...fr.xDir), new Vector3(...fr.yDir), new Vector3(...fr.normal))
    .setPosition(...fr.origin);
}

function offsetOf(f: SketchFeature, scope: Record<string, number>) {
  try {
    return evalNum(f.offset ?? 0, scope);
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------- finished sketches


/** Sketches no later feature uses yet, drawn as thin lines with their regions shaded. */
export function SketchOverlays() {
  const doc = useStore((s) => s.doc);
  const draft = useStore((s) => s.draft);
  const scope = useStore((s) => s.varValues);
  const colors = useSceneColors();
  const shown = useMemo(() => {
    const active = doc.features.slice(0, doc.rollback);
    const used = new Set(active.flatMap((f) => (f.type === 'extrude' || f.type === 'revolve' ? [f.sketch] : f.type === 'sweep' ? [f.sketch, f.path] : f.type === 'loft' ? f.sketches : [])));
    return active.filter((f): f is SketchFeature => f.type === 'sketch' && !f.suppressed && !used.has(f.id) && f.id !== draft?.feature.id);
  }, [doc, draft]);
  return (
    <>
      {shown.map((f) => (
        <SketchView key={f.id} f={f} offset={offsetOf(f, scope)} color={colors.axisZ} faint />
      ))}
    </>
  );
}

function SketchView({ f, offset, color, faint }: { f: SketchFeature; offset: number; color: string; faint?: boolean }) {
  const matrix = useMemo(() => frameMatrix(f, offset), [f, offset]);
  const pts = useMemo(() => pointMap(f), [f]);
  const shapes = useMemo(() => regionShapes(f), [f]);
  return (
    <group matrix={matrix} matrixAutoUpdate={false}>
      {shapes.length > 0 && (
        <mesh renderOrder={4}>
          <shapeGeometry args={[shapes]} />
          <meshBasicMaterial color={color} transparent opacity={faint ? 0.12 : 0.18} side={DoubleSide} depthWrite={false} />
        </mesh>
      )}
      {f.entities.map((e) => (
        <Line
          key={e.id}
          points={entityPolyline(e, pts).map(([x, y]) => [x, y, 0] as [number, number, number])}
          color={color}
          lineWidth={faint ? 1.2 : 2}
          dashed={!!e.construction}
          dashSize={2}
          gapSize={1.5}
          transparent
          opacity={e.construction ? 0.5 : 0.9}
          renderOrder={5}
        />
      ))}
    </group>
  );
}

// ---------------------------------------------------------------- the editor

interface Snap {
  x: number;
  y: number;
  /** An existing point under the cursor. */
  point?: string;
  /** An entity under the cursor (the new point gets a "point on" constraint). */
  on?: string;
  /** Inferred horizontal or vertical alignment with the previous click. */
  hv?: 'h' | 'v';
}

interface Hit {
  kind: 'point' | 'entity';
  id: string;
}

type Pending = Snap[];

export function SketchEditor() {
  const draft = useStore((s) => s.draft);
  const f = draft?.feature.type === 'sketch' && draft.field !== 'faces' ? draft.feature : null;
  if (!f) return null;
  return <Editor f={f} />;
}

function Editor({ f }: { f: SketchFeature }) {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  const scope = useStore((s) => s.varValues);
  const snapStep = useStore((s) => s.prefs.snap);
  const colors = useSceneColors();
  const ui = useSketchUi();
  const offset = offsetOf(f, scope);
  const frame = useMemo(() => frameOf(f, offset), [f, offset]);
  const matrix = useMemo(() => frameMatrix(f, offset), [f, offset]);
  const pts = useMemo(() => pointMap(f), [f]);
  const shapes = useMemo(() => regionShapes(f), [f]);
  const [pending, setPending] = useState<Pending>([]);
  const [cursor, setCursor] = useState<Snap | null>(null);
  const [dimFirst, setDimFirst] = useState<Hit | null>(null);
  const live = useRef({ f, pending, dimFirst, frame, ui, snapStep });
  live.current = { f, pending, dimFirst, frame, ui, snapStep };

  // Look straight at the sketch when it opens (or its plane changes).
  const planeKey = `${f.frame.origin}|${f.frame.normal}|${offset}`;
  useEffect(() => {
    const fr = frame;
    const box = f.points.length > 1 ? f.points : null;
    let radius = 60;
    let cx = 0;
    let cy = 0;
    if (box) {
      const xs = box.map((p) => p.x);
      const ys = box.map((p) => p.y);
      cx = (Math.min(...xs) + Math.max(...xs)) / 2;
      cy = (Math.min(...ys) + Math.max(...ys)) / 2;
      radius = Math.max(40, Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) * 0.75);
    }
    viewApi.lookAlong(fr.normal, fr.yDir, fr.toWorld(cx, cy), radius);
    resolveActive();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planeKey]);

  // Clear in-progress drawing when the tool changes.
  useEffect(() => {
    setPending([]);
    setDimFirst(null);
  }, [ui.tool]);

  // ---- screen-space helpers
  const toScreen = (x: number, y: number) => {
    const rect = gl.domElement.getBoundingClientRect();
    const v = new Vector3(...frame.toWorld(x, y)).project(camera);
    return [((v.x + 1) / 2) * rect.width, ((1 - v.y) / 2) * rect.height] as P2;
  };
  const eventToSketch = (e: PointerEvent | MouseEvent): P2 | null => {
    const rect = gl.domElement.getBoundingClientRect();
    const ray = new Raycaster();
    ray.setFromCamera(new Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1), camera);
    const plane = new Plane().setFromNormalAndCoplanarPoint(new Vector3(...frame.normal), new Vector3(...frame.origin));
    const hit = ray.ray.intersectPlane(plane, new Vector3());
    return hit ? frame.toSketch(hit.toArray() as [number, number, number]) : null;
  };
  const mouseLocal = (e: PointerEvent | MouseEvent): P2 => {
    const rect = gl.domElement.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  };

  /** What's under the cursor: points win over lines and curves. */
  const hitTest = (e: PointerEvent | MouseEvent, skip: Set<string> = new Set()): Hit | null => {
    const m = mouseLocal(e);
    let best: Hit | null = null;
    let bestD = SNAP_PX;
    for (const p of live.current.f.points) {
      if (skip.has(p.id)) continue;
      const s = toScreen(p.x, p.y);
      const d = Math.hypot(s[0] - m[0], s[1] - m[1]);
      if (d < bestD) {
        bestD = d;
        best = { kind: 'point', id: p.id };
      }
    }
    if (best) return best;
    bestD = HIT_PX;
    const pm = pointMap(live.current.f);
    for (const en of live.current.f.entities) {
      if (skip.has(en.id)) continue;
      const poly = entityPolyline(en, pm).map(([x, y]) => toScreen(x, y));
      for (let i = 0; i + 1 < poly.length; i++) {
        const d = segDist(m, poly[i], poly[i + 1]);
        if (d < bestD) {
          bestD = d;
          best = { kind: 'entity', id: en.id };
        }
      }
    }
    return best;
  };

  const snapAt = (e: PointerEvent | MouseEvent, from?: Snap): Snap | null => {
    const raw = eventToSketch(e);
    if (!raw) return null;
    const hit = hitTest(e);
    const cur = live.current.f;
    if (hit?.kind === 'point') {
      const p = cur.points.find((q) => q.id === hit.id)!;
      return { x: p.x, y: p.y, point: p.id };
    }
    if (hit?.kind === 'entity') {
      const en = cur.entities.find((q) => q.id === hit.id)!;
      const [x, y] = projectOnto(en, raw, pointMap(cur));
      return { x, y, on: en.id };
    }
    let [x, y] = raw;
    const step = live.current.snapStep;
    if (step > 0) {
      x = Math.round(x / step) * step;
      y = Math.round(y / step) * step;
    }
    // Horizontal / vertical inference from the previous click (within 3°).
    if (from) {
      const dx = x - from.x;
      const dy = y - from.y;
      if (Math.abs(dx) > 1e-6 && Math.abs(dy) < Math.abs(dx) * Math.tan(3 * D2R)) return { x, y: from.y, hv: 'h' };
      if (Math.abs(dy) > 1e-6 && Math.abs(dx) < Math.abs(dy) * Math.tan(3 * D2R)) return { x: from.x, y, hv: 'v' };
    }
    return { x: x + 0, y: y + 0 };
  };

  /** Turns a snap into a point id in `g`, adding the point (and its "on" constraint) if needed. */
  const usePoint = (g: SketchGeometry, s: Snap): [SketchGeometry, string] => {
    if (s.point) return [g, s.point];
    const [g2, id] = addPoint(g, s.x, s.y);
    return [s.on ? withConstraint(g2, 'pointOn', [id, s.on]) : g2, id];
  };

  const construction = () => (live.current.ui.construction ? { construction: true } : {});

  // ---- pointer handling
  useEffect(() => {
    const el = gl.domElement;
    let drag: null | { kind: 'point' | 'line' | 'radius'; id: string; start: SketchGeometry; from: P2; moved: boolean } = null;

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const { ui: u } = live.current;
      if (u.tool !== 'select') return;
      const hit = hitTest(e);
      if (!hit) {
        if (!e.shiftKey) useSketchUi.setState({ sel: [] });
        return;
      }
      const g = current();
      const at = eventToSketch(e);
      if (!at) return;
      if (hit.kind === 'point') drag = { kind: 'point', id: hit.id, start: g, from: at, moved: false };
      else {
        const en = g.entities.find((x) => x.id === hit.id)!;
        drag = { kind: en.type === 'line' ? 'line' : en.type === 'circle' ? 'radius' : 'point', id: en.type === 'arc' ? en.c : hit.id, start: g, from: at, moved: false };
      }
      el.setPointerCapture(e.pointerId);
      const sel = u.sel;
      if (!sel.includes(hit.id)) useSketchUi.setState({ sel: e.shiftKey ? [...sel, hit.id] : [hit.id] });
    };

    const onMove = (e: PointerEvent) => {
      const { ui: u, pending: pend } = live.current;
      if (drag) {
        const at = eventToSketch(e);
        if (!at) return;
        drag.moved = true;
        const g = drag.start;
        if (drag.kind === 'point') applyEdit(g, { transient: true, drag: { point: drag.id, x: at[0], y: at[1] } });
        else if (drag.kind === 'radius') applyEdit(g, { transient: true, drag: { radiusOf: drag.id, x: at[0], y: at[1] } });
        else {
          const en = g.entities.find((x) => x.id === drag!.id);
          if (en?.type === 'line') {
            const dx = at[0] - drag.from[0];
            const dy = at[1] - drag.from[1];
            const moved = { ...g, points: g.points.map((p) => (p.id === en.a || p.id === en.b ? { ...p, x: p.x + dx, y: p.y + dy } : p)) };
            applyEdit(moved, { transient: true });
          }
        }
        return;
      }
      if (u.tool === 'select') {
        const h = hitTest(e);
        if ((h?.id ?? null) !== u.hover) useSketchUi.setState({ hover: h?.id ?? null });
        return;
      }
      setCursor(snapAt(e, u.tool === 'line' ? pend.at(-1) : undefined));
      invalidate();
    };

    const onUp = (e: PointerEvent) => {
      if (!drag) return;
      el.releasePointerCapture?.(e.pointerId);
      const d = drag;
      drag = null;
      if (!d.moved) return;
      // Record one undo step for the whole drag.
      const end = current();
      useSketchUi.setState((u) => ({ undo: [...u.undo, d.start], redo: [] }));
      applyEdit(end, { transient: true });
    };

    const onClick = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const { ui: u, pending: pend, dimFirst: df } = live.current;
      if (u.tool === 'select') return;
      if (u.tool === 'dimension') return dimensionClick(e, df);
      const s = snapAt(e, u.tool === 'line' ? pend.at(-1) : undefined);
      if (!s) return;
      const g = current();

      if (u.tool === 'point') {
        const [g2] = usePoint(g, s);
        applyEdit(g2);
        return;
      }
      if (u.tool === 'line') {
        if (!pend.length) return setPending([s]);
        const a = pend[0];
        if (Math.hypot(s.x - a.x, s.y - a.y) < 1e-6) return;
        let [g2, ia] = usePoint(g, a);
        let ib: string;
        [g2, ib] = usePoint(g2, s);
        const id = eid();
        g2 = { ...g2, entities: [...g2.entities, { id, type: 'line', a: ia, b: ib, ...construction() }] };
        if (s.hv === 'h') g2 = withConstraint(g2, 'horizontal', [id]);
        if (s.hv === 'v') g2 = withConstraint(g2, 'vertical', [id]);
        applyEdit(g2);
        // Keep drawing from the end; stop when the outline closes on an existing point.
        setPending(s.point ? [] : [{ x: s.x, y: s.y, point: ib }]);
        return;
      }
      if (u.tool === 'rect') {
        if (!pend.length) return setPending([s]);
        const a = pend[0];
        if (Math.abs(s.x - a.x) < 1e-6 || Math.abs(s.y - a.y) < 1e-6) return;
        let [g2, p1] = usePoint(g, a);
        let p3: string;
        [g2, p3] = usePoint(g2, s);
        let p2: string;
        let p4: string;
        [g2, p2] = addPoint(g2, s.x, a.y);
        [g2, p4] = addPoint(g2, a.x, s.y);
        const ids = [eid(), eid(), eid(), eid()];
        const c = construction();
        g2 = {
          ...g2,
          entities: [
            ...g2.entities,
            { id: ids[0], type: 'line', a: p1, b: p2, ...c },
            { id: ids[1], type: 'line', a: p2, b: p3, ...c },
            { id: ids[2], type: 'line', a: p3, b: p4, ...c },
            { id: ids[3], type: 'line', a: p4, b: p1, ...c },
          ],
        };
        g2 = withConstraint(withConstraint(g2, 'horizontal', [ids[0]]), 'horizontal', [ids[2]]);
        g2 = withConstraint(withConstraint(g2, 'vertical', [ids[1]]), 'vertical', [ids[3]]);
        applyEdit(g2);
        setPending([]);
        return;
      }
      if (u.tool === 'circle') {
        if (!pend.length) return setPending([s]);
        const c = pend[0];
        const r = Math.hypot(s.x - c.x, s.y - c.y);
        if (r < 1e-6) return;
        let [g2, ic] = usePoint(g, c);
        const id = eid();
        g2 = { ...g2, entities: [...g2.entities, { id, type: 'circle', c: ic, r, ...construction() }] };
        if (s.point) g2 = withConstraint(g2, 'pointOn', [s.point, id]);
        applyEdit(g2);
        setPending([]);
        return;
      }
      if (u.tool === 'arc') {
        if (pend.length < 2) return setPending([...pend, s]);
        const [a, b] = pend;
        const center = circumcenter([a.x, a.y], [b.x, b.y], [s.x, s.y]);
        if (!center) return;
        // Counter-clockwise from start to end must pass through the third click; otherwise swap.
        const crossZ = (b.x - a.x) * (s.y - a.y) - (b.y - a.y) * (s.x - a.x);
        const [start, end] = crossZ < 0 ? [a, b] : [b, a];
        let [g2, ia] = usePoint(g, start);
        let ib: string;
        [g2, ib] = usePoint(g2, end);
        let ic: string;
        [g2, ic] = addPoint(g2, center[0], center[1]);
        g2 = { ...g2, entities: [...g2.entities, { id: eid(), type: 'arc', c: ic, a: ia, b: ib, ...construction() }] };
        applyEdit(g2);
        setPending([]);
      }
    };

    const dimensionClick = (e: MouseEvent, first: Hit | null) => {
      const hit = hitTest(e);
      const g = current();
      const pm = pointMap(g);
      const add = (type: SkConstraint['type'], refs: string[], value: number) => {
        const g2 = withConstraint(g, type, refs, Math.round(value * 1000) / 1000);
        const c = g2.constraints.at(-1)!;
        applyEdit(g2);
        setDimFirst(null);
        useSketchUi.setState({ editingDim: c.id, sel: [c.id] });
      };
      if (!first) {
        if (!hit) return;
        const en = hit.kind === 'entity' ? g.entities.find((x) => x.id === hit.id) : undefined;
        if (en && en.type !== 'line') {
          const r = en.type === 'circle' ? en.r : dist(pm.get(en.a)!, pm.get(en.c)!);
          return add('radius', [en.id], r);
        }
        return setDimFirst(hit);
      }
      // Second click: another point gives a distance, another line an angle, anything else the line's length.
      if (first.kind === 'point' && hit?.kind === 'point' && hit.id !== first.id) return add('distance', [first.id, hit.id], dist(pm.get(first.id)!, pm.get(hit.id)!));
      const l1 = g.entities.find((x) => x.id === first.id);
      const hEnt = hit?.kind === 'entity' ? g.entities.find((x) => x.id === hit.id) : undefined;
      if (first.kind === 'point' && hEnt?.type === 'line') {
        const p = pm.get(first.id)!;
        return add('distance', [first.id, hEnt.id], Math.abs(lineDistance(p, pm.get(hEnt.a)!, pm.get(hEnt.b)!)));
      }
      if (l1?.type === 'line' && hEnt?.type === 'line' && hEnt.id !== l1.id) {
        const a = [pm.get(l1.b)!.x - pm.get(l1.a)!.x, pm.get(l1.b)!.y - pm.get(l1.a)!.y];
        const b = [pm.get(hEnt.b)!.x - pm.get(hEnt.a)!.x, pm.get(hEnt.b)!.y - pm.get(hEnt.a)!.y];
        return add('angle', [l1.id, hEnt.id], (Math.atan2(a[0] * b[1] - a[1] * b[0], a[0] * b[0] + a[1] * b[1]) * 180) / Math.PI);
      }
      if (l1?.type === 'line') return add('distance', [l1.id], dist(pm.get(l1.a)!, pm.get(l1.b)!));
      setDimFirst(null);
    };

    const onDbl = () => setPending([]);
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('click', onClick);
    el.addEventListener('dblclick', onDbl);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('click', onClick);
      el.removeEventListener('dblclick', onDbl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gl, camera, frame]);

  // ---- keyboard: tools, constraints, delete, escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const u = useSketchUi.getState();
      const k = e.key.toLowerCase();
      const tools: Record<string, typeof u.tool> = { l: 'line', r: 'rect', c: 'circle', a: 'arc', p: 'point', d: 'dimension', s: 'select' };
      if (e.key === 'Escape') {
        e.preventDefault();
        if (live.current.pending.length || live.current.dimFirst) {
          setPending([]);
          setDimFirst(null);
        } else if (u.tool !== 'select') useSketchUi.setState({ tool: 'select' });
        else useSketchUi.setState({ sel: [] });
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (u.sel.length) {
          e.preventDefault();
          applyEdit(deleteItems(current(), u.sel));
          useSketchUi.setState({ sel: [] });
        }
        return;
      }
      if (k === 'x') return useSketchUi.setState({ construction: !u.construction });
      if (k === 'h' || k === 'v') {
        if (u.sel.length) applyConstraintToSelection(k === 'h' ? 'horizontal' : 'vertical');
        return;
      }
      if (tools[k]) useSketchUi.setState({ tool: tools[k] });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ---- rendering
  const defined = ui.dof === 0 && ui.ok;
  const lineColor = (e: SkEntity) =>
    ui.sel.includes(e.id) ? colors.accent : ui.hover === e.id ? colors.hover : e.construction ? colors.edge : defined ? colors.gridSection : colors.axisZ;
  const preview = previewGeometry(ui.tool, pending, cursor);
  const P3 = (x: number, y: number): [number, number, number] => [x, y, 0];

  const pointsGeo = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(f.points.flatMap((p) => [p.x, p.y, 0])), 3));
    return g;
  }, [f.points]);

  return (
    <group matrix={matrix} matrixAutoUpdate={false}>
      {/* A grid on the sketch plane (the ground grid only covers XY). */}
      <Grid
        rotation={[Math.PI / 2, 0, 0]}
        position={[0, 0, -0.02]}
        args={[400, 400]}
        cellSize={snapStep > 0 ? Math.max(snapStep, 1) : 5}
        sectionSize={snapStep > 0 ? Math.max(snapStep, 1) * 10 : 50}
        cellColor={colors.gridCell}
        sectionColor={colors.gridSection}
        fadeDistance={600}
        infiniteGrid
        side={DoubleSide}
      />
      {shapes.length > 0 && (
        <mesh renderOrder={30} position={[0, 0, -0.01]}>
          <shapeGeometry args={[shapes]} />
          <meshBasicMaterial color={colors.axisZ} transparent opacity={0.16} side={DoubleSide} depthWrite={false} depthTest={false} />
        </mesh>
      )}
      {f.entities.map((e) => (
        <Line
          key={e.id}
          points={entityPolyline(e, pts).map(([x, y]) => P3(x, y))}
          color={lineColor(e)}
          lineWidth={ui.sel.includes(e.id) || ui.hover === e.id ? 3 : 2}
          dashed={!!e.construction}
          dashSize={2}
          gapSize={1.4}
          depthTest={false}
          renderOrder={31}
        />
      ))}
      <points geometry={pointsGeo} renderOrder={32}>
        <pointsMaterial size={7} sizeAttenuation={false} color={defined ? colors.gridSection : colors.axisZ} depthTest={false} />
      </points>
      {f.points
        .filter((p) => ui.sel.includes(p.id) || ui.hover === p.id || p.id === 'o')
        .map((p) => (
          <mesh key={p.id} position={P3(p.x, p.y)} renderOrder={33}>
            <circleGeometry args={[0.9, 16]} />
            <meshBasicMaterial color={p.id === 'o' ? colors.axisX : ui.sel.includes(p.id) ? colors.accent : colors.hover} depthTest={false} />
          </mesh>
        ))}
      {preview.map((poly, i) => (
        <Line key={`pv${i}`} points={poly.map(([x, y]) => P3(x, y))} color={colors.accent} lineWidth={1.6} dashed dashSize={1.5} gapSize={1} depthTest={false} renderOrder={34} />
      ))}
      {cursor && ui.tool !== 'select' && (
        <mesh position={P3(cursor.x, cursor.y)} renderOrder={35}>
          <ringGeometry args={[0.8, 1.3, 20]} />
          <meshBasicMaterial color={cursor.point || cursor.on ? colors.hover : colors.accent} depthTest={false} />
        </mesh>
      )}
      {cursor && ui.tool !== 'select' && (cursor.hv || pending.length > 0) && (
        <Html position={P3(cursor.x, cursor.y)} zIndexRange={[40, 30]} style={{ pointerEvents: 'none' }}>
          <div className="sk-cursor-tip">{cursorTip(ui.tool, pending, cursor)}</div>
        </Html>
      )}
      {f.constraints.map((c) => (
        <ConstraintLabel key={c.id} c={c} f={f} pts={pts} scope={scope} selected={ui.sel.includes(c.id)} editing={ui.editingDim === c.id} />
      ))}
    </group>
  );
}

function cursorTip(tool: string, pending: Pending, c: Snap): string {
  const a = pending[0];
  const hv = c.hv === 'h' ? ' · horizontal' : c.hv === 'v' ? ' · vertical' : '';
  if (!a) return hv.slice(3);
  if (tool === 'line') return `${formatNum(Math.hypot(c.x - a.x, c.y - a.y), 2)} mm${hv}`;
  if (tool === 'rect') return `${formatNum(Math.abs(c.x - a.x), 2)} × ${formatNum(Math.abs(c.y - a.y), 2)}`;
  if (tool === 'circle') return `R ${formatNum(Math.hypot(c.x - a.x, c.y - a.y), 2)}`;
  return '';
}

function previewGeometry(tool: string, pending: Pending, c: Snap | null): P2[][] {
  if (!c || !pending.length) return [];
  const a = pending[0];
  if (tool === 'line') return [[[a.x, a.y], [c.x, c.y]]];
  if (tool === 'rect')
    return [
      [
        [a.x, a.y],
        [c.x, a.y],
        [c.x, c.y],
        [a.x, c.y],
        [a.x, a.y],
      ],
    ];
  if (tool === 'circle') {
    const r = Math.hypot(c.x - a.x, c.y - a.y);
    return [Array.from({ length: 65 }, (_, i) => [a.x + r * Math.cos((i / 64) * Math.PI * 2), a.y + r * Math.sin((i / 64) * Math.PI * 2)] as P2)];
  }
  if (tool === 'arc') {
    if (pending.length === 1) return [[[a.x, a.y], [c.x, c.y]]];
    const b = pending[1];
    const center = circumcenter([a.x, a.y], [b.x, b.y], [c.x, c.y]);
    if (!center) return [[[a.x, a.y], [b.x, b.y]]];
    const crossZ = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    const [s, e] = crossZ < 0 ? [a, b] : [b, a];
    const r = Math.hypot(s.x - center[0], s.y - center[1]);
    const a0 = Math.atan2(s.y - center[1], s.x - center[0]);
    const sweep = ccwSweep(center, [s.x, s.y], [e.x, e.y]);
    return [Array.from({ length: 33 }, (_, i) => [center[0] + r * Math.cos(a0 + (sweep * i) / 32), center[1] + r * Math.sin(a0 + (sweep * i) / 32)] as P2)];
  }
  return [];
}

// ---------------------------------------------------------------- constraint and dimension labels

const GLYPHS: Partial<Record<SkConstraint['type'], string>> = {
  horizontal: 'H',
  vertical: 'V',
  parallel: '∥',
  perpendicular: '⊥',
  equal: '=',
  tangent: '◠',
  midpoint: 'M',
  pointOn: '•',
};
const DIMENSIONS = new Set(['distance', 'hdistance', 'vdistance', 'radius', 'angle']);

function anchorOf(c: SkConstraint, f: SketchFeature, pts: ReturnType<typeof pointMap>): P2 | null {
  const P = (id: string): P2 | null => {
    const p = pts.get(id);
    return p ? [p.x, p.y] : null;
  };
  const mid = (en: SkEntity): P2 | null => {
    const poly = entityPolyline(en, pts);
    if (en.type === 'line') return [(poly[0][0] + poly[1][0]) / 2, (poly[0][1] + poly[1][1]) / 2];
    return poly[Math.floor(poly.length / 2)] ?? null;
  };
  const refs = c.refs.map((id) => f.entities.find((e) => e.id === id) ?? null);
  if (c.type === 'radius' && refs[0]) {
    const en = refs[0];
    if (en.type === 'line') return null;
    const cc = P(en.c);
    if (!cc) return null;
    const r = en.type === 'circle' ? en.r : Math.hypot(P(en.a)![0] - cc[0], P(en.a)![1] - cc[1]);
    return [cc[0] + r * Math.cos(Math.PI / 4), cc[1] + r * Math.sin(Math.PI / 4)];
  }
  if (refs[0] && refs[1]) {
    const a = mid(refs[0]);
    const b = mid(refs[1]);
    return a && b ? [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] : null;
  }
  if (refs[0]) {
    const m = mid(refs[0]);
    if (!m) return null;
    if (refs[0].type === 'line' && DIMENSIONS.has(c.type)) {
      // Lengths sit just off the line, on the side away from the middle of the sketch.
      const a = P(refs[0].a)!;
      const b = P(refs[0].b)!;
      const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const n: P2 = [-(b[1] - a[1]) / l, (b[0] - a[0]) / l];
      const cx = f.points.reduce((s, p) => s + p.x, 0) / f.points.length;
      const cy = f.points.reduce((s, p) => s + p.y, 0) / f.points.length;
      const k = (m[0] - cx) * n[0] + (m[1] - cy) * n[1] >= 0 ? 4 : -4;
      return [m[0] + n[0] * k, m[1] + n[1] * k];
    }
    return m;
  }
  const a = P(c.refs[0]);
  const b = c.refs[1] ? (P(c.refs[1]) ?? (refs[1] ? mid(refs[1]) : null)) : null;
  if (a && b) return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  return null;
}

function ConstraintLabel({ c, f, pts, scope, selected, editing }: { c: SkConstraint; f: SketchFeature; pts: ReturnType<typeof pointMap>; scope: Record<string, number>; selected: boolean; editing: boolean }) {
  const dim = DIMENSIONS.has(c.type);
  const glyph = GLYPHS[c.type];
  const at = anchorOf(c, f, pts);
  const [text, setText] = useState('');
  useEffect(() => {
    if (editing) setText(String(c.value ?? ''));
  }, [editing, c.value]);
  if (!at || (!dim && !glyph)) return null;
  if (c.type === 'pointOn' && !selected) return null;
  const select = (e: React.MouseEvent) => {
    e.stopPropagation();
    const sel = useSketchUi.getState().sel;
    useSketchUi.setState({ sel: e.shiftKey ? [...sel, c.id] : [c.id], editingDim: dim ? c.id : null });
  };
  let shown = '';
  if (dim) {
    let v: number | null = null;
    try {
      v = evalNum(c.value ?? 0, scope);
    } catch {
      v = null;
    }
    const prefix = c.type === 'radius' ? 'R' : c.type === 'angle' ? '∠' : '';
    const unit = c.type === 'angle' ? '°' : '';
    const formula = typeof c.value === 'string' && !/^[\d.\s-]+$/.test(c.value) ? `${c.value} = ` : '';
    shown = `${prefix}${prefix ? ' ' : ''}${formula}${v === null ? '?' : formatNum(v, 2)}${unit}`;
  }
  const commit = () => {
    const t = text.trim();
    useSketchUi.setState({ editingDim: null });
    if (!t) return;
    const num = Number(t);
    const g = current();
    applyEdit({ ...g, constraints: g.constraints.map((x) => (x.id === c.id ? { ...x, value: Number.isFinite(num) ? num : t } : x)) });
  };
  return (
    <Html position={[at[0], at[1], 0]} center zIndexRange={[45, 35]}>
      {editing ? (
        <div className="sk-dim-edit" onPointerDown={(e) => e.stopPropagation()}>
          <input
            autoFocus
            value={text}
            aria-label="Dimension value"
            onChange={(e) => setText(e.target.value)}
            onFocus={(e) => e.target.select()}
            onBlur={commit}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') commit();
              if (e.key === 'Escape') useSketchUi.setState({ editingDim: null });
            }}
          />
          <button
            title="Delete this dimension"
            aria-label="Delete this dimension"
            onMouseDown={(e) => {
              e.preventDefault();
              useSketchUi.setState({ editingDim: null, sel: [] });
              applyEdit(deleteItems(current(), [c.id]));
            }}
          >
            ×
          </button>
        </div>
      ) : (
        <button className={`sk-label${dim ? ' dim' : ''}${selected ? ' on' : ''}`} onPointerDown={(e) => e.stopPropagation()} onClick={select} title={dim ? 'Click to change the value (formulas work)' : `${c.type} constraint · select and press Delete to remove`}>
          {dim ? shown : glyph}
        </button>
      )}
    </Html>
  );
}

// ---------------------------------------------------------------- constraints from the selection

/** Applies a constraint to whatever is selected, the way Onshape's constraint buttons do. */
export function applyConstraintToSelection(type: SkConstraint['type']): boolean {
  const g = current();
  const sel = useSketchUi.getState().sel;
  const isPt = (id: string) => g.points.some((p) => p.id === id);
  const ent = (id: string) => g.entities.find((e) => e.id === id);
  const pointsSel = sel.filter(isPt);
  const lines = sel.filter((id) => ent(id)?.type === 'line');
  const curves = sel.filter((id) => ent(id) && ent(id)!.type !== 'line');
  let next = g;
  switch (type) {
    case 'horizontal':
    case 'vertical':
      if (lines.length) for (const l of lines) next = withConstraint(next, type, [l]);
      else if (pointsSel.length === 2) next = withConstraint(next, type, pointsSel);
      break;
    case 'coincident':
      if (pointsSel.length === 2) next = withConstraint(next, 'coincident', pointsSel);
      else if (pointsSel.length === 1 && (lines.length || curves.length) === 1) next = withConstraint(next, 'pointOn', [pointsSel[0], lines[0] ?? curves[0]]);
      break;
    case 'parallel':
    case 'perpendicular':
      if (lines.length === 2) next = withConstraint(next, type, lines);
      break;
    case 'equal':
      if (lines.length >= 2) for (const l of lines.slice(1)) next = withConstraint(next, 'equal', [lines[0], l]);
      else if (curves.length >= 2) for (const cv of curves.slice(1)) next = withConstraint(next, 'equal', [curves[0], cv]);
      break;
    case 'tangent':
      if (lines.length === 1 && curves.length === 1) next = withConstraint(next, 'tangent', [lines[0], curves[0]]);
      else if (curves.length === 2) next = withConstraint(next, 'tangent', curves);
      break;
    case 'midpoint':
      if (pointsSel.length === 1 && lines.length === 1) next = withConstraint(next, 'midpoint', [pointsSel[0], lines[0]]);
      break;
    case 'fix':
      for (const p of pointsSel) next = withConstraint(next, 'fix', [p]);
      break;
    default:
      break;
  }
  if (next === g) return false;
  applyEdit(next);
  return true;
}

/** Which constraint buttons make sense for the current selection. */
export function constraintOptions(g: SketchGeometry, sel: string[]): Set<SkConstraint['type']> {
  const pts = sel.filter((id) => g.points.some((p) => p.id === id)).length;
  const ents = sel.map((id) => g.entities.find((e) => e.id === id)).filter(Boolean) as SkEntity[];
  const lines = ents.filter((e) => e.type === 'line').length;
  const curves = ents.length - lines;
  const ok = new Set<SkConstraint['type']>();
  if (lines >= 1 || pts === 2) ok.add('horizontal').add('vertical');
  if (pts === 2 || (pts === 1 && ents.length === 1)) ok.add('coincident');
  if (lines === 2 && !curves) ok.add('parallel').add('perpendicular');
  if ((lines >= 2 && !curves) || (curves >= 2 && !lines)) ok.add('equal');
  if ((lines === 1 && curves === 1) || (curves === 2 && !lines)) ok.add('tangent');
  if (pts === 1 && lines === 1 && !curves) ok.add('midpoint');
  if (pts >= 1 && !ents.length) ok.add('fix');
  return ok;
}

// ---------------------------------------------------------------- math

function segDist(p: P2, a: P2, b: P2): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

function dist(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function lineDistance(p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) {
  const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  return ((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)) / l;
}

function projectOnto(e: SkEntity, p: P2, pts: ReturnType<typeof pointMap>): P2 {
  if (e.type === 'line') {
    const a = pts.get(e.a)!;
    const b = pts.get(e.b)!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((p[0] - a.x) * dx + (p[1] - a.y) * dy) / l2));
    return [a.x + t * dx, a.y + t * dy];
  }
  const c = pts.get(e.c)!;
  const r = e.type === 'circle' ? e.r : dist(pts.get(e.a)!, c);
  const ang = Math.atan2(p[1] - c.y, p[0] - c.x);
  return [c.x + r * Math.cos(ang), c.y + r * Math.sin(ang)];
}

function circumcenter(a: P2, b: P2, c: P2): P2 | null {
  const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
  if (Math.abs(d) < 1e-9) return null;
  const a2 = a[0] * a[0] + a[1] * a[1];
  const b2 = b[0] * b[0] + b[1] * b[1];
  const c2 = c[0] * c[0] + c[1] * c[1];
  return [(a2 * (b[1] - c[1]) + b2 * (c[1] - a[1]) + c2 * (a[1] - b[1])) / d, (a2 * (c[0] - b[0]) + b2 * (a[0] - c[0]) + c2 * (b[0] - a[0])) / d];
}

