// Tinkercad-style resizing for a CAD history.
// A stretch is pushed back into the shapes a part was built from, so groups stretch for real and
// stay editable. Parts that can't be traced back to shapes (STEP imports, copies) scale evenly instead.
import { Euler, Matrix3, Matrix4, Quaternion, Vector3 } from 'three';
import { evalNum } from '../model/expr';
import { primitiveLocalBox } from '../model/primitiveBox';
import { PRIMITIVES } from '../model/defaults';
import type { CadDocument, Feature, PrimitiveFeature, TransformFeature, Vec3 } from '../model/types';
import type { PartResult } from '../kernel/protocol';

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;
const r6 = (v: number) => Math.round(v * 1e6) / 1e6 + 0;
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(a), Math.abs(b));

export interface ResizeFrame {
  /** Frame to world: world = origin + quat * local. */
  quat: Quaternion;
  origin: Vector3;
  min: Vector3;
  max: Vector3;
  /** True when every selected part can stretch per axis; otherwise handles scale evenly. */
  canStretch: boolean;
}

function evalVec(v: (number | string)[] | undefined, scope: Record<string, number>, fallback: Vec3): Vec3 | null {
  if (!v) return fallback;
  try {
    return v.map((x) => evalNum(x, scope)) as Vec3;
  } catch {
    return null;
  }
}

function evalParams(f: PrimitiveFeature, scope: Record<string, number>): Record<string, number> | null {
  const out: Record<string, number> = {};
  try {
    for (const def of PRIMITIVES[f.kind].params) out[def.key] = evalNum(f.params[def.key] ?? def.def, scope);
  } catch {
    return null;
  }
  return out;
}

export function placementQuat(rot: Vec3): Quaternion {
  return new Quaternion().setFromEuler(new Euler(rot[0] * D2R, rot[1] * D2R, rot[2] * D2R, 'ZYX'));
}

/**
 * The primitive features a part is made of, if it was built only from shapes combined with booleans
 * (fillets, chamfers, and shells on the way are fine). Returns null for anything else.
 */
export function leafPrimitives(partId: string, features: Feature[], before = features.length): PrimitiveFeature[] | null {
  for (let i = before - 1; i >= 0; i--) {
    const f = features[i];
    if (f.suppressed) continue;
    switch (f.type) {
      case 'primitive':
        if (f.id === partId) return [f];
        break;
      case 'boolean': {
        const ids = [...new Set([...f.targets, ...f.tools])];
        const result = f.op === 'subtract' ? f.targets.includes(partId) : ids[0] === partId;
        if (!result) break;
        const inputs = f.op === 'subtract' ? [partId, ...f.tools] : ids;
        const out: PrimitiveFeature[] = [];
        for (const id of inputs) {
          const l = leafPrimitives(id, features, i);
          if (!l) return null;
          for (const p of l) if (!out.includes(p)) out.push(p);
        }
        return out;
      }
      case 'transform':
        if ((!f.copy && f.parts.includes(partId)) || partId.startsWith(`${f.id}:`)) return null;
        break;
      case 'mirror':
      case 'linearPattern':
      case 'circularPattern':
        if ((f.merge && f.parts.includes(partId)) || partId.startsWith(`${f.id}:`)) return null;
        break;
      case 'import':
        if (partId.startsWith(`${f.id}:`)) return null;
        break;
      default:
        break; // fillet, chamfer, shell, delete: the part keeps its lineage
    }
  }
  return null;
}

/** Rotation matrix (3x3) of a primitive's placement, or null if it uses an expression we can't evaluate. */
function primitiveRotation(f: PrimitiveFeature, scope: Record<string, number>): Matrix3 | null {
  const rot = evalVec(f.placement.rotation, scope, [0, 0, 0]);
  if (!rot) return null;
  return new Matrix3().setFromMatrix4(new Matrix4().makeRotationFromQuaternion(placementQuat(rot)));
}

/** For a signed permutation M (rows have a single ±1), local axis j maps to frame axis perm[j]. */
function signedPermutation(m: Matrix3): number[] | null {
  const e = m.elements; // column-major
  const perm: number[] = [];
  for (let row = 0; row < 3; row++) {
    let found = -1;
    for (let col = 0; col < 3; col++) {
      const v = Math.abs(e[col * 3 + row]);
      if (near(v, 1, 1e-5)) {
        if (found >= 0) return null;
        found = col;
      } else if (v > 1e-5) return null;
    }
    if (found < 0) return null;
    perm.push(found);
  }
  return perm;
}

/** Choose the handle frame and box for the selection. */
export function resizeFrame(ids: string[], doc: CadDocument, parts: PartResult[], scope: Record<string, number>): ResizeFrame | null {
  const active = doc.features.slice(0, doc.rollback);
  const results = ids.map((id) => parts.find((p) => p.id === id)).filter((p): p is PartResult => !!p);
  if (!results.length) return null;
  const canStretch = results.every((p) => p.kind === 'mesh' || !!leafPrimitives(p.id, active));

  // A part made from a single shape gets handles aligned with that shape, even when it's rotated.
  if (results.length === 1) {
    const leaves = leafPrimitives(results[0].id, active);
    if (leaves?.length === 1) {
      const f = leaves[0];
      const params = evalParams(f, scope);
      const pos = evalVec(f.placement.position, scope, [0, 0, 0]);
      const rot = evalVec(f.placement.rotation, scope, [0, 0, 0]);
      const st = evalVec(f.placement.scale, scope, [1, 1, 1]);
      if (params && pos && rot && st) {
        const [mn, mx] = primitiveLocalBox(f.kind, params, st);
        return { quat: placementQuat(rot), origin: new Vector3(...pos), min: new Vector3(...mn), max: new Vector3(...mx), canStretch };
      }
    }
  }
  const min = new Vector3(Infinity, Infinity, Infinity);
  const max = new Vector3(-Infinity, -Infinity, -Infinity);
  for (const p of results) {
    min.min(new Vector3(...p.bbox[0]));
    max.max(new Vector3(...p.bbox[1]));
  }
  return { quat: new Quaternion(), origin: new Vector3(), min, max, canStretch };
}

/** Fold a total local stretch into the shape's own parameters where they can express it. */
export function absorbStretch(f: PrimitiveFeature, T: Vec3, scope: Record<string, number>): PrimitiveFeature | null {
  const p = evalParams(f, scope);
  if (!p) return null;
  const [tx, ty, tz] = T;
  let kind = f.kind;
  const np: Record<string, number> = { ...p };
  let st: Vec3 = [1, 1, 1];
  const xy = near(tx, ty);
  switch (f.kind) {
    case 'box':
    case 'wedge':
      np.width = p.width * tx;
      np.depth = p.depth * ty;
      np.height = p.height * tz;
      break;
    case 'ellipsoid':
      np.radiusX = p.radiusX * tx;
      np.radiusY = p.radiusY * ty;
      np.radiusZ = p.radiusZ * tz;
      break;
    case 'sphere':
      if (xy && near(tx, tz)) np.radius = p.radius * tx;
      else {
        kind = 'ellipsoid';
        for (const k of Object.keys(np)) delete np[k];
        np.radiusX = p.radius * tx;
        np.radiusY = p.radius * ty;
        np.radiusZ = p.radius * tz;
      }
      break;
    case 'cylinder':
      np.radius = p.radius * ty;
      np.height = p.height * tz;
      st = [tx / ty, 1, 1];
      break;
    case 'tube':
      np.outerRadius = p.outerRadius * ty;
      np.innerRadius = p.innerRadius * ty;
      np.height = p.height * tz;
      st = [tx / ty, 1, 1];
      break;
    case 'cone':
      np.bottomRadius = p.bottomRadius * ty;
      np.topRadius = p.topRadius * ty;
      np.height = p.height * tz;
      st = [tx / ty, 1, 1];
      break;
    case 'prism':
    case 'pyramid':
      np.radius = p.radius * ty;
      np.height = p.height * tz;
      st = [tx / ty, 1, 1];
      break;
    case 'torus': {
      // A torus keeps a round ring; X and Y share one scale, and Z flattens the tube.
      const s = xy ? tx : Math.sqrt(tx * ty);
      np.majorRadius = p.majorRadius * s;
      np.minorRadius = p.minorRadius * s;
      st = [1, 1, tz / s];
      break;
    }
  }
  const params: Record<string, number> = {};
  for (const [k, v] of Object.entries(np)) params[k] = PRIMITIVES[kind].params.find((d) => d.key === k)?.integer ? Math.round(v) : r6(v);
  const plain = st.every((v) => near(v, 1));
  const placement = { ...f.placement, scale: plain ? undefined : (st.map(r6) as Vec3) };
  if (plain) delete placement.scale;
  return { ...f, kind, params, placement };
}

export interface ResizeResult {
  doc: CadDocument;
  /** Parts that could only scale evenly. */
  even: string[];
}

/**
 * Apply a stretch S (in the frame's axes) about world point `anchor` to the given parts.
 * `evenFactor` is used for parts that can't stretch per axis.
 */
export function applyResize(
  doc: CadDocument,
  ids: string[],
  parts: PartResult[],
  frameQuat: Quaternion,
  S: Vec3,
  anchor: Vec3,
  evenFactor: number,
  scope: Record<string, number>,
  newTransform: (parts: string[], pivot: Vec3) => TransformFeature,
): ResizeResult | null {
  const active = doc.features.slice(0, doc.rollback);
  const Rf = new Matrix3().setFromMatrix4(new Matrix4().makeRotationFromQuaternion(frameQuat));
  const A = new Vector3(...anchor);
  // World-space stretch W = Rf * S * Rf^T
  const W = new Matrix3()
    .copy(Rf)
    .multiply(new Matrix3().set(S[0], 0, 0, 0, S[1], 0, 0, 0, S[2]))
    .multiply(Rf.clone().transpose());

  const replaced = new Map<string, PrimitiveFeature>();
  const evenSolids: string[] = [];
  const meshes: string[] = [];
  for (const id of ids) {
    const res = parts.find((p) => p.id === id);
    if (!res) continue;
    if (res.kind === 'mesh') {
      meshes.push(id);
      continue;
    }
    const leaves = leafPrimitives(id, active);
    let ok = !!leaves;
    const updates: PrimitiveFeature[] = [];
    for (const leaf of leaves ?? []) {
      const cur = replaced.get(leaf.id) ?? leaf;
      const Rl = primitiveRotation(cur, scope);
      const pos = evalVec(cur.placement.position, scope, [0, 0, 0]);
      const st = evalVec(cur.placement.scale, scope, [1, 1, 1]);
      const perm = Rl ? signedPermutation(Rl.clone().transpose().multiply(Rf)) : null;
      if (!Rl || !pos || !st || !perm) {
        ok = false;
        break;
      }
      const local: Vec3 = [S[perm[0]], S[perm[1]], S[perm[2]]];
      const total: Vec3 = [local[0] * st[0], local[1] * st[1], local[2] * st[2]];
      const absorbed = absorbStretch(cur, total, scope);
      if (!absorbed) {
        ok = false;
        break;
      }
      const P = new Vector3(...pos).sub(A).applyMatrix3(W).add(A);
      absorbed.placement = { ...absorbed.placement, position: [r6(P.x), r6(P.y), r6(P.z)] };
      updates.push(absorbed);
    }
    if (ok) for (const u of updates) replaced.set(u.id, u);
    else evenSolids.push(id);
  }

  let next: CadDocument = { ...doc, features: doc.features.map((f) => (f.type === 'primitive' && replaced.has(f.id) ? replaced.get(f.id)! : f)) };
  const insert = (f: TransformFeature) => {
    const features = [...next.features];
    features.splice(next.rollback, 0, f);
    next = { ...next, features, rollback: next.rollback + 1 };
  };
  if (meshes.length) {
    // Meshes stretch per world axis; that only matches the handles when the frame is world-aligned.
    const worldAligned = frameQuat.angleTo(new Quaternion()) < 1e-6;
    const stretch: Vec3 = worldAligned ? S : [evenFactor, evenFactor, evenFactor];
    insert({ ...newTransform(meshes, anchor), name: 'Resize', stretch: stretch.map(r6) as Vec3 });
  }
  const scaleEven = evenSolids.length > 0 && !near(evenFactor, 1);
  if (scaleEven) insert({ ...newTransform(evenSolids, anchor), name: 'Scale', scale: r6(evenFactor) });
  if (!replaced.size && !meshes.length && !scaleEven) return null;
  return { doc: next, even: evenSolids };
}
