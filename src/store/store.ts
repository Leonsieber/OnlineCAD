import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import { create } from 'zustand';
import { currentSeq } from '../kernel/seq';
import type { EvalResult, FeatureStatus, MeshData, PartResult } from '../kernel/protocol';
import { EDGE_INFO_STRIDE, FACE_INFO_STRIDE } from '../kernel/protocol';
import {
  createDeleteParts,
  createDocument,
  createTransform,
  PART_COLORS,
  referencedParts,
} from '../model/defaults';
import { activeFeatures, insertFeature, removeFeatures, replaceFeature, setRollback } from '../model/docOps';
import { evalNum } from '../model/expr';
import { hashString, newId } from '../model/hash';
import type { CadDocument, EdgeRef, FaceRef, Feature, PartProps, Placement, TransformFeature, Vec3 } from '../model/types';
import { liveMove } from '../viewport/liveMove';

export type SelKind = 'part' | 'face' | 'edge';
export interface SelItem {
  kind: SelKind;
  part: string;
  index: number;
}
export const sameSel = (a: SelItem, b: SelItem) => a.kind === b.kind && a.part === b.part && a.index === b.index;

export type DisplayMode = 'shadedEdges' | 'shaded' | 'wireframe' | 'xray';
export type ThemePref = 'dark' | 'light' | 'system';
export type Projection = 'perspective' | 'orthographic';
export type RibbonTab = 'solid' | 'sketch' | 'mesh' | 'inspect' | 'view';
export type ModalName = 'documents' | 'shortcuts' | 'about' | null;

export interface Draft {
  feature: Feature;
  isNew: boolean;
  index: number;
  /** Dialog field that receives viewport clicks (targets, tools, parts, edges, faces). */
  field: string | null;
}

export interface Toast {
  id: number;
  kind: 'info' | 'error' | 'success';
  text: string;
}

export interface Prefs {
  theme: ThemePref;
  display: DisplayMode;
  projection: Projection;
  grid: boolean;
  snap: number;
}

const DEFAULT_PREFS: Prefs = { theme: 'dark', display: 'shadedEdges', projection: 'perspective', grid: true, snap: 1 };

function loadPrefs(): Prefs {
  try {
    const p = { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem('onlinecad.prefs') ?? '{}') };
    p.theme = (localStorage.getItem('onlinecad.theme') as ThemePref) || p.theme;
    return p;
  } catch {
    return DEFAULT_PREFS;
  }
}

function savePrefs(p: Prefs) {
  try {
    localStorage.setItem('onlinecad.prefs', JSON.stringify(p));
    localStorage.setItem('onlinecad.theme', p.theme);
  } catch {
    // storage unavailable (private mode): prefs just won't persist
  }
}

export const fieldKind = (key: string | null): SelKind | null =>
  key === 'edges' ? 'edge' : key === 'faces' ? 'face' : key ? 'part' : null;

const MAX_UNDO = 200;
let toastSeq = 0;

export interface State {
  doc: CadDocument;
  past: CadDocument[];
  future: CadDocument[];
  draft: Draft | null;
  sel: SelItem[];
  hover: SelItem | null;

  kernel: 'loading' | 'ready' | 'error';
  kernelError: string | null;
  busy: boolean;
  parts: PartResult[];
  meshes: Map<string, MeshData>;
  statuses: Record<string, FeatureStatus>;
  varValues: Record<string, number>;
  varErrors: Record<string, string>;
  evalMs: number;

  prefs: Prefs;
  resolvedTheme: 'dark' | 'light';
  filter: SelKind;
  tab: RibbonTab;
  gizmo: 'translate' | 'rotate';
  modal: ModalName;
  ctxMenu: { x: number; y: number; part: string | null } | null;
  toasts: Toast[];
  saveState: 'saved' | 'saving' | 'unsaved';
  playing: boolean;

  // ---- actions ----
  toast(text: string, kind?: Toast['kind']): void;
  dismissToast(id: number): void;
  /** `saved` means the document came from local storage, so there is nothing new to write. */
  loadDoc(doc: CadDocument, opts?: { saved?: boolean }): void;
  newDoc(): void;
  commit(fn: (d: CadDocument) => CadDocument): void;
  undo(): void;
  redo(): void;
  renameDoc(name: string): void;
  setRollback(n: number): void;

  startFeature(f: Feature, field?: string | null): void;
  editFeature(id: string): void;
  patchDraft(fn: (f: Feature) => Feature): void;
  setDraftField(field: string | null): void;
  confirmDraft(): void;
  cancelDraft(): void;
  deleteFeature(id: string): void;
  toggleSuppress(id: string): void;
  renameFeature(id: string, name: string): void;

  setPartProps(id: string, patch: PartProps): void;
  deleteParts(ids: string[]): void;
  commitMove(ids: string[], delta: Matrix4, pivot: Vec3): void;

  select(item: SelItem | null, additive?: boolean): void;
  setSel(items: SelItem[]): void;
  setHover(item: SelItem | null): void;
  pick(item: SelItem): void;

  setPref<K extends keyof Prefs>(key: K, value: Prefs[K]): void;
  setFilter(f: SelKind): void;
  setTab(t: RibbonTab): void;
  setGizmo(m: 'translate' | 'rotate'): void;
  setModal(m: ModalName): void;
  setCtxMenu(m: State['ctxMenu']): void;

  applyEval(res: EvalResult): void;
  setKernel(k: State['kernel'], error?: string): void;
}

export const useStore = create<State>()((set, get) => ({
  doc: createDocument(),
  past: [],
  future: [],
  draft: null,
  sel: [],
  hover: null,

  kernel: 'loading',
  kernelError: null,
  busy: false,
  parts: [],
  meshes: new Map(),
  statuses: {},
  varValues: {},
  varErrors: {},
  evalMs: 0,

  prefs: loadPrefs(),
  resolvedTheme: document.documentElement.dataset.theme === 'light' ? 'light' : 'dark',
  filter: 'part',
  tab: 'solid',
  gizmo: 'translate',
  modal: null,
  ctxMenu: null,
  toasts: [],
  saveState: 'saved',
  playing: false,

  toast(text, kind = 'info') {
    const id = ++toastSeq;
    set((s) => ({ toasts: [...s.toasts.slice(-3), { id, kind, text }] }));
    setTimeout(() => get().dismissToast(id), kind === 'error' ? 6500 : 3500);
  },
  dismissToast(id) {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },

  loadDoc(doc, opts) {
    liveMove.clear();
    set({ doc, past: [], future: [], draft: null, sel: [], hover: null, saveState: opts?.saved ? 'saved' : 'unsaved' });
  },
  newDoc() {
    get().loadDoc(createDocument());
  },
  commit(fn) {
    const { doc, past } = get();
    const next = fn(doc);
    if (next === doc) return;
    set({ doc: { ...next, modified: Date.now() }, past: [...past.slice(-MAX_UNDO + 1), doc], future: [], saveState: 'unsaved' });
  },
  undo() {
    const { past, doc, future, draft } = get();
    if (draft) return get().cancelDraft();
    if (!past.length) return;
    set({ doc: past[past.length - 1], past: past.slice(0, -1), future: [doc, ...future], saveState: 'unsaved', sel: [] });
  },
  redo() {
    const { past, doc, future } = get();
    if (!future.length) return;
    set({ doc: future[0], past: [...past, doc], future: future.slice(1), saveState: 'unsaved', sel: [] });
  },
  renameDoc(name) {
    const n = name.trim();
    if (n && n !== get().doc.name) get().commit((d) => ({ ...d, name: n }));
  },
  setRollback(n) {
    if (get().draft) return;
    get().commit((d) => (d.rollback === n ? d : setRollback(d, n)));
  },

  startFeature(f, field = null) {
    const { doc } = get();
    set({ draft: { feature: f, isNew: true, index: doc.rollback, field }, ctxMenu: null });
  },
  editFeature(id) {
    const { doc, draft } = get();
    if (draft) return;
    const index = doc.features.findIndex((f) => f.id === id);
    if (index < 0) return;
    const f = doc.features[index];
    if (index >= doc.rollback) {
      get().toast('Roll forward past this feature to edit it');
      return;
    }
    const field = f.type === 'fillet' || f.type === 'chamfer' ? 'edges' : f.type === 'shell' ? 'faces' : f.type === 'boolean' ? 'targets' : 'parts' in f ? 'parts' : null;
    set({ draft: { feature: structuredClone(f), isNew: false, index, field }, sel: [] });
  },
  patchDraft(fn) {
    const { draft } = get();
    if (draft) set({ draft: { ...draft, feature: fn(draft.feature) } });
  },
  setDraftField(field) {
    const { draft } = get();
    if (draft) set({ draft: { ...draft, field } });
  },
  confirmDraft() {
    const { draft } = get();
    if (!draft) return;
    const f = draft.feature;
    get().commit((d) => (draft.isNew ? insertFeature(d, f, draft.index) : replaceFeature(d, f)));
    const sel: SelItem[] = draft.isNew && f.type === 'primitive' ? [{ kind: 'part', part: f.id, index: -1 }] : [];
    set({ draft: null, sel, filter: 'part' });
  },
  cancelDraft() {
    liveMove.clear();
    set({ draft: null, hover: null });
  },
  deleteFeature(id) {
    if (get().draft) return;
    get().commit((d) => removeFeatures(d, [id]));
    set({ sel: [] });
  },
  toggleSuppress(id) {
    get().commit((d) => ({ ...d, features: d.features.map((f) => (f.id === id ? { ...f, suppressed: !f.suppressed } : f)) }));
  },
  renameFeature(id, name) {
    const n = name.trim();
    if (!n) return;
    get().commit((d) => ({ ...d, features: d.features.map((f) => (f.id === id ? { ...f, name: n } : f)) }));
  },

  setPartProps(id, patch) {
    get().commit((d) => ({ ...d, parts: { ...d.parts, [id]: { ...d.parts[id], ...patch } } }));
  },
  deleteParts(ids) {
    const { doc, draft } = get();
    if (draft || !ids.length) return;
    const active = activeFeatures(doc);
    // Primitives nothing else depends on can simply be removed from the history.
    const removable = ids.every((id) => {
      const i = active.findIndex((f) => f.id === id);
      return i >= 0 && active[i].type === 'primitive' && !active.slice(i + 1).some((g) => referencedParts(g).includes(id));
    });
    if (removable) get().commit((d) => removeFeatures(d, ids));
    else get().commit((d) => insertFeature(d, createDeleteParts(ids, d.features)));
    set({ sel: [], hover: null });
  },

  commitMove(ids, delta, pivot) {
    const s = get();
    if (isIdentity(delta)) return liveMove.clear();
    const scope = s.varValues;
    const finish = () => liveMove.hold(currentSeq());

    if (s.draft) {
      const f = s.draft.feature;
      if (f.type === 'primitive' && ids.length === 1 && ids[0] === f.id) {
        const placement = composePlacement(delta, f.placement, scope);
        if (placement) {
          set({ draft: { ...s.draft, feature: { ...f, placement } } });
          return finish();
        }
      }
      return liveMove.clear();
    }

    const active = activeFeatures(s.doc);
    const free = ids.every((id) => {
      const i = active.findIndex((f) => f.id === id);
      return i >= 0 && active[i].type === 'primitive' && !active.slice(i + 1).some((g) => referencedParts(g).includes(id));
    });
    if (free) {
      const placements = new Map<string, Placement>();
      for (const id of ids) {
        const f = active.find((x) => x.id === id);
        const p = f?.type === 'primitive' ? composePlacement(delta, f.placement, scope) : null;
        if (!p) break;
        placements.set(id, p);
      }
      if (placements.size === ids.length) {
        s.commit((d) => ({
          ...d,
          features: d.features.map((f) => (f.type === 'primitive' && placements.has(f.id) ? { ...f, placement: placements.get(f.id)! } : f)),
        }));
        return finish();
      }
    }

    const last = active[active.length - 1];
    const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));
    if (last?.type === 'transform') {
      const created = last.copy ? last.parts.map((p) => `${last.id}:${p}`) : last.parts;
      if (sameSet(created, ids)) {
        const merged = mergeTransform(last, delta, scope);
        if (merged) {
          s.commit((d) => replaceFeature(d, merged));
          return finish();
        }
      }
    }
    const tf = createTransform(ids, pivot, s.doc.features);
    const { translate, rotate } = deltaToTransform(delta, new Vector3(...pivot));
    s.commit((d) => insertFeature(d, { ...tf, translate, rotate }));
    finish();
  },

  select(item, additive = false) {
    if (!item) return set({ sel: [] });
    const { sel } = get();
    if (!additive) return set({ sel: [item] });
    const exists = sel.some((x) => sameSel(x, item));
    set({ sel: exists ? sel.filter((x) => !sameSel(x, item)) : [...sel, item] });
  },
  setSel(items) {
    set({ sel: items });
  },
  setHover(item) {
    const { hover } = get();
    if (hover === item || (hover && item && sameSel(hover, item))) return;
    set({ hover: item });
  },
  pick(item) {
    const { draft } = get();
    if (!draft?.field) return;
    const key = draft.field;
    const kind = fieldKind(key);
    if (kind !== item.kind) return;
    get().patchDraft((f) => {
      const rec = f as unknown as Record<string, unknown>;
      if (kind === 'part') {
        const list = (rec[key] as string[]) ?? [];
        const next = list.includes(item.part) ? list.filter((x) => x !== item.part) : [...list, item.part];
        return { ...f, [key]: next } as Feature;
      }
      const fp = fingerprintOf(item);
      if (!fp) return f;
      const list = (rec[key] as (EdgeRef | FaceRef)[]) ?? [];
      const existing = list.findIndex((r) => r.part === item.part && fpDistance(r.fp, fp) < 1e-4);
      const next = existing >= 0 ? list.filter((_, i) => i !== existing) : [...list, { part: item.part, index: item.index, fp }];
      return { ...f, [key]: next } as Feature;
    });
  },

  setPref(key, value) {
    const prefs = { ...get().prefs, [key]: value };
    savePrefs(prefs);
    set({ prefs });
  },
  setFilter(filter) {
    set({ filter, sel: get().sel.filter((x) => x.kind === filter) });
  },
  setTab(tab) {
    set({ tab });
  },
  setGizmo(gizmo) {
    set({ gizmo });
  },
  setModal(modal) {
    set({ modal, ctxMenu: null });
  },
  setCtxMenu(ctxMenu) {
    set({ ctxMenu });
  },

  applyEval(res) {
    const s = get();
    const incoming = new Map(res.meshes.map((m) => [m.key, m]));
    const meshes = new Map<string, MeshData>();
    for (const p of res.parts) {
      const m = incoming.get(p.key) ?? s.meshes.get(p.key);
      if (m) meshes.set(p.key, m);
    }
    const keyOf = new Map(res.parts.map((p) => [p.id, p.key]));
    const oldKey = new Map(s.parts.map((p) => [p.id, p.key]));
    const stillValid = (x: SelItem) => keyOf.has(x.part) && (x.kind === 'part' || keyOf.get(x.part) === oldKey.get(x.part));
    if (liveMove.holdUntil !== null && res.seq >= liveMove.holdUntil) liveMove.clear();
    set({
      parts: res.parts,
      meshes,
      statuses: res.statuses,
      varValues: res.variables,
      varErrors: res.variableErrors,
      evalMs: res.ms,
      sel: s.sel.filter(stillValid),
      hover: s.hover && stillValid(s.hover) ? s.hover : null,
    });
  },
  setKernel(kernel, error) {
    set({ kernel, kernelError: error ?? null });
  },
}));

// ---- appearance ----

export function partColor(id: string, s: Pick<State, 'doc' | 'parts'> = useStore.getState(), depth = 0): string {
  const own = s.doc.parts[id]?.color;
  if (own) return own;
  const r = s.parts.find((p) => p.id === id);
  if (r?.inherit && depth < 8) return partColor(r.inherit, s, depth + 1);
  if (r?.color) return r.color;
  const h = parseInt(hashString(id).slice(0, 6), 36);
  return PART_COLORS[h % PART_COLORS.length];
}

export function partName(id: string, s: Pick<State, 'doc' | 'parts'> = useStore.getState()): string {
  return s.doc.parts[id]?.name ?? s.parts.find((p) => p.id === id)?.label ?? 'Part';
}

export function meshOf(partId: string, s: Pick<State, 'parts' | 'meshes'> = useStore.getState()): MeshData | undefined {
  const p = s.parts.find((x) => x.id === partId);
  return p ? s.meshes.get(p.key) : undefined;
}

export function fingerprintOf(item: SelItem): number[] | null {
  const m = meshOf(item.part);
  if (!m || item.index < 0) return null;
  if (item.kind === 'edge') return Array.from(m.edgeInfo.subarray(item.index * EDGE_INFO_STRIDE, (item.index + 1) * EDGE_INFO_STRIDE));
  if (item.kind === 'face') return Array.from(m.faceInfo.subarray(item.index * FACE_INFO_STRIDE, (item.index + 1) * FACE_INFO_STRIDE));
  return null;
}

export function fpDistance(a: number[], b: number[]): number {
  let d = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) d += Math.abs(a[i] - b[i]);
  return d;
}

// ---- transform math (rotations use the Z*Y*X order the kernel applies) ----

const R2D = 180 / Math.PI;
const D2R = Math.PI / 180;
const round6 = (v: number) => Math.round(v * 1e6) / 1e6 + 0;

function isIdentity(m: Matrix4) {
  const e = m.elements;
  const id = new Matrix4().elements;
  return e.every((v, i) => Math.abs(v - id[i]) < 1e-9);
}

function evalVec(v: (number | string)[], scope: Record<string, number>): Vec3 | null {
  try {
    return v.map((x) => evalNum(x, scope)) as Vec3;
  } catch {
    return null;
  }
}

function composePlacement(delta: Matrix4, pl: Placement, scope: Record<string, number>): Placement | null {
  const pos = evalVec(pl.position, scope);
  const rot = evalVec(pl.rotation, scope);
  if (!pos || !rot) return null;
  const q = new Quaternion().setFromEuler(new Euler(rot[0] * D2R, rot[1] * D2R, rot[2] * D2R, 'ZYX'));
  const m = new Matrix4().compose(new Vector3(...pos), q, new Vector3(1, 1, 1)).premultiply(delta);
  const p = new Vector3();
  const nq = new Quaternion();
  m.decompose(p, nq, new Vector3());
  const e = new Euler().setFromQuaternion(nq, 'ZYX');
  return {
    position: [round6(p.x), round6(p.y), round6(p.z)],
    rotation: [round6(e.x * R2D), round6(e.y * R2D), round6(e.z * R2D)],
  };
}

function deltaToTransform(delta: Matrix4, pivot: Vector3): { translate: Vec3; rotate: Vec3 } {
  const c = new Vector3();
  const q = new Quaternion();
  delta.decompose(c, q, new Vector3());
  // delta(x) = R x + c; the feature form is R (x - p) + p + t, so t = c + R p - p.
  const t = pivot.clone().applyQuaternion(q).add(c).sub(pivot);
  const e = new Euler().setFromQuaternion(q, 'ZYX');
  return {
    translate: [round6(t.x), round6(t.y), round6(t.z)],
    rotate: [round6(e.x * R2D), round6(e.y * R2D), round6(e.z * R2D)],
  };
}

function mergeTransform(f: TransformFeature, delta: Matrix4, scope: Record<string, number>): TransformFeature | null {
  const t = evalVec(f.translate, scope);
  const r = evalVec(f.rotate, scope);
  if (!t || !r) return null;
  const p = new Vector3(...f.pivot);
  const q = new Quaternion().setFromEuler(new Euler(r[0] * D2R, r[1] * D2R, r[2] * D2R, 'ZYX'));
  // Existing rigid part of the feature: x -> R(x - p) + p + t  (scale about p is left untouched)
  const existing = new Matrix4().compose(p.clone().add(new Vector3(...t)).sub(p.clone().applyQuaternion(q)), q, new Vector3(1, 1, 1));
  const combined = existing.premultiply(delta);
  return { ...f, ...deltaToTransform(combined, p) };
}

/** A fresh id for things like duplicated parts. */
export const freshId = newId;
