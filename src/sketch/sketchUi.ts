// State of the sketch editor (tool, selection, local undo), plus the edits it makes. The sketch's
// geometry itself lives in the draft feature; every edit goes through `applyEdit`, which solves the
// constraints and writes the result back to the draft.
import { create } from 'zustand';
import { newId } from '../model/hash';
import type { SkConstraint, SkConstraintType, SkEntity, SkPoint, SketchFeature, Vec3 } from '../model/types';
import { useStore } from '../store/store';
import { solveSketch, type SketchGeometry, type SolveOptions } from './solver';

export type SketchTool = 'select' | 'line' | 'rect' | 'circle' | 'arc' | 'point' | 'dimension';

export interface SketchUi {
  tool: SketchTool;
  /** Ids of selected points, entities, and constraints. */
  sel: string[];
  hover: string | null;
  /** New geometry is construction geometry (dashed, ignored by extrude). */
  construction: boolean;
  /** Dimension whose value is being typed. */
  editingDim: string | null;
  /** Degrees of freedom left after the last solve, and whether every constraint holds. */
  dof: number;
  ok: boolean;
  undo: SketchGeometry[];
  redo: SketchGeometry[];
}

export const useSketchUi = create<SketchUi>(() => ({
  tool: 'line',
  sel: [],
  hover: null,
  construction: false,
  editingDim: null,
  dof: 0,
  ok: true,
  undo: [],
  redo: [],
}));

/** The sketch being edited, once its plane is chosen. */
export function activeSketch(): SketchFeature | null {
  const d = useStore.getState().draft;
  return d?.feature.type === 'sketch' && d.field !== 'faces' ? d.feature : null;
}

export const isSketching = () => activeSketch() !== null;

const geometryOf = (f: SketchFeature): SketchGeometry => ({ points: f.points, entities: f.entities, constraints: f.constraints });

/** Solves `next` and writes it into the draft. Pushes the previous state for undo unless `transient`. */
export function applyEdit(next: SketchGeometry, opts: { transient?: boolean; drag?: SolveOptions['drag'] } = {}) {
  const f = activeSketch();
  if (!f) return;
  const r = solveSketch(next, useStore.getState().varValues, { drag: opts.drag });
  useSketchUi.setState((u) => ({
    dof: r.dof,
    ok: r.ok,
    ...(opts.transient ? {} : { undo: [...u.undo.slice(-99), geometryOf(f)], redo: [] }),
  }));
  useStore.getState().patchDraft((x) => (x.type === 'sketch' ? { ...x, points: r.points, entities: r.entities, constraints: next.constraints } : x));
}

/** Re-solves the current sketch (after loading it or changing a variable) without an undo step. */
export function resolveActive() {
  const f = activeSketch();
  if (f) applyEdit(geometryOf(f), { transient: true });
}

export function sketchUndo() {
  const f = activeSketch();
  const u = useSketchUi.getState();
  const prev = u.undo.at(-1);
  if (!f || !prev) return;
  useSketchUi.setState({ undo: u.undo.slice(0, -1), redo: [...u.redo, geometryOf(f)], sel: [] });
  applyEdit(prev, { transient: true });
}

export function sketchRedo() {
  const f = activeSketch();
  const u = useSketchUi.getState();
  const next = u.redo.at(-1);
  if (!f || !next) return;
  useSketchUi.setState({ redo: u.redo.slice(0, -1), undo: [...u.undo, geometryOf(f)], sel: [] });
  applyEdit(next, { transient: true });
}

export function resetSketchUi() {
  useSketchUi.setState({ tool: 'line', sel: [], hover: null, editingDim: null, undo: [], redo: [], construction: false });
}

// ---------------------------------------------------------------- building blocks

export const pid = () => `p${newId().slice(0, 8)}`;
export const eid = () => `e${newId().slice(0, 8)}`;
export const cid = () => `c${newId().slice(0, 8)}`;

export function current(): SketchGeometry {
  const f = activeSketch();
  return f ? geometryOf(f) : { points: [], entities: [], constraints: [] };
}

export function withConstraint(g: SketchGeometry, type: SkConstraintType, refs: string[], value?: number | string): SketchGeometry {
  // Skip exact duplicates, so clicking a button twice doesn't over-constrain.
  if (g.constraints.some((c) => c.type === type && c.refs.length === refs.length && c.refs.every((r, i) => r === refs[i]))) return g;
  const c: SkConstraint = { id: cid(), type, refs, ...(value !== undefined && { value }) };
  return { ...g, constraints: [...g.constraints, c] };
}

/** Removes points, entities, and constraints, plus whatever depends on them. */
export function deleteItems(g: SketchGeometry, ids: string[]): SketchGeometry {
  const gone = new Set(ids.filter((id) => id !== 'o'));
  // Deleting an entity takes its points along unless other entities still use them.
  const entities = g.entities.filter((e) => !gone.has(e.id) && !entPoints(e).some((p) => gone.has(p)));
  const used = new Set(['o', ...entities.flatMap(entPoints)]);
  const points = g.points.filter((p) => used.has(p.id) || (!gone.has(p.id) && !g.entities.some((e) => gone.has(e.id) && entPoints(e).includes(p.id))));
  const live = new Set([...points.map((p) => p.id), ...entities.map((e) => e.id)]);
  const constraints = g.constraints.filter((c) => !gone.has(c.id) && c.refs.every((r) => live.has(r)));
  return { points, entities, constraints };
}

export function entPoints(e: SkEntity): string[] {
  return e.type === 'line' ? [e.a, e.b] : e.type === 'circle' ? [e.c] : [e.c, e.a, e.b];
}

export function addPoint(g: SketchGeometry, x: number, y: number, id = pid()): [SketchGeometry, string] {
  const p: SkPoint = { id, x, y };
  return [{ ...g, points: [...g.points, p] }, id];
}

/** Frame helpers: sketch (x, y) to world and back. */
export function frameOf(f: SketchFeature, offset: number) {
  const { origin, xDir, normal } = f.frame;
  const y: Vec3 = [normal[1] * xDir[2] - normal[2] * xDir[1], normal[2] * xDir[0] - normal[0] * xDir[2], normal[0] * xDir[1] - normal[1] * xDir[0]];
  const o: Vec3 = [origin[0] + normal[0] * offset, origin[1] + normal[1] * offset, origin[2] + normal[2] * offset];
  return {
    origin: o,
    xDir,
    yDir: y,
    normal,
    toWorld: (px: number, py: number): Vec3 => [o[0] + xDir[0] * px + y[0] * py, o[1] + xDir[1] * px + y[1] * py, o[2] + xDir[2] * px + y[2] * py],
    toSketch: (w: Vec3): [number, number] => {
      const d = [w[0] - o[0], w[1] - o[1], w[2] - o[2]];
      return [d[0] * xDir[0] + d[1] * xDir[1] + d[2] * xDir[2], d[0] * y[0] + d[1] * y[1] + d[2] * y[2]];
    },
  };
}
