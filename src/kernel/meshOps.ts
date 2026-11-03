// Triangle-mesh tools for mesh parts: welding, subdivision, smoothing, and sculpt brushes.
// Pure TypeScript on flat arrays, so it runs in the worker without OpenCascade.
import type { SculptStroke, Vec3 } from '../model/types';

export interface MeshGeom {
  positions: Float32Array;
  indices: Uint32Array;
}

/** Merges vertices closer than `eps`, so triangles share corners (STL files repeat every corner). */
export function weld(m: MeshGeom, eps = 1e-4): MeshGeom {
  const map = new Map<string, number>();
  const remap = new Uint32Array(m.positions.length / 3);
  const out: number[] = [];
  const q = (v: number) => Math.round(v / eps);
  for (let i = 0; i < remap.length; i++) {
    const x = m.positions[i * 3];
    const y = m.positions[i * 3 + 1];
    const z = m.positions[i * 3 + 2];
    const key = `${q(x)},${q(y)},${q(z)}`;
    let id = map.get(key);
    if (id === undefined) {
      id = out.length / 3;
      map.set(key, id);
      out.push(x, y, z);
    }
    remap[i] = id;
  }
  const idx: number[] = [];
  for (let t = 0; t < m.indices.length; t += 3) {
    const a = remap[m.indices[t]];
    const b = remap[m.indices[t + 1]];
    const c = remap[m.indices[t + 2]];
    if (a !== b && b !== c && a !== c) idx.push(a, b, c);
  }
  return { positions: Float32Array.from(out), indices: Uint32Array.from(idx) };
}

/** Each vertex's neighbors (shared edges). */
function neighbors(m: MeshGeom): number[][] {
  const n = m.positions.length / 3;
  const sets: Set<number>[] = Array.from({ length: n }, () => new Set());
  for (let t = 0; t < m.indices.length; t += 3) {
    const a = m.indices[t];
    const b = m.indices[t + 1];
    const c = m.indices[t + 2];
    sets[a].add(b).add(c);
    sets[b].add(a).add(c);
    sets[c].add(a).add(b);
  }
  return sets.map((s) => [...s]);
}

/** Boundary vertices (on edges used by one triangle), which smoothing leaves alone. */
function boundary(m: MeshGeom): Uint8Array {
  const count = new Map<string, number>();
  const key = (a: number, b: number) => (a < b ? `${a},${b}` : `${b},${a}`);
  for (let t = 0; t < m.indices.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const e = key(m.indices[t + k], m.indices[t + ((k + 1) % 3)]);
      count.set(e, (count.get(e) ?? 0) + 1);
    }
  }
  const out = new Uint8Array(m.positions.length / 3);
  for (const [e, c] of count) {
    if (c !== 1) continue;
    const [a, b] = e.split(',').map(Number);
    out[a] = 1;
    out[b] = 1;
  }
  return out;
}

export function vertexNormals(m: MeshGeom): Float32Array {
  const n = new Float32Array(m.positions.length);
  const p = m.positions;
  for (let t = 0; t < m.indices.length; t += 3) {
    const a = m.indices[t] * 3;
    const b = m.indices[t + 1] * 3;
    const c = m.indices[t + 2] * 3;
    const ux = p[b] - p[a];
    const uy = p[b + 1] - p[a + 1];
    const uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a];
    const vy = p[c + 1] - p[a + 1];
    const vz = p[c + 2] - p[a + 2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    for (const i of [a, b, c]) {
      n[i] += nx;
      n[i + 1] += ny;
      n[i + 2] += nz;
    }
  }
  for (let i = 0; i < n.length; i += 3) {
    const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1;
    n[i] /= l;
    n[i + 1] /= l;
    n[i + 2] /= l;
  }
  return n;
}

/**
 * Loop subdivision: every triangle becomes four, and vertices move toward a smooth limit surface.
 * Boundary edges use the curve rule so open meshes keep their outline.
 */
export function subdivide(input: MeshGeom, levels = 1): MeshGeom {
  let m = weld(input);
  for (let l = 0; l < levels; l++) {
    const P = m.positions;
    const nv = P.length / 3;
    const nb = neighbors(m);
    const onEdge = boundary(m);
    // Edge points.
    const edgeId = new Map<string, number>();
    const opposite = new Map<string, number[]>();
    const key = (a: number, b: number) => (a < b ? `${a},${b}` : `${b},${a}`);
    for (let t = 0; t < m.indices.length; t += 3) {
      for (let k = 0; k < 3; k++) {
        const a = m.indices[t + k];
        const b = m.indices[t + ((k + 1) % 3)];
        const c = m.indices[t + ((k + 2) % 3)];
        const e = key(a, b);
        opposite.set(e, [...(opposite.get(e) ?? []), c]);
      }
    }
    const out: number[] = [];
    // Moved original vertices.
    for (let i = 0; i < nv; i++) {
      const ns = nb[i];
      if (onEdge[i]) {
        const bn = ns.filter((j) => (opposite.get(key(i, j)) ?? []).length === 1);
        if (bn.length === 2) {
          for (let k = 0; k < 3; k++) out.push(0.75 * P[i * 3 + k] + 0.125 * (P[bn[0] * 3 + k] + P[bn[1] * 3 + k]));
          continue;
        }
        out.push(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]);
        continue;
      }
      const n = ns.length;
      const beta = n === 3 ? 3 / 16 : 3 / (8 * n);
      for (let k = 0; k < 3; k++) {
        let s = 0;
        for (const j of ns) s += P[j * 3 + k];
        out.push((1 - n * beta) * P[i * 3 + k] + beta * s);
      }
    }
    for (const [e, opp] of opposite) {
      const [a, b] = e.split(',').map(Number);
      edgeId.set(e, out.length / 3);
      for (let k = 0; k < 3; k++) {
        if (opp.length === 2) out.push(0.375 * (P[a * 3 + k] + P[b * 3 + k]) + 0.125 * (P[opp[0] * 3 + k] + P[opp[1] * 3 + k]));
        else out.push(0.5 * (P[a * 3 + k] + P[b * 3 + k]));
      }
    }
    const idx: number[] = [];
    for (let t = 0; t < m.indices.length; t += 3) {
      const a = m.indices[t];
      const b = m.indices[t + 1];
      const c = m.indices[t + 2];
      const ab = edgeId.get(key(a, b))!;
      const bc = edgeId.get(key(b, c))!;
      const ca = edgeId.get(key(c, a))!;
      idx.push(a, ab, ca, b, bc, ab, c, ca, bc, ab, bc, ca);
    }
    m = { positions: Float32Array.from(out), indices: Uint32Array.from(idx) };
  }
  return m;
}

/** Taubin smoothing: alternating shrink and inflate steps, which smooths without losing volume. */
export function smooth(input: MeshGeom, iterations = 5, mask?: Float32Array): MeshGeom {
  const m = weld(input);
  const nb = neighbors(m);
  const fixed = boundary(m);
  const P = Float32Array.from(m.positions);
  const step = (k: number) => {
    const next = Float32Array.from(P);
    for (let i = 0; i < nb.length; i++) {
      if (fixed[i] || !nb[i].length) continue;
      const w = mask ? mask[i] : 1;
      if (!w) continue;
      for (let c = 0; c < 3; c++) {
        let s = 0;
        for (const j of nb[i]) s += P[j * 3 + c];
        next[i * 3 + c] = P[i * 3 + c] + k * w * (s / nb[i].length - P[i * 3 + c]);
      }
    }
    P.set(next);
  };
  for (let i = 0; i < iterations; i++) {
    step(0.5);
    step(-0.53);
  }
  return { positions: P, indices: m.indices };
}

// ---------------------------------------------------------------- sculpting

const falloff = (d: number, r: number) => {
  if (d >= r) return 0;
  const t = d / r;
  return (1 - t * t) * (1 - t * t); // smooth bump
};

/** Replays sculpt strokes on a mesh. The mesh is welded first so brushes move shared corners together. */
export function sculpt(input: MeshGeom, strokes: SculptStroke[]): MeshGeom {
  let m = weld(input);
  for (const s of strokes) m = applyStroke(m, s);
  return m;
}

function applyStroke(m: MeshGeom, s: SculptStroke): MeshGeom {
  const P = Float32Array.from(m.positions);
  const nv = P.length / 3;
  const r = Math.max(s.radius, 1e-3);
  const dist = (i: number, c: Vec3) => Math.hypot(P[i * 3] - c[0], P[i * 3 + 1] - c[1], P[i * 3 + 2] - c[2]);

  if (s.brush === 'grab') {
    const from = s.points[0];
    const to = s.points[s.points.length - 1];
    const d: Vec3 = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
    for (let i = 0; i < nv; i++) {
      const w = falloff(dist(i, from), r) * s.strength;
      if (!w) continue;
      P[i * 3] += d[0] * w;
      P[i * 3 + 1] += d[1] * w;
      P[i * 3 + 2] += d[2] * w;
    }
    return { positions: P, indices: m.indices };
  }

  if (s.brush === 'smooth') {
    const mask = new Float32Array(nv);
    for (const c of s.points) for (let i = 0; i < nv; i++) mask[i] = Math.max(mask[i], falloff(dist(i, c), r) * s.strength);
    return smooth({ positions: P, indices: m.indices }, 2, mask);
  }

  const normals = vertexNormals({ positions: P, indices: m.indices });
  const sign = s.brush === 'deflate' ? -1 : 1;
  // Each sample along the stroke pushes vertices a little, so the effect follows the path evenly.
  const per = (s.strength * r * 0.25) / Math.max(1, s.points.length / 4);
  for (const c of s.points) {
    for (let i = 0; i < nv; i++) {
      const w = falloff(dist(i, c), r);
      if (!w) continue;
      if (s.brush === 'flatten') {
        // Pull toward the plane through the stroke point, facing the stroke normal.
        const n = s.normal;
        const off = (P[i * 3] - c[0]) * n[0] + (P[i * 3 + 1] - c[1]) * n[1] + (P[i * 3 + 2] - c[2]) * n[2];
        const k = Math.min(1, w * s.strength * 0.5);
        P[i * 3] -= n[0] * off * k;
        P[i * 3 + 1] -= n[1] * off * k;
        P[i * 3 + 2] -= n[2] * off * k;
      } else {
        P[i * 3] += normals[i * 3] * per * w * sign;
        P[i * 3 + 1] += normals[i * 3 + 1] * per * w * sign;
        P[i * 3 + 2] += normals[i * 3 + 2] * per * w * sign;
      }
    }
  }
  return { positions: P, indices: m.indices };
}
