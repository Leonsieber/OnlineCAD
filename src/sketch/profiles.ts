// Turns a solved sketch into closed profiles (regions with holes) and open chains (sweep paths).
// Construction geometry is ignored. Shared by the worker (to build solids) and the UI (to shade
// the regions that will be extruded).
import type { SkEntity, SkPoint } from '../model/types';
import type { SketchGeometry } from './solver';

export type P2 = [number, number];

export type Seg =
  | { kind: 'line'; from: P2; to: P2 }
  /** `ccw` is the direction of travel from `from` to `to`. */
  | { kind: 'arc'; from: P2; to: P2; center: P2; r: number; ccw: boolean };

export interface Loop {
  /** Empty for a full circle (see `circle`). */
  segs: Seg[];
  circle?: { center: P2; r: number };
  /** Sampled outline, counter-clockwise, for areas, containment, and previews. */
  poly: P2[];
  area: number;
}

export interface Region {
  outer: Loop;
  holes: Loop[];
}

export interface Profiles {
  regions: Region[];
  /** Chains of lines and arcs that don't close (sweep paths). */
  chains: Seg[][];
  /** All closed loops, outermost first. */
  loops: Loop[];
}

const ARC_STEPS = 24;

/** Groups point ids joined by coincident constraints, so lines that meet count as connected. */
function pointRoots(g: SketchGeometry): (id: string) => string {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let r = x;
    while (parent.has(r) && parent.get(r) !== r) r = parent.get(r)!;
    return r;
  };
  for (const c of g.constraints) {
    if (c.type !== 'coincident' || c.refs.length !== 2) continue;
    const a = find(c.refs[0]);
    const b = find(c.refs[1]);
    if (a !== b) parent.set(a, b);
  }
  return find;
}

function sampleArc(center: P2, r: number, a0: number, sweep: number, steps = ARC_STEPS): P2[] {
  const out: P2[] = [];
  for (let i = 1; i <= steps; i++) {
    const t = a0 + (sweep * i) / steps;
    out.push([center[0] + r * Math.cos(t), center[1] + r * Math.sin(t)]);
  }
  return out;
}

/** Angle swept counter-clockwise from a to b around c, in (0, 2π]. */
export function ccwSweep(c: P2, a: P2, b: P2): number {
  let s = Math.atan2(b[1] - c[1], b[0] - c[0]) - Math.atan2(a[1] - c[1], a[0] - c[0]);
  while (s <= 1e-12) s += Math.PI * 2;
  return s;
}

/** Points along a segment, excluding its start. */
export function segPoints(s: Seg): P2[] {
  if (s.kind === 'line') return [s.to];
  const a0 = Math.atan2(s.from[1] - s.center[1], s.from[0] - s.center[0]);
  const sweep = s.ccw ? ccwSweep(s.center, s.from, s.to) : -ccwSweep(s.center, s.to, s.from);
  const pts = sampleArc(s.center, s.r, a0, sweep);
  pts[pts.length - 1] = s.to;
  return pts;
}

/** A point halfway along an arc segment, for three-point arc drawing. */
export function arcMid(s: Seg & { kind: 'arc' }): P2 {
  const a0 = Math.atan2(s.from[1] - s.center[1], s.from[0] - s.center[0]);
  const sweep = s.ccw ? ccwSweep(s.center, s.from, s.to) : -ccwSweep(s.center, s.to, s.from);
  const t = a0 + sweep / 2;
  return [s.center[0] + s.r * Math.cos(t), s.center[1] + s.r * Math.sin(t)];
}

export function polyArea(poly: P2[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

export function pointInPoly(pt: P2, poly: P2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function reverseSeg(s: Seg): Seg {
  return s.kind === 'line' ? { kind: 'line', from: s.to, to: s.from } : { ...s, from: s.to, to: s.from, ccw: !s.ccw };
}

function makeLoop(segs: Seg[]): Loop {
  let poly: P2[] = [segs[0].from, ...segs.flatMap(segPoints)];
  poly.pop(); // last point repeats the first
  let area = polyArea(poly);
  if (area < 0) {
    segs = segs.map(reverseSeg).reverse();
    poly = [segs[0].from, ...segs.flatMap(segPoints)];
    poly.pop();
    area = -area;
  }
  return { segs, poly, area };
}

function circleLoop(center: P2, r: number): Loop {
  const poly = sampleArc(center, r, 0, Math.PI * 2, 64);
  return { segs: [], circle: { center, r }, poly, area: Math.PI * r * r };
}

interface HalfEdge {
  from: string;
  to: string;
  seg: Seg;
  /** Direction leaving `from`, for ordering edges around a vertex. */
  angle: number;
  twin?: HalfEdge;
  used?: boolean;
}

export function sketchProfiles(g: SketchGeometry): Profiles {
  const root = pointRoots(g);
  const pos = new Map<string, P2>(g.points.map((p: SkPoint) => [p.id, [p.x, p.y]]));
  const P = (id: string): P2 => pos.get(id) ?? [0, 0];
  const loops: Loop[] = [];
  const edges: Exclude<SkEntity, { type: 'circle' }>[] = [];
  for (const e of g.entities) {
    if (e.construction) continue;
    if (e.type === 'circle') {
      if (e.r > 1e-9) loops.push(circleLoop(P(e.c), e.r));
    } else edges.push(e);
  }

  // Half-edges between point groups.
  const out = new Map<string, HalfEdge[]>();
  const add = (h: HalfEdge) => out.set(h.from, [...(out.get(h.from) ?? []), h]);
  for (const e of edges) {
    const a = root(e.a);
    const b = root(e.b);
    if (a === b && e.type === 'line') continue;
    let fwd: Seg;
    if (e.type === 'line') fwd = { kind: 'line', from: P(e.a), to: P(e.b) };
    else {
      const c = P(e.c);
      fwd = { kind: 'arc', from: P(e.a), to: P(e.b), center: c, r: Math.hypot(P(e.a)[0] - c[0], P(e.a)[1] - c[1]), ccw: true };
    }
    const bwd = reverseSeg(fwd);
    const leave = (s: Seg) => {
      if (s.kind === 'line') return Math.atan2(s.to[1] - s.from[1], s.to[0] - s.from[0]);
      const rx = s.from[0] - s.center[0];
      const ry = s.from[1] - s.center[1];
      return s.ccw ? Math.atan2(rx, -ry) : Math.atan2(-rx, ry);
    };
    const h1: HalfEdge = { from: a, to: b, seg: fwd, angle: leave(fwd) };
    const h2: HalfEdge = { from: b, to: a, seg: bwd, angle: leave(bwd), twin: h1 };
    h1.twin = h2;
    add(h1);
    add(h2);
  }

  // Strip dangling edges (vertices of degree 1) into open chains; what's left are closed cycles.
  const chains: Seg[][] = [];
  {
    const removed = new Set<HalfEdge>();
    let changed = true;
    while (changed) {
      changed = false;
      for (const list of out.values()) {
        const live = list.filter((h) => !removed.has(h));
        if (live.length === 1) {
          removed.add(live[0]);
          removed.add(live[0].twin!);
          changed = true;
        }
      }
    }
    for (const h of removed) h.used = true;
    // Chains for sweep paths: walk the removed edges from their open ends.
    const seen = new Set<HalfEdge>();
    const removedOut = (v: string) => (out.get(v) ?? []).filter((h) => removed.has(h) && !seen.has(h));
    const ends = [...out.keys()].filter((v) => (out.get(v) ?? []).filter((h) => removed.has(h)).length === 1);
    for (const start of ends) {
      let cur = removedOut(start)[0];
      if (!cur) continue;
      const chain: Seg[] = [];
      while (cur) {
        seen.add(cur);
        seen.add(cur.twin!);
        chain.push(cur.seg);
        const nexts = removedOut(cur.to);
        cur = nexts.length === 1 ? nexts[0] : (undefined as unknown as HalfEdge);
      }
      if (chain.length) chains.push(chain);
    }
  }

  // Face walk: leaving a vertex, turn to the next edge clockwise from where we came in. Each
  // bounded face comes out counter-clockwise; the outside of each component comes out clockwise.
  for (const list of out.values()) list.sort((p, q) => p.angle - q.angle);
  const faces: Seg[][] = [];
  for (const list of out.values()) {
    for (const start of list) {
      if (start.used) continue;
      const segs: Seg[] = [];
      let h: HalfEdge | undefined = start;
      let guard = 0;
      while (h && !h.used && guard++ < 10000) {
        h.used = true;
        segs.push(h.seg);
        const around: HalfEdge[] = out.get(h.to) ?? [];
        const i: number = around.indexOf(h.twin!);
        h = around[(i - 1 + around.length) % around.length];
        if (h === start) break;
      }
      if (segs.length) faces.push(segs);
    }
  }
  // Keep each component's outline: the clockwise faces (negative area), turned counter-clockwise.
  for (const segs of faces) {
    const poly: P2[] = [segs[0].from, ...segs.flatMap(segPoints)];
    poly.pop();
    if (poly.length >= 2 && polyArea(poly) < -1e-9) loops.push(makeLoop(segs));
  }

  // Nesting: a loop inside an odd number of others is a hole.
  loops.sort((a, b) => b.area - a.area);
  const depth = loops.map((l, i) => loops.filter((o, j) => j < i && pointInPoly(l.poly[0], o.poly)).length);
  const regions: Region[] = [];
  loops.forEach((l, i) => {
    if (depth[i] % 2) return;
    const holes = loops.filter((h, j) => depth[j] === depth[i] + 1 && pointInPoly(h.poly[0], l.poly));
    regions.push({ outer: l, holes });
  });
  return { regions, chains, loops };
}
