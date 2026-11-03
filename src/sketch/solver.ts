// Geometric constraint solver for sketches. Pure TypeScript, so the UI (live dragging) and the
// geometry worker (rebuilds with new variable values) run the same code.
//
// Unknowns are the coordinates of every point that isn't fixed, plus each circle's radius (an arc's
// radius is |a - c|). Each constraint adds residuals that are zero when it holds, and a damped
// Gauss-Newton (Levenberg-Marquardt) loop drives them to zero. Damping keeps an under-constrained
// sketch close to where it was drawn, which is what makes dragging feel natural.
import { evalNum } from '../model/expr';
import type { SkConstraint, SkEntity, SkPoint } from '../model/types';

export interface SketchGeometry {
  points: SkPoint[];
  entities: SkEntity[];
  constraints: SkConstraint[];
}

export interface SolveOptions {
  /** Pull a point toward the cursor (or a circle's rim, for `radiusOf`) while dragging. */
  drag?: { point: string; x: number; y: number } | { radiusOf: string; x: number; y: number };
  iterations?: number;
}

export interface SolveResult {
  points: SkPoint[];
  entities: SkEntity[];
  /** True when every constraint holds. */
  ok: boolean;
  /** Remaining degrees of freedom: 0 means fully defined. */
  dof: number;
  /** Constraints that couldn't be satisfied, or whose values didn't evaluate. */
  failed: string[];
  errors: string[];
}

const TOL = 1e-9;
const D2R = Math.PI / 180;

export function solveSketch(sk: SketchGeometry, scope: Record<string, number> = {}, opts: SolveOptions = {}): SolveResult {
  const errors: string[] = [];
  const fixed = new Set(sk.constraints.filter((c) => c.type === 'fix').flatMap((c) => c.refs));
  const pts = new Map(sk.points.map((p) => [p.id, p]));
  const ents = new Map(sk.entities.map((e) => [e.id, e]));

  // ---- unknowns
  const init: number[] = [];
  const pIdx = new Map<string, number>();
  for (const p of sk.points) {
    if (fixed.has(p.id)) continue;
    pIdx.set(p.id, init.length);
    init.push(p.x, p.y);
  }
  const rIdx = new Map<string, number>();
  for (const e of sk.entities) {
    if (e.type === 'circle') {
      rIdx.set(e.id, init.length);
      init.push(e.r);
    }
  }
  const n = init.length;

  // ---- accessors into a candidate solution
  let v: Float64Array = Float64Array.from(init);
  const X = (id: string) => {
    const i = pIdx.get(id);
    return i === undefined ? (pts.get(id)?.x ?? 0) : v[i];
  };
  const Y = (id: string) => {
    const i = pIdx.get(id);
    return i === undefined ? (pts.get(id)?.y ?? 0) : v[i + 1];
  };
  const radius = (e: SkEntity) => {
    if (e.type === 'circle') return v[rIdx.get(e.id)!];
    if (e.type === 'arc') return Math.hypot(X(e.a) - X(e.c), Y(e.a) - Y(e.c));
    return 0;
  };
  const center = (e: SkEntity): [number, number] => (e.type === 'line' ? [0, 0] : [X(e.c), Y(e.c)]);
  const dir = (e: SkEntity): [number, number] => (e.type === 'line' ? [X(e.b) - X(e.a), Y(e.b) - Y(e.a)] : [0, 0]);
  const len = (d: [number, number]) => Math.hypot(d[0], d[1]) || 1e-12;
  /** Signed distance from a point to a line's infinite extension. */
  const lineDist = (px: number, py: number, l: SkEntity & { type: 'line' }) => {
    const d = dir(l);
    return (d[0] * (py - Y(l.a)) - d[1] * (px - X(l.a))) / len(d);
  };

  const values = new Map<string, number>();
  for (const c of sk.constraints) {
    if (c.value === undefined) continue;
    try {
      values.set(c.id, evalNum(c.value, scope));
    } catch (e) {
      errors.push(`Dimension "${c.value}": ${(e as Error).message}`);
    }
  }

  // Sign memory for constraints with two valid configurations (tangent circles inside or outside,
  // horizontal distance to the left or right): keep whichever side the sketch is on now.
  const side = new Map<string, number>();
  {
    for (const c of sk.constraints) {
      const [a, b] = c.refs;
      if (c.type === 'hdistance') side.set(c.id, Math.sign(X(b) - X(a)) || 1);
      if (c.type === 'vdistance') side.set(c.id, Math.sign(Y(b) - Y(a)) || 1);
      if (c.type === 'tangent') {
        const ea = ents.get(a);
        const eb = ents.get(b);
        if (ea && eb && ea.type !== 'line' && eb.type !== 'line') {
          const [ax, ay] = center(ea);
          const [bx, by] = center(eb);
          const d = Math.hypot(bx - ax, by - ay);
          side.set(c.id, Math.abs(d - (radius(ea) + radius(eb))) <= Math.abs(d - Math.abs(radius(ea) - radius(eb))) ? 1 : -1);
        }
      }
    }
  }

  /** Residuals of one constraint (empty when its references are missing). */
  function residuals(c: SkConstraint): number[] {
    const [r0, r1] = c.refs;
    const e0 = ents.get(r0);
    const e1 = ents.get(r1);
    const val = values.get(c.id);
    switch (c.type) {
      case 'coincident':
        if (pts.has(r0) && pts.has(r1)) return [X(r0) - X(r1), Y(r0) - Y(r1)];
        return [];
      case 'horizontal':
        if (e0?.type === 'line') return [Y(e0.a) - Y(e0.b)];
        if (pts.has(r0) && pts.has(r1)) return [Y(r0) - Y(r1)];
        return [];
      case 'vertical':
        if (e0?.type === 'line') return [X(e0.a) - X(e0.b)];
        if (pts.has(r0) && pts.has(r1)) return [X(r0) - X(r1)];
        return [];
      case 'parallel':
      case 'perpendicular': {
        if (e0?.type !== 'line' || e1?.type !== 'line') return [];
        const a = dir(e0);
        const b = dir(e1);
        const k = len(a) * len(b);
        return [c.type === 'parallel' ? (a[0] * b[1] - a[1] * b[0]) / k : (a[0] * b[0] + a[1] * b[1]) / k];
      }
      case 'equal': {
        if (!e0 || !e1) return [];
        if (e0.type === 'line' && e1.type === 'line') return [len(dir(e0)) - len(dir(e1))];
        if (e0.type !== 'line' && e1.type !== 'line') return [radius(e0) - radius(e1)];
        return [];
      }
      case 'tangent': {
        if (!e0 || !e1) return [];
        if (e0.type === 'line' && e1.type !== 'line') return [Math.abs(lineDist(...center(e1), e0)) - radius(e1)];
        if (e1.type === 'line' && e0.type !== 'line') return [Math.abs(lineDist(...center(e0), e1)) - radius(e0)];
        if (e0.type !== 'line' && e1.type !== 'line') {
          const [ax, ay] = center(e0);
          const [bx, by] = center(e1);
          const d = Math.hypot(bx - ax, by - ay);
          return [side.get(c.id)! > 0 ? d - radius(e0) - radius(e1) : d - Math.abs(radius(e0) - radius(e1))];
        }
        return [];
      }
      case 'pointOn': {
        if (!pts.has(r0) || !e1) return [];
        if (e1.type === 'line') return [lineDist(X(r0), Y(r0), e1)];
        const [cx, cy] = center(e1);
        return [Math.hypot(X(r0) - cx, Y(r0) - cy) - radius(e1)];
      }
      case 'midpoint':
        if (!pts.has(r0) || e1?.type !== 'line') return [];
        return [X(r0) - (X(e1.a) + X(e1.b)) / 2, Y(r0) - (Y(e1.a) + Y(e1.b)) / 2];
      case 'fix':
        return [];
      case 'distance': {
        if (val === undefined) return [];
        if (e0?.type === 'line' && c.refs.length === 1) return [len(dir(e0)) - val];
        if (pts.has(r0) && e1?.type === 'line') return [Math.abs(lineDist(X(r0), Y(r0), e1)) - val];
        if (pts.has(r0) && pts.has(r1)) return [Math.hypot(X(r1) - X(r0), Y(r1) - Y(r0)) - val];
        return [];
      }
      case 'hdistance':
        if (val === undefined || !pts.has(r0) || !pts.has(r1)) return [];
        return [(X(r1) - X(r0)) * side.get(c.id)! - val];
      case 'vdistance':
        if (val === undefined || !pts.has(r0) || !pts.has(r1)) return [];
        return [(Y(r1) - Y(r0)) * side.get(c.id)! - val];
      case 'radius':
        if (val === undefined || !e0 || e0.type === 'line') return [];
        return [radius(e0) - val];
      case 'angle': {
        if (val === undefined || e0?.type !== 'line' || e1?.type !== 'line') return [];
        const a = dir(e0);
        const b = dir(e1);
        const ang = Math.atan2(a[0] * b[1] - a[1] * b[0], a[0] * b[0] + a[1] * b[1]);
        // Compare on the circle so 359 and -1 count as the same angle.
        const diff = ang - val * D2R;
        return [Math.atan2(Math.sin(diff), Math.cos(diff)) * len(a)];
      }
    }
  }

  // Arcs keep both ends on the circle.
  const implicit = (): number[] => {
    const out: number[] = [];
    for (const e of sk.entities) {
      if (e.type === 'arc') out.push(Math.hypot(X(e.b) - X(e.c), Y(e.b) - Y(e.c)) - Math.hypot(X(e.a) - X(e.c), Y(e.a) - Y(e.c)));
    }
    return out;
  };

  const constraintResiduals = (): number[] => {
    const out = implicit();
    for (const c of sk.constraints) out.push(...residuals(c));
    return out;
  };

  const drag = opts.drag;
  const dragResiduals = (): number[] => {
    if (!drag) return [];
    const w = 0.15;
    if ('point' in drag) return pIdx.has(drag.point) ? [(X(drag.point) - drag.x) * w, (Y(drag.point) - drag.y) * w] : [];
    const e = ents.get(drag.radiusOf);
    if (!e || e.type === 'line') return [];
    const [cx, cy] = center(e);
    return [(radius(e) - Math.hypot(drag.x - cx, drag.y - cy)) * w];
  };

  const maxIt = opts.iterations ?? 60;
  if (n > 0) {
    // While dragging, first follow the cursor softly, then settle the constraints exactly.
    if (drag) levenberg(() => [...constraintResiduals(), ...dragResiduals()], maxIt);
    levenberg(constraintResiduals, maxIt);
  }

  function levenberg(res: () => number[], iterations: number) {
    let r = res();
    let cost = sumSq(r);
    let lambda = 1e-3;
    for (let it = 0; it < iterations && cost > TOL * TOL; it++) {
      const m = r.length;
      const J = jacobian(res, r, m);
      // Normal equations: (JᵀJ + λ·diag) δ = -Jᵀr
      const A = new Float64Array(n * n);
      const g = new Float64Array(n);
      for (let k = 0; k < m; k++) {
        const row = k * n;
        for (let i = 0; i < n; i++) {
          const ji = J[row + i];
          if (!ji) continue;
          g[i] += ji * r[k];
          for (let j = 0; j < n; j++) A[i * n + j] += ji * J[row + j];
        }
      }
      let improved = false;
      for (let tries = 0; tries < 12; tries++) {
        const M = A.slice();
        for (let i = 0; i < n; i++) M[i * n + i] += lambda * (A[i * n + i] + 1e-6);
        const delta = solveLinear(M, g.map((x) => -x), n);
        if (!delta) {
          lambda *= 10;
          continue;
        }
        const prev = v;
        v = prev.map((x, i) => x + delta[i]);
        const r2 = res();
        const c2 = sumSq(r2);
        if (c2 < cost) {
          r = r2;
          cost = c2;
          lambda = Math.max(lambda / 3, 1e-12);
          improved = true;
          break;
        }
        v = prev;
        lambda *= 4;
      }
      if (!improved) break;
    }
  }

  function jacobian(res: () => number[], r0: number[], m: number): Float64Array {
    const J = new Float64Array(m * n);
    for (let j = 0; j < n; j++) {
      const old = v[j];
      const h = 1e-7 * Math.max(1, Math.abs(old));
      v[j] = old + h;
      const r1 = res();
      v[j] = old;
      for (let k = 0; k < m; k++) J[k * n + j] = (r1[k] - r0[k]) / h;
    }
    return J;
  }

  // ---- result
  const final = constraintResiduals();
  const failed: string[] = [];
  for (const c of sk.constraints) if (residuals(c).some((x) => Math.abs(x) > 1e-6)) failed.push(c.id);
  if (implicit().some((x) => Math.abs(x) > 1e-6)) failed.push('arc');
  const ok = failed.length === 0 && errors.length === 0;
  const dof = n === 0 ? 0 : n - rank(jacobian(constraintResiduals, final, final.length), final.length, n);

  const points = sk.points.map((p) => (pIdx.has(p.id) ? { ...p, x: clean(X(p.id)), y: clean(Y(p.id)) } : p));
  const entities = sk.entities.map((e) => (e.type === 'circle' ? { ...e, r: clean(v[rIdx.get(e.id)!]) } : e));
  return { points, entities, ok, dof, failed, errors };
}

const sumSq = (r: number[]) => r.reduce((s, x) => s + x * x, 0);
/** Trims float noise so saved sketches stay readable (and diffs stay small). */
const clean = (x: number) => Math.round(x * 1e9) / 1e9 + 0;

/** Gaussian elimination with partial pivoting; null when singular. */
function solveLinear(A: Float64Array, b: Float64Array, n: number): Float64Array | null {
  const M = A.slice();
  const x = b.slice();
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r * n + col]) > Math.abs(M[piv * n + col])) piv = r;
    if (Math.abs(M[piv * n + col]) < 1e-14) return null;
    if (piv !== col) {
      for (let k = 0; k < n; k++) [M[col * n + k], M[piv * n + k]] = [M[piv * n + k], M[col * n + k]];
      [x[col], x[piv]] = [x[piv], x[col]];
    }
    const d = M[col * n + col];
    for (let r = col + 1; r < n; r++) {
      const f = M[r * n + col] / d;
      if (!f) continue;
      for (let k = col; k < n; k++) M[r * n + k] -= f * M[col * n + k];
      x[r] -= f * x[col];
    }
  }
  for (let r = n - 1; r >= 0; r--) {
    let s = x[r];
    for (let k = r + 1; k < n; k++) s -= M[r * n + k] * x[k];
    x[r] = s / M[r * n + r];
  }
  return x;
}

/** Numerical rank of an m×n matrix (row echelon with a relative tolerance). */
function rank(J: Float64Array, m: number, n: number): number {
  const M = J.slice();
  let max = 0;
  for (const x of M) max = Math.max(max, Math.abs(x));
  const tol = Math.max(max, 1) * 1e-7;
  let r = 0;
  for (let col = 0; col < n && r < m; col++) {
    let piv = r;
    for (let i = r + 1; i < m; i++) if (Math.abs(M[i * n + col]) > Math.abs(M[piv * n + col])) piv = i;
    if (Math.abs(M[piv * n + col]) < tol) continue;
    if (piv !== r) for (let k = 0; k < n; k++) [M[r * n + k], M[piv * n + k]] = [M[piv * n + k], M[r * n + k]];
    for (let i = r + 1; i < m; i++) {
      const f = M[i * n + col] / M[r * n + col];
      if (!f) continue;
      for (let k = col; k < n; k++) M[i * n + k] -= f * M[r * n + k];
    }
    r++;
  }
  return r;
}
