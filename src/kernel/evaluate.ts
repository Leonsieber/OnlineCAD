// Rebuilds the feature history into parts. Runs in the geometry worker.
// Each feature's output state is cached by a chain hash, so editing feature N only rebuilds N and later.
import { exportSTEP, importSTEP, type AnyShape } from 'replicad';
import { PRIMITIVES } from '../model/defaults';
import { evalNum, evalVariables } from '../model/expr';
import { hashString } from '../model/hash';
import { base64ToBytes, unpackMeshes } from '../model/meshPack';
import type { AxisName, Feature, NumExpr, Vec3, Vec3Expr } from '../model/types';
import {
  IncompleteError,
  UserError,
  applyMatrix,
  boundsOf,
  describeError,
  flipWinding,
  isEmpty,
  makePrimitive,
  measureShape,
  meshBrep,
  meshTriangles,
  mirrorMatrix,
  resolveEdges,
  resolveFaces,
  safeDelete,
  transformMatrix,
  transformShape,
  unwrapSolid,
} from './geometry';
import type { EvalRequest, EvalResult, ExportMesh, FeatureStatus, MeasureResult, MeshData, PartResult } from './protocol';

interface MeshGeom {
  positions: Float32Array;
  indices: Uint32Array;
}

interface PartState {
  id: string;
  kind: 'brep' | 'mesh';
  shape?: AnyShape;
  mesh?: MeshGeom;
  key: string;
  source: string;
  last: string;
  label: string;
  inherit?: string;
  color?: string;
}

type State = Map<string, PartState>;

interface Entry {
  key: string;
  state: State;
  status: FeatureStatus;
  owned: AnyShape[];
}

interface Ctx {
  scope: Record<string, number>;
  owned: AnyShape[];
}

let entries: Entry[] = [];
let lastState: State = new Map();
let sentKeys = new Set<string>();
const bboxCache = new Map<string, [Vec3, Vec3]>();
const blobs = new Map<string, string>();
let keySeq = 0;
const newKey = () => `k${++keySeq}`;

export function putBlob(hash: string, data: string) {
  blobs.set(hash, data);
}

export function hasBlob(hash: string) {
  return blobs.has(hash);
}

/** Forget which meshes the UI already has, so the next result resends all of them. */
export function resetSent() {
  sentKeys = new Set();
}

function freeEntry(e: Entry) {
  for (const s of e.owned) safeDelete(s);
  e.owned = [];
}

function featureKey(f: Feature): string {
  // Names don't change geometry, and import payloads are identified by their hash.
  const { name: _name, ...rest } = f;
  if (f.type === 'import') return JSON.stringify({ ...rest, data: undefined });
  return JSON.stringify(rest);
}

export async function evaluate(req: EvalRequest): Promise<EvalResult> {
  const t0 = performance.now();
  const { scope, errors } = evalVariables(req.variables);
  let chain = hashString(JSON.stringify(req.variables));
  let state: State = new Map();
  const statuses: Record<string, FeatureStatus> = {};
  const next: Entry[] = [];
  let reusing = true;

  for (let i = 0; i < req.features.length; i++) {
    const f = req.features[i];
    chain = hashString(`${chain}|${featureKey(f)}`);
    const cached = entries[i];
    if (reusing && cached && cached.key === chain) {
      next.push(cached);
      state = cached.state;
      statuses[f.id] = cached.status;
      continue;
    }
    if (reusing) {
      for (let j = i; j < entries.length; j++) freeEntry(entries[j]);
      reusing = false;
    }
    const ctx: Ctx = { scope, owned: [] };
    let status: FeatureStatus;
    let result = state;
    if (f.suppressed) {
      status = { state: 'suppressed' };
    } else {
      const ft = performance.now();
      try {
        result = await applyFeature(f, state, ctx);
        status = { state: 'ok', ms: performance.now() - ft };
      } catch (e) {
        for (const s of ctx.owned) safeDelete(s);
        ctx.owned = [];
        result = state;
        status = { state: 'error', message: describeError(e, f.type), incomplete: e instanceof IncompleteError };
        console.warn(`[kernel] ${f.name}:`, e);
      }
    }
    next.push({ key: chain, state: result, status, owned: ctx.owned });
    state = result;
    statuses[f.id] = status;
  }
  if (reusing) for (let j = req.features.length; j < entries.length; j++) freeEntry(entries[j]);
  entries = next;
  lastState = state;

  const parts: PartResult[] = [];
  const meshes: MeshData[] = [];
  const keys = new Set<string>();
  for (const p of state.values()) {
    keys.add(p.key);
    let bbox = bboxCache.get(p.key);
    if (!bbox) {
      bbox = p.shape ? boundsOf(p.shape) : meshBounds(p.mesh!.positions);
      bboxCache.set(p.key, bbox);
    }
    parts.push({ id: p.id, kind: p.kind, key: p.key, bbox, source: p.source, last: p.last, label: p.label, inherit: p.inherit, color: p.color });
    if (!sentKeys.has(p.key)) {
      try {
        meshes.push(p.shape ? meshBrep(p.shape, p.key) : meshPart(p.mesh!, p.key));
      } catch (e) {
        console.warn('[kernel] meshing failed', e);
        meshes.push(meshPart({ positions: new Float32Array(), indices: new Uint32Array() }, p.key));
      }
    }
  }
  for (const k of bboxCache.keys()) if (!keys.has(k)) bboxCache.delete(k);
  sentKeys = keys;
  return { seq: req.seq, parts, meshes, statuses, variables: scope, variableErrors: errors, ms: performance.now() - t0 };
}

function meshBounds(pos: Float32Array): [Vec3, Vec3] {
  if (pos.length === 0) return [[0, 0, 0], [0, 0, 0]];
  const mn: Vec3 = [Infinity, Infinity, Infinity];
  const mx: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = pos[i + k];
      if (v < mn[k]) mn[k] = v;
      if (v > mx[k]) mx[k] = v;
    }
  }
  return [mn, mx];
}

function meshPart(m: MeshGeom, key: string): MeshData {
  return {
    key,
    kind: 'mesh',
    positions: m.positions.slice(),
    normals: new Float32Array(),
    indices: m.indices.slice(),
    faceRanges: Uint32Array.of(0, m.indices.length),
    edgePositions: new Float32Array(),
    edgeRanges: new Uint32Array(),
    faceInfo: new Float32Array(),
    edgeInfo: new Float32Array(),
  };
}

const AXES: Record<AxisName, Vec3> = { X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1] };

async function applyFeature(f: Feature, state: State, ctx: Ctx): Promise<State> {
  const num = (v: NumExpr, label: string) => {
    try {
      return evalNum(v, ctx.scope);
    } catch (e) {
      throw new UserError(`${label}: ${(e as Error).message}`);
    }
  };
  const vec = (v: Vec3Expr, label: string): Vec3 => [num(v[0], `${label} X`), num(v[1], `${label} Y`), num(v[2], `${label} Z`)];
  const own = <T extends AnyShape>(s: T): T => {
    ctx.owned.push(s);
    return s;
  };
  const part = (id: string, role = 'Part') => {
    const p = state.get(id);
    if (!p) throw new UserError(`${role} is missing. It may have been deleted or merged by an earlier feature.`);
    return p;
  };
  const solid = (id: string, role = 'Part') => {
    const p = part(id, role);
    if (p.kind !== 'brep' || !p.shape) throw new UserError(`"${p.label}" is a mesh. This operation needs a solid part.`);
    return p as PartState & { shape: AnyShape };
  };
  const next = new Map(state);
  const update = (p: PartState, shape: AnyShape) => next.set(p.id, { ...p, shape: own(shape), key: newKey(), last: f.id });

  switch (f.type) {
    case 'primitive': {
      const params: Record<string, number> = {};
      for (const def of PRIMITIVES[f.kind].params) {
        let v = num(f.params[def.key] ?? def.def, def.label);
        if (def.integer) v = Math.round(v);
        params[def.key] = v;
      }
      const pos = vec(f.placement.position, 'Position');
      const rot = vec(f.placement.rotation, 'Rotation');
      const shape = transformShape(unwrapSolid(makePrimitive(f.kind, params)), pos, rot, [0, 0, 0]);
      next.set(f.id, { id: f.id, kind: 'brep', shape: own(shape), key: newKey(), source: f.id, last: f.id, label: f.name });
      return next;
    }

    case 'boolean': {
      if (f.op === 'subtract') {
        if (!f.targets.length) throw new IncompleteError('Pick the part to cut from');
        if (!f.tools.length) throw new IncompleteError('Pick the parts to subtract');
        const tools = f.tools.map((id) => solid(id, 'Tool part'));
        for (const tid of f.targets) {
          const target = solid(tid, 'Target part');
          let acc: AnyShape = target.shape;
          for (const tool of tools) {
            if (tool.id === target.id) throw new UserError('A part cannot subtract itself');
            const r: AnyShape = (acc as never as { cut(o: AnyShape): AnyShape }).cut(tool.shape);
            if (acc !== target.shape) safeDelete(acc);
            acc = r;
          }
          if (isEmpty(acc)) throw new UserError(`Nothing is left of "${target.label}"`);
          update(target, unwrapSolid(acc));
        }
        if (!f.keepTools) for (const t of tools) if (!f.targets.includes(t.id)) next.delete(t.id);
        return next;
      }
      const ids = [...new Set([...f.targets, ...f.tools])];
      if (ids.length < 2) throw new IncompleteError(`Pick at least two parts to ${f.op}`);
      const all = ids.map((id) => solid(id));
      let acc: AnyShape = all[0].shape;
      for (const other of all.slice(1)) {
        const s = acc as never as { fuse(o: AnyShape): AnyShape; intersect(o: AnyShape): AnyShape };
        const r = f.op === 'union' ? s.fuse(other.shape) : s.intersect(other.shape);
        if (acc !== all[0].shape) safeDelete(acc);
        acc = r;
      }
      if (isEmpty(acc)) throw new UserError('The parts do not overlap, so the intersection is empty');
      update(all[0], unwrapSolid(acc));
      if (!f.keepTools) for (const p of all.slice(1)) next.delete(p.id);
      return next;
    }

    case 'fillet':
    case 'chamfer': {
      const refs = f.edges;
      if (!refs.length) throw new IncompleteError(`Select edges to ${f.type}`);
      const size = f.type === 'fillet' ? num(f.radius, 'Radius') : num(f.distance, 'Distance');
      if (!(size > 0)) throw new UserError(`${f.type === 'fillet' ? 'Radius' : 'Distance'} must be greater than 0`);
      const byPart = new Map<string, typeof refs>();
      for (const r of refs) byPart.set(r.part, [...(byPart.get(r.part) ?? []), r]);
      for (const [pid, prefs] of byPart) {
        const p = solid(pid);
        const hashes = resolveEdges(p.shape, prefs);
        const s = p.shape as never as {
          fillet(c: (e: { hashCode: number }) => number | null): AnyShape;
          chamfer(c: (e: { hashCode: number }) => number | null): AnyShape;
        };
        const pick = (e: { hashCode: number }) => (hashes.has(e.hashCode) ? size : null);
        update(p, unwrapSolid(f.type === 'fillet' ? s.fillet(pick) : s.chamfer(pick)));
      }
      return next;
    }

    case 'shell': {
      if (!f.faces.length) throw new IncompleteError('Select the faces to open up');
      const pid = f.faces[0].part;
      if (f.faces.some((x) => x.part !== pid)) throw new UserError('Pick faces on one part only');
      const p = solid(pid);
      const t = num(f.thickness, 'Thickness');
      if (!(t > 0)) throw new UserError('Thickness must be greater than 0');
      const hashes = resolveFaces(p.shape, f.faces);
      const s = p.shape as never as {
        shell(t: number, finder: (ff: { when(fn: (a: { element: { hashCode: number } }) => boolean): unknown }) => unknown): AnyShape;
      };
      update(p, unwrapSolid(s.shell(f.outward ? -t : t, (ff) => ff.when(({ element }) => hashes.has(element.hashCode)))));
      return next;
    }

    case 'transform': {
      if (!f.parts.length) throw new IncompleteError('Select parts to move');
      const t = vec(f.translate, 'Move');
      const r = vec(f.rotate, 'Rotate');
      const sc = num(f.scale, 'Scale');
      if (!(sc > 0)) throw new UserError('Scale must be greater than 0');
      for (const id of f.parts) {
        const p = part(id);
        const moved = movePart(p, t, r, f.pivot, sc, own);
        if (f.copy) {
          const cid = `${f.id}:${id}`;
          next.set(cid, { ...moved, id: cid, key: newKey(), source: f.id, last: f.id, label: `${p.label} copy`, inherit: id });
        } else {
          next.set(id, { ...moved, key: newKey(), last: f.id });
        }
      }
      return next;
    }

    case 'mirror': {
      if (!f.parts.length) throw new IncompleteError('Select parts to mirror');
      const off = num(f.offset, 'Offset');
      const origin: Vec3 = f.plane === 'YZ' ? [off, 0, 0] : f.plane === 'XZ' ? [0, off, 0] : [0, 0, off];
      for (const id of f.parts) {
        const p = part(id);
        let copy: PartState;
        if (p.shape) {
          copy = { ...p, shape: p.shape.clone().mirror(f.plane, origin) };
        } else {
          copy = { ...p, mesh: { positions: applyMatrix(p.mesh!.positions, mirrorMatrix(f.plane, off)), indices: flipWinding(p.mesh!.indices) } };
        }
        if (f.merge) {
          const ps = solid(id);
          const fused = (ps.shape as never as { fuse(o: AnyShape): AnyShape }).fuse(copy.shape!);
          safeDelete(copy.shape);
          update(p, unwrapSolid(fused));
        } else {
          if (copy.shape) own(copy.shape);
          const cid = `${f.id}:${id}`;
          next.set(cid, { ...copy, id: cid, key: newKey(), source: f.id, last: f.id, label: `${p.label} mirror`, inherit: id });
        }
      }
      return next;
    }

    case 'linearPattern':
    case 'circularPattern': {
      if (!f.parts.length) throw new IncompleteError('Select parts to pattern');
      const count = Math.round(num(f.count, 'Count'));
      if (count < 2 || count > 500) throw new UserError('Count must be between 2 and 500');
      const axis = AXES[f.axis];
      let step = 0;
      let center: Vec3 = [0, 0, 0];
      if (f.type === 'linearPattern') {
        step = num(f.spacing, 'Spacing');
      } else {
        const total = num(f.angle, 'Angle');
        step = Math.abs(Math.abs(total) - 360) < 1e-9 ? total / count : total / (count - 1);
        center = vec(f.center, 'Center');
      }
      for (const id of f.parts) {
        const p = part(id);
        const copies: PartState[] = [];
        for (let k = 1; k < count; k++) {
          const t: Vec3 = f.type === 'linearPattern' ? [axis[0] * step * k, axis[1] * step * k, axis[2] * step * k] : [0, 0, 0];
          const r: Vec3 = f.type === 'circularPattern' ? [axis[0] * step * k, axis[1] * step * k, axis[2] * step * k] : [0, 0, 0];
          copies.push(movePart(p, t, r, center, 1, (s) => s));
        }
        if (f.merge) {
          const ps = solid(id);
          let acc: AnyShape = ps.shape;
          for (const c of copies) {
            const r = (acc as never as { fuse(o: AnyShape): AnyShape }).fuse(c.shape!);
            if (acc !== ps.shape) safeDelete(acc);
            safeDelete(c.shape);
            acc = r;
          }
          update(p, unwrapSolid(acc));
        } else {
          copies.forEach((c, k) => {
            if (c.shape) own(c.shape);
            const cid = `${f.id}:${id}:${k + 1}`;
            next.set(cid, { ...c, id: cid, key: newKey(), source: f.id, last: f.id, label: `${p.label} (${k + 2})`, inherit: id });
          });
        }
      }
      return next;
    }

    case 'import': {
      const data = blobs.get(f.dataHash);
      if (!data) throw new UserError('The imported file data is missing. Import the file again.');
      const sc = num(f.scale, 'Scale');
      if (!(sc > 0)) throw new UserError('Scale must be greater than 0');
      const base = f.fileName.replace(/\.[^.]+$/, '');
      const bytes = base64ToBytes(data);
      if (f.format === 'step') {
        let shape = await importSTEP(new Blob([bytes as BlobPart]));
        if (sc !== 1) shape = shape.scale(sc, [0, 0, 0]);
        const solids = shape.solids;
        if (solids.length > 1) {
          solids.forEach((s, k) => {
            const id = `${f.id}:${k}`;
            next.set(id, { id, kind: 'brep', shape: own(s), key: newKey(), source: f.id, last: f.id, label: `${base} ${k + 1}` });
          });
          safeDelete(shape);
        } else {
          solids.forEach((s) => safeDelete(s));
          const id = `${f.id}:0`;
          next.set(id, { id, kind: 'brep', shape: own(unwrapSolid(shape)), key: newKey(), source: f.id, last: f.id, label: base });
        }
      } else {
        const meshes = unpackMeshes(bytes);
        meshes.forEach((m, k) => {
          const id = `${f.id}:${k}`;
          const positions = sc === 1 ? m.positions : m.positions.map((v) => v * sc);
          next.set(id, {
            id,
            kind: 'mesh',
            mesh: { positions, indices: m.indices },
            key: newKey(),
            source: f.id,
            last: f.id,
            label: meshes.length === 1 ? base : m.name || `${base} ${k + 1}`,
            color: m.color === null ? undefined : `#${m.color.toString(16).padStart(6, '0')}`,
          });
        });
      }
      return next;
    }

    case 'deleteParts': {
      if (!f.parts.length) throw new IncompleteError('Select parts to delete');
      for (const id of f.parts) {
        part(id);
        next.delete(id);
      }
      return next;
    }
  }
}

function movePart(p: PartState, t: Vec3, r: Vec3, pivot: Vec3, scale: number, own: (s: AnyShape) => AnyShape): PartState {
  if (p.shape) return { ...p, shape: own(transformShape(p.shape.clone(), t, r, pivot, scale)) };
  const m = transformMatrix(t, r, pivot, scale);
  return { ...p, mesh: { positions: applyMatrix(p.mesh!.positions, m), indices: p.mesh!.indices } };
}

// ---- Queries against the most recent rebuild ----

function getPart(id: string): PartState {
  const p = lastState.get(id);
  if (!p) throw new Error(`Part ${id} not found`);
  return p;
}

export function measure(id: string): MeasureResult {
  const p = getPart(id);
  if (p.shape) return measureShape(p.shape);
  return { volume: 0, area: 0, centerOfMass: [0, 0, 0], bbox: meshBounds(p.mesh!.positions), solid: false };
}

export function exportMeshes(ids: string[]): ExportMesh[] {
  return ids.map((id) => {
    const p = getPart(id);
    const m = p.shape ? meshTriangles(p.shape) : { positions: p.mesh!.positions.slice(), indices: p.mesh!.indices.slice() };
    return { id, ...m };
  });
}

export async function exportStep(items: { id: string; name: string; color: string }[]): Promise<ArrayBuffer> {
  const shapes = items
    .map((it) => ({ p: lastState.get(it.id), it }))
    .filter((x) => x.p?.shape)
    .map(({ p, it }) => ({ shape: p!.shape!, name: it.name, color: it.color }));
  if (!shapes.length) throw new Error('Nothing to export: STEP needs solid parts (meshes cannot be saved as STEP)');
  const blob = exportSTEP(shapes);
  return blob.arrayBuffer();
}
