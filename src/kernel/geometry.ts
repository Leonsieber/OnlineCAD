// OpenCascade helpers that run inside the geometry worker.
import opencascade from 'replicad-opencascadejs';
import wasmUrl from 'replicad-opencascadejs/wasm?url';
import {
  Compound,
  cast,
  draw,
  drawCircle,
  drawEllipse,
  getOC,
  makeBox,
  makeCylinder,
  makeEllipsoid,
  makeSphere,
  measureArea,
  measureShapeVolumeProperties,
  setOC,
  type AnyShape,
  type Shape3D,
  type Sketch,
} from 'replicad';
import { polygonVertices } from '../model/primitiveBox';
import type { EdgeRef, FaceRef, PrimitiveKind, Vec3 } from '../model/types';
import { EDGE_INFO_STRIDE, FACE_INFO_STRIDE, type MeshData } from './protocol';

let ready: Promise<void> | null = null;
export function initOCC(): Promise<void> {
  ready ??= opencascade({ locateFile: () => wasmUrl }).then((oc) => {
    setOC(oc);
  });
  return ready;
}

/** Errors whose message is safe and helpful to show to the user as-is. */
export class UserError extends Error {}

/** The feature is just missing input (nothing picked yet); dialogs show this as a hint, not a failure. */
export class IncompleteError extends UserError {}

type VecLike = { toTuple(): [number, number, number]; delete(): void };
function tuple(v: VecLike): Vec3 {
  const t = v.toTuple();
  v.delete();
  return t;
}

export function safeDelete(s: { delete(): void } | undefined | null) {
  try {
    s?.delete();
  } catch {
    // already freed
  }
}

/** Compounds that hold a single solid behave better as plain solids (cleaner selection, export). */
export function unwrapSolid(s: AnyShape): AnyShape {
  if (s instanceof Compound) {
    const solids = s.solids;
    if (solids.length === 1) {
      s.delete();
      return solids[0];
    }
    solids.forEach((x) => x.delete());
  }
  return s;
}

export function isEmpty(s: AnyShape): boolean {
  const faces = s.faces;
  const empty = faces.length === 0;
  faces.forEach((f) => f.delete());
  return empty;
}

function positive(p: Record<string, number>, key: string, label: string): number {
  const v = p[key];
  if (!(v > 0)) throw new UserError(`${label} must be greater than 0`);
  return v;
}

const near = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));

/** Circle or ellipse centered on the origin (OpenCascade wants the larger radius first). */
function ellipseDrawing(rx: number, ry: number) {
  if (near(rx, ry)) return drawCircle(rx);
  return rx > ry ? drawEllipse(rx, ry) : drawEllipse(ry, rx).rotate(90, [0, 0]);
}

function polygonDrawing(sides: number, r: number, sx: number, sy: number) {
  const v = polygonVertices(sides, r).map(([x, y]) => [x * sx, y * sy] as [number, number]);
  let pen = draw(v[0]);
  for (const q of v.slice(1)) pen = pen.lineTo(q);
  return pen.close();
}

function sides(p: Record<string, number>) {
  const n = Math.round(p.sides);
  if (n < 3 || n > 64) throw new UserError('Sides must be between 3 and 64');
  return n;
}

/**
 * Builds a primitive in its local frame: centered on the Z axis, sitting on the XY plane.
 * `stretch` scales it along its own X, Y, Z; curved shapes become elliptical (built exactly, not approximated).
 */
export function makePrimitive(kind: PrimitiveKind, p: Record<string, number>, stretch: Vec3 = [1, 1, 1]): AnyShape {
  const [sx, sy, sz] = stretch;
  if (!(sx > 0 && sy > 0 && sz > 0)) throw new UserError('Stretch must be greater than 0');
  const xyRound = near(sx, sy);
  switch (kind) {
    case 'box': {
      const w = positive(p, 'width', 'Width') * sx;
      const d = positive(p, 'depth', 'Depth') * sy;
      const h = positive(p, 'height', 'Height') * sz;
      return makeBox([-w / 2, -d / 2, 0], [w / 2, d / 2, h]);
    }
    case 'cylinder': {
      const r = positive(p, 'radius', 'Radius');
      const h = positive(p, 'height', 'Height') * sz;
      if (xyRound) return makeCylinder(r * sx, h, [0, 0, 0], [0, 0, 1]);
      return (ellipseDrawing(r * sx, r * sy).sketchOnPlane('XY') as Sketch).extrude(h);
    }
    case 'sphere': {
      const r = positive(p, 'radius', 'Radius');
      if (xyRound && near(sx, sz)) return makeSphere(r * sx).translate([0, 0, r * sx]);
      return makeEllipsoid(r * sx, r * sy, r * sz).translate([0, 0, r * sz]);
    }
    case 'cone': {
      const r1 = p.bottomRadius;
      const r2 = p.topRadius;
      const h = positive(p, 'height', 'Height') * sz;
      if (r1 < 0 || r2 < 0) throw new UserError('Radii cannot be negative');
      if (r1 === 0 && r2 === 0) throw new UserError('Set a bottom or top radius');
      if (xyRound) {
        let pen = draw([0, 0]);
        if (r1 > 0) pen = pen.hLine(r1 * sx);
        pen = pen.lineTo([r2 * sx, h]);
        if (r2 > 0) pen = pen.hLineTo(0);
        return (pen.close().sketchOnPlane('XZ') as Sketch).revolve([0, 0, 1], { origin: [0, 0, 0] });
      }
      // Elliptical cone: loft between the two ellipses (or to the apex point).
      const bottom = r1 > 0 ? (ellipseDrawing(r1 * sx, r1 * sy).sketchOnPlane('XY') as Sketch) : null;
      const top = r2 > 0 ? (ellipseDrawing(r2 * sx, r2 * sy).sketchOnPlane('XY', h) as Sketch) : null;
      if (bottom && top) return bottom.loftWith(top);
      if (bottom) return bottom.loftWith([], { endPoint: [0, 0, h] });
      return top!.loftWith([], { endPoint: [0, 0, 0] });
    }
    case 'torus': {
      const R = positive(p, 'majorRadius', 'Ring radius');
      const r = positive(p, 'minorRadius', 'Tube radius');
      if (r >= R) throw new UserError('Tube radius must be smaller than the ring radius');
      if (!xyRound) throw new UserError('A torus stretches evenly in X and Y');
      if (near(sx, sz)) {
        const oc = getOC();
        const maker = new oc.BRepPrimAPI_MakeTorus(R * sx, r * sx);
        const shape = cast(maker.Shape());
        maker.delete();
        return shape.translate([0, 0, r * sx]);
      }
      // Flattened or tall torus: revolve an elliptical tube section.
      const section = ellipseDrawing(r * sx, r * sz).translate(R * sx, r * sz);
      return (section.sketchOnPlane('XZ') as Sketch).revolve([0, 0, 1], { origin: [0, 0, 0] });
    }
    case 'tube': {
      const R = positive(p, 'outerRadius', 'Outer radius');
      const r = positive(p, 'innerRadius', 'Inner radius');
      const h = positive(p, 'height', 'Height') * sz;
      if (r >= R) throw new UserError('Inner radius must be smaller than the outer radius');
      return (ellipseDrawing(R * sx, R * sy).cut(ellipseDrawing(r * sx, r * sy)).sketchOnPlane('XY') as Sketch).extrude(h);
    }
    case 'wedge': {
      const w = positive(p, 'width', 'Width') * sx;
      const d = positive(p, 'depth', 'Depth') * sy;
      const h = positive(p, 'height', 'Height') * sz;
      // Sketches on XZ extrude toward -Y, so shift by half the depth to center it.
      const solid = (draw([-w / 2, 0]).hLine(w).lineTo([-w / 2, h]).close().sketchOnPlane('XZ') as Sketch).extrude(d);
      return solid.translate([0, d / 2, 0]);
    }
    case 'pyramid': {
      const r = positive(p, 'radius', 'Base radius');
      const h = positive(p, 'height', 'Height') * sz;
      return (polygonDrawing(sides(p), r, sx, sy).sketchOnPlane('XY') as Sketch).loftWith([], { endPoint: [0, 0, h] });
    }
    case 'prism': {
      const r = positive(p, 'radius', 'Radius');
      const h = positive(p, 'height', 'Height') * sz;
      return (polygonDrawing(sides(p), r, sx, sy).sketchOnPlane('XY') as Sketch).extrude(h);
    }
    case 'ellipsoid': {
      const a = positive(p, 'radiusX', 'Radius X') * sx;
      const b = positive(p, 'radiusY', 'Radius Y') * sy;
      const c = positive(p, 'radiusZ', 'Radius Z') * sz;
      return makeEllipsoid(a, b, c).translate([0, 0, c]);
    }
  }
}

/** Rotates about world X, then Y, then Z (degrees) around `pivot`, scales about `pivot`, then translates. */
export function transformShape(shape: AnyShape, t: Vec3, r: Vec3, pivot: Vec3, scale = 1): AnyShape {
  let s: AnyShape = shape;
  if (r[0]) s = s.rotate(r[0], pivot, [1, 0, 0]);
  if (r[1]) s = s.rotate(r[1], pivot, [0, 1, 0]);
  if (r[2]) s = s.rotate(r[2], pivot, [0, 0, 1]);
  if (scale !== 1) s = s.scale(scale, pivot);
  if (t[0] || t[1] || t[2]) s = s.translate(t);
  return s;
}

/** 3x4 row-major matrix equivalent of transformShape (plus a per-axis world stretch), for mesh parts. */
export function transformMatrix(t: Vec3, r: Vec3, pivot: Vec3, scale = 1, stretch: Vec3 = [1, 1, 1]): number[] {
  const rad = Math.PI / 180;
  const [cx, sx] = [Math.cos(r[0] * rad), Math.sin(r[0] * rad)];
  const [cy, sy] = [Math.cos(r[1] * rad), Math.sin(r[1] * rad)];
  const [cz, sz] = [Math.cos(r[2] * rad), Math.sin(r[2] * rad)];
  // M = Stretch * scale * Rz * Ry * Rx
  const R = [
    cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx,
    sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx,
    -sy, cy * sx, cy * cx,
  ].map((v, i) => v * scale * stretch[Math.floor(i / 3)]);
  const m: number[] = [];
  for (let i = 0; i < 3; i++) {
    const rp = R[i * 3] * pivot[0] + R[i * 3 + 1] * pivot[1] + R[i * 3 + 2] * pivot[2];
    m.push(R[i * 3], R[i * 3 + 1], R[i * 3 + 2], pivot[i] - rp + t[i]);
  }
  return m;
}

export function applyMatrix(positions: Float32Array, m: number[]): Float32Array {
  const out = new Float32Array(positions.length);
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i];
    const y = positions[i + 1];
    const z = positions[i + 2];
    out[i] = m[0] * x + m[1] * y + m[2] * z + m[3];
    out[i + 1] = m[4] * x + m[5] * y + m[6] * z + m[7];
    out[i + 2] = m[8] * x + m[9] * y + m[10] * z + m[11];
  }
  return out;
}

/** Mirror matrix through an axis-aligned plane; callers must also flip triangle winding. */
export function mirrorMatrix(plane: 'YZ' | 'XZ' | 'XY', offset: number): number[] {
  const axis = plane === 'YZ' ? 0 : plane === 'XZ' ? 1 : 2;
  const m = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
  m[axis * 4 + axis] = -1;
  m[axis * 4 + 3] = 2 * offset;
  return m;
}

export function flipWinding(indices: Uint32Array): Uint32Array {
  const out = new Uint32Array(indices.length);
  for (let i = 0; i < indices.length; i += 3) {
    out[i] = indices[i];
    out[i + 1] = indices[i + 2];
    out[i + 2] = indices[i + 1];
  }
  return out;
}

// ---- Fingerprints: let references find the same edge/face after the model rebuilds ----

const CURVE_CODES: Record<string, number> = { LINE: 1, CIRCLE: 2, ELLIPSE: 3, BSPLINE_CURVE: 4, BEZIER_CURVE: 4 };
const SURFACE_CODES: Record<string, number> = { PLANE: 1, CYLINDRE: 2, CONE: 3, SPHERE: 4, TORUS: 5 };

function edgeFingerprints(shape: AnyShape) {
  const edges = shape.edges;
  const fp = new Float64Array(edges.length * EDGE_INFO_STRIDE);
  edges.forEach((e, i) => {
    const o = i * EDGE_INFO_STRIDE;
    fp.set(tuple(e.pointAt(0.5)), o);
    fp.set(tuple(e.startPoint), o + 3);
    fp.set(tuple(e.endPoint), o + 6);
    fp[o + 9] = e.length;
    fp[o + 10] = CURVE_CODES[e.geomType] ?? 9;
  });
  return { edges, fp };
}

function normalize(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

function faceFingerprints(shape: AnyShape) {
  const faces = shape.faces;
  const fp = new Float64Array(faces.length * FACE_INFO_STRIDE);
  faces.forEach((f, i) => {
    const o = i * FACE_INFO_STRIDE;
    const c = f.center;
    fp.set(c.toTuple(), o);
    let n: Vec3 = [0, 0, 1];
    try {
      n = normalize(tuple(f.normalAt(c)));
    } catch {
      // some surfaces have no normal at their mass center; keep the default
    }
    c.delete();
    fp.set(n, o + 3);
    fp[o + 6] = measureArea(f);
    fp[o + 7] = SURFACE_CODES[f.geomType] ?? 9;
  });
  return { faces, fp };
}

const d3 = (a: ArrayLike<number>, ao: number, b: ArrayLike<number>, bo: number) =>
  Math.hypot(a[ao] - b[bo], a[ao + 1] - b[bo + 1], a[ao + 2] - b[bo + 2]);

// A different curve or surface type is almost never the same entity, so it only wins as a last resort.
const TYPE_MISMATCH = 1e6;

function edgeScore(fp: Float64Array, o: number, r: number[]) {
  const ends = Math.min(d3(fp, o + 3, r, 3) + d3(fp, o + 6, r, 6), d3(fp, o + 3, r, 6) + d3(fp, o + 6, r, 3));
  const typeCost = r.length > 10 && r[10] !== fp[o + 10] ? TYPE_MISMATCH : 0;
  return d3(fp, o, r, 0) + 0.5 * ends + 0.5 * Math.abs(fp[o + 9] - r[9]) + typeCost;
}

function faceScore(fp: Float64Array, o: number, r: number[], scale: number) {
  const dot = fp[o + 3] * r[3] + fp[o + 4] * r[4] + fp[o + 5] * r[5];
  const typeCost = r.length > 7 && r[7] !== fp[o + 7] ? TYPE_MISMATCH : 0;
  return d3(fp, o, r, 0) + scale * 0.2 * (1 - dot) + 0.2 * Math.abs(Math.sqrt(fp[o + 6]) - Math.sqrt(Math.max(r[6], 0))) + typeCost;
}

function bestMatch(count: number, preferred: number, score: (i: number) => number): number {
  if (count === 0) return -1;
  if (preferred >= 0 && preferred < count && score(preferred) < 1e-5) return preferred;
  let best = 0;
  let bestScore = Infinity;
  for (let i = 0; i < count; i++) {
    const s = score(i);
    if (s < bestScore) {
      bestScore = s;
      best = i;
    }
  }
  return best;
}

export function resolveEdges(shape: AnyShape, refs: EdgeRef[]): Set<number> {
  const { edges, fp } = edgeFingerprints(shape);
  // Seams are never shown or picked, so they must never be matched either.
  const seams = seamEdgeHashes(shape);
  const isSeam = edges.map((e) => seams.has(e.hashCode));
  const hashes = new Set<number>();
  for (const ref of refs) {
    const i = bestMatch(edges.length, ref.index, (k) => (isSeam[k] ? Infinity : edgeScore(fp, k * EDGE_INFO_STRIDE, ref.fp)));
    if (i >= 0) hashes.add(edges[i].hashCode);
  }
  edges.forEach((e) => e.delete());
  return hashes;
}

export function resolveFaces(shape: AnyShape, refs: FaceRef[]): Set<number> {
  const { faces, fp } = faceFingerprints(shape);
  const bb = shape.boundingBox;
  const scale = Math.max(bb.width, bb.height, bb.depth, 1);
  bb.delete();
  const hashes = new Set<number>();
  for (const ref of refs) {
    const i = bestMatch(faces.length, ref.index, (k) => faceScore(fp, k * FACE_INFO_STRIDE, ref.fp, scale));
    if (i >= 0) hashes.add(faces[i].hashCode);
  }
  faces.forEach((f) => f.delete());
  return hashes;
}

/**
 * Seam edges (the closing edge of a cylinder or sphere face, never drawn) and which faces touch each edge.
 * The caller owns the returned faces and must delete them.
 */
function edgeTopology(shape: AnyShape) {
  const oc = getOC();
  const faces = shape.faces;
  const seams = new Set<number>();
  // For each edge: the faces it bounds, and whether it runs forward in that face's boundary.
  const adjacent = new Map<number, { fi: number; forward: boolean }[]>();
  faces.forEach((face, fi) => {
    for (const edge of face.edges) {
      const h = edge.hashCode;
      if (oc.BRep_Tool.IsClosed(edge.wrapped, face.wrapped)) seams.add(h);
      const list = adjacent.get(h) ?? [];
      if (!list.some((a) => a.fi === fi)) list.push({ fi, forward: edge.orientation === 'forward' });
      adjacent.set(h, list);
      edge.delete();
    }
  });
  return { faces, seams, adjacent };
}

const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/**
 * Direction from an edge toward where a fillet or chamfer surface ends up, scaled so its length is
 * 2·cos(half the angle between the faces). Outside corners point into the material, inside corners
 * into the open air. Uses the boundary rule: a face's material lies to the left of its oriented edges.
 */
function filletDirection(e: { tangentAt(t: number): VecLike }, mid: Vec3, adj: { fi: number; forward: boolean }[], faces: { normalAt(p: Vec3): VecLike }[]): Vec3 {
  const normals: Vec3[] = [];
  for (const a of adj.slice(0, 2)) {
    try {
      normals.push(normalize(tuple(faces[a.fi].normalAt(mid))));
    } catch {
      // degenerate face: skip it
    }
  }
  if (!normals.length) return [0, 0, 0];
  const sum: Vec3 = normals.length === 2 ? [normals[0][0] + normals[1][0], normals[0][1] + normals[1][1], normals[0][2] + normals[1][2]] : [normals[0][0] * 2, normals[0][1] * 2, normals[0][2] * 2];
  let convex = true;
  if (normals.length === 2) {
    const t = normalize(tuple(e.tangentAt(0.5)));
    const t1: Vec3 = adj[0].forward ? t : [-t[0], -t[1], -t[2]];
    const intoFace1 = cross(normals[0], t1);
    convex = dot(intoFace1, normals[1]) < 0;
  }
  return convex ? [-sum[0], -sum[1], -sum[2]] : sum;
}

function seamEdgeHashes(shape: AnyShape): Set<number> {
  const { faces, seams } = edgeTopology(shape);
  faces.forEach((f) => f.delete());
  return seams;
}

export function boundsOf(shape: AnyShape): [Vec3, Vec3] {
  const bb = shape.boundingBox;
  const b = bb.bounds;
  bb.delete();
  return [b[0], b[1]];
}

export function meshBrep(shape: AnyShape, key: string, fine = false): MeshData {
  const [mn, mx] = boundsOf(shape);
  const diag = Math.hypot(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]) || 1;
  const tolerance = Math.min(Math.max(diag * (fine ? 0.0002 : 0.0006), 0.001), fine ? 0.05 : 0.3);
  const angularTolerance = fine ? 0.1 : 0.2;
  const m = shape.mesh({ tolerance, angularTolerance });

  const groups = new Map<number, { start: number; count: number }>();
  for (const g of m.faceGroups) groups.set(g.faceId, g);
  const { faces, fp: faceFp } = faceFingerprints(shape);
  const faceRanges = new Uint32Array(faces.length * 2);
  faces.forEach((f, i) => {
    const g = groups.get(f.hashCode);
    faceRanges[i * 2] = g?.start ?? 0;
    faceRanges[i * 2 + 1] = g?.count ?? 0;
    f.delete();
  });

  const em = shape.meshEdges({ tolerance, angularTolerance });
  const egroups = new Map<number, { start: number; count: number }>();
  for (const g of em.edgeGroups) egroups.set(g.edgeId, g);
  const topo = edgeTopology(shape);
  const { edges, fp: edgeFp } = edgeFingerprints(shape);
  const edgeRanges = new Uint32Array(edges.length * 2);
  const linePts: number[] = [];
  edges.forEach((e, i) => {
    const h = e.hashCode;
    const g = egroups.get(h);
    edgeRanges[i * 2] = linePts.length / 3;
    if (g && !topo.seams.has(h)) {
      for (let k = g.start * 3; k < (g.start + g.count) * 3; k++) linePts.push(em.lines[k]);
      edgeRanges[i * 2 + 1] = g.count;
      // Where a fillet/chamfer on this edge lives, for the drag arrow in the dialog.
      const o = i * EDGE_INFO_STRIDE;
      const mid: Vec3 = [edgeFp[o], edgeFp[o + 1], edgeFp[o + 2]];
      try {
        edgeFp.set(filletDirection(e, mid, topo.adjacent.get(h) ?? [], topo.faces), o + 11);
      } catch {
        // leave zeros; the arrow falls back to pointing toward the part's center
      }
    }
    e.delete();
  });
  topo.faces.forEach((f) => f.delete());

  const positions = Float32Array.from(m.vertices);
  const normals = Float32Array.from(m.normals);
  const indices = Uint32Array.from(m.triangles);
  weldSeamNormals(positions, normals, indices, faceRanges);
  return {
    key,
    kind: 'brep',
    positions,
    normals,
    indices,
    faceRanges,
    edgePositions: Float32Array.from(linePts),
    edgeRanges,
    faceInfo: Float32Array.from(faceFp),
    edgeInfo: Float32Array.from(edgeFp),
  };
}

/**
 * Periodic faces (cylinders, spheres) are meshed with duplicated vertices along their seam, and each
 * copy only sees triangles from one side, which leaves a visible crease. Average normals of
 * coincident vertices within the same face; separate faces keep their sharp edges.
 */
function weldSeamNormals(positions: Float32Array, normals: Float32Array, indices: Uint32Array, faceRanges: Uint32Array) {
  if (normals.length !== positions.length) return;
  const q = 1e4;
  for (let f = 0; f < faceRanges.length / 2; f++) {
    const start = faceRanges[f * 2];
    const end = start + faceRanges[f * 2 + 1];
    const groups = new Map<string, number[]>();
    const seen = new Set<number>();
    for (let k = start; k < end; k++) {
      const v = indices[k];
      if (seen.has(v)) continue;
      seen.add(v);
      const key = `${Math.round(positions[v * 3] * q)},${Math.round(positions[v * 3 + 1] * q)},${Math.round(positions[v * 3 + 2] * q)}`;
      const g = groups.get(key);
      if (g) g.push(v);
      else groups.set(key, [v]);
    }
    for (const vs of groups.values()) {
      if (vs.length < 2) continue;
      let x = 0;
      let y = 0;
      let z = 0;
      for (const v of vs) {
        x += normals[v * 3];
        y += normals[v * 3 + 1];
        z += normals[v * 3 + 2];
      }
      const l = Math.hypot(x, y, z) || 1;
      for (const v of vs) {
        normals[v * 3] = x / l;
        normals[v * 3 + 1] = y / l;
        normals[v * 3 + 2] = z / l;
      }
    }
  }
}

export function meshTriangles(shape: AnyShape): { positions: Float32Array; indices: Uint32Array } {
  const [mn, mx] = boundsOf(shape);
  const diag = Math.hypot(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]) || 1;
  const m = shape.mesh({ tolerance: Math.min(Math.max(diag * 0.0002, 0.001), 0.05), angularTolerance: 0.1 });
  return { positions: Float32Array.from(m.vertices), indices: Uint32Array.from(m.triangles) };
}

export function measureShape(shape: AnyShape) {
  const solids = shape.solids;
  const solid = solids.length > 0;
  solids.forEach((s) => s.delete());
  let volume = 0;
  let centerOfMass: Vec3 = [0, 0, 0];
  if (solid) {
    const props = measureShapeVolumeProperties(shape as Shape3D);
    volume = props.volume;
    centerOfMass = props.centerOfMass;
    props.delete();
  }
  return { volume, area: measureArea(shape as Shape3D), centerOfMass, bbox: boundsOf(shape), solid };
}

/** OpenCascade failures surface as opaque WebAssembly exceptions; turn them into advice. */
export function describeError(e: unknown, featureType: string): string {
  if (e instanceof UserError) return e.message;
  const msg = e instanceof Error ? e.message : String(e);
  const opaque = !msg || msg.includes('WebAssembly.Exception') || /^\d+$/.test(msg);
  if (!opaque && !/Could not/.test(msg)) return msg;
  switch (featureType) {
    case 'fillet':
      return 'Fillet failed. Try a smaller radius or fewer edges.';
    case 'chamfer':
      return 'Chamfer failed. Try a smaller distance or fewer edges.';
    case 'shell':
      return 'Shell failed. Try a thinner wall or a different face.';
    case 'boolean':
      return 'Boolean failed. Check that the parts are solids and touch or overlap.';
    case 'import':
      return 'Could not read this file.';
    default:
      return opaque ? 'The geometry kernel could not build this feature.' : msg;
  }
}
