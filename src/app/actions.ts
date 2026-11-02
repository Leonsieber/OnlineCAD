// High-level commands shared by the ribbon, menus, context menus, and keyboard shortcuts.
import {
  createBoolean,
  createChamfer,
  createCircularPattern,
  createFillet,
  createImport,
  createLinearPattern,
  createMirror,
  createPrimitive,
  createShell,
  createTransform,
  nextName,
} from '../model/defaults';
import { removeFeatures } from '../model/docOps';
import { bracketExample } from '../model/examples';
import type { BooleanOp, CadDocument, EdgeRef, FaceRef, Feature, PrimitiveKind, Vec3 } from '../model/types';
import { exportParts, type ExportFormat } from '../io/exporters';
import { download, pickFile, safeFileName } from '../io/files';
import { IMPORT_ACCEPT, readImport } from '../io/importers';
import { isCadDocument, loadDoc, saveDoc } from '../io/storage';
import { fingerprintOf, freshId, useStore } from '../store/store';
import { partsBox, viewApi } from '../viewport/viewApi';

const S = () => useStore.getState();

function begin() {
  const s = S();
  if (s.draft) s.cancelDraft();
  return S();
}

/** Parts the user has selected, including parts whose faces or edges are selected. */
export function selectedParts(): string[] {
  return [...new Set(S().sel.map((x) => x.part))];
}

function selectionCenter(ids: string[]): Vec3 {
  const box = partsBox(ids);
  if (box.isEmpty()) return [0, 0, 0];
  const c = box.getCenter(box.min.clone());
  return [Math.round(c.x * 1e4) / 1e4, Math.round(c.y * 1e4) / 1e4, Math.round(c.z * 1e4) / 1e4];
}

export function addPrimitive(kind: PrimitiveKind) {
  const s = begin();
  s.startFeature(createPrimitive(kind, s.doc.features, viewApi.groundPointAtCenter()));
}

export function startBoolean(op: BooleanOp) {
  const s = begin();
  const ids = selectedParts();
  if (op === 'subtract') {
    s.startFeature(createBoolean(op, ids.slice(0, 1), ids.slice(1), s.doc.features), ids.length ? 'tools' : 'targets');
  } else {
    s.startFeature(createBoolean(op, ids, [], s.doc.features), 'targets');
  }
}

function selectedRefs(kind: 'edge' | 'face'): (EdgeRef | FaceRef)[] {
  return S()
    .sel.filter((x) => x.kind === kind)
    .map((x) => ({ part: x.part, index: x.index, fp: fingerprintOf(x) ?? [] }))
    .filter((r) => r.fp.length);
}

export function startEdgeFeature(type: 'fillet' | 'chamfer') {
  const refs = selectedRefs('edge') as EdgeRef[];
  const s = begin();
  s.startFeature(type === 'fillet' ? createFillet(refs, s.doc.features) : createChamfer(refs, s.doc.features), 'edges');
  if (!refs.length) s.toast('Click the edges to round. Edges highlight as you hover.');
}

export function startShell() {
  const refs = selectedRefs('face') as FaceRef[];
  const s = begin();
  s.startFeature(createShell(refs, s.doc.features), 'faces');
  if (!refs.length) s.toast('Click the face (or faces) to open up');
}

export function startPartFeature(type: 'transform' | 'mirror' | 'linearPattern' | 'circularPattern') {
  const ids = selectedParts();
  const s = begin();
  const f = s.doc.features;
  const feature =
    type === 'transform'
      ? createTransform(ids, selectionCenter(ids), f)
      : type === 'mirror'
        ? createMirror(ids, f)
        : type === 'linearPattern'
          ? createLinearPattern(ids, f)
          : createCircularPattern(ids, f);
  s.startFeature(feature, 'parts');
}

export function duplicateSelection() {
  const ids = selectedParts();
  if (!ids.length) return;
  const s = begin();
  const tf = { ...createTransform(ids, selectionCenter(ids), s.doc.features, true), translate: [10, 10, 0] as Vec3 };
  s.commit((d) => ({ ...d, features: [...d.features.slice(0, d.rollback), tf, ...d.features.slice(d.rollback)], rollback: d.rollback + 1 }));
  s.setSel(ids.map((id) => ({ kind: 'part', part: `${tf.id}:${id}`, index: -1 })));
}

/**
 * Tinkercad's Group: solids are united, then parts marked as holes are cut out of the result.
 * Both steps land in the history as ordinary Union / Subtract features (one undo step).
 */
export function groupSelection() {
  const s = begin();
  const ids = [...new Set(s.sel.filter((x) => x.kind === 'part').map((x) => x.part))];
  if (ids.length < 2) return s.toast('Select two or more parts to group (Shift-click to add parts)');
  const holes = ids.filter((id) => s.doc.parts[id]?.hole);
  const solids = ids.filter((id) => !s.doc.parts[id]?.hole);
  if (!solids.length) return s.toast('A group needs at least one solid. Switch one part back to Solid.', 'error');
  s.commit((d) => {
    let next = d;
    const add = (f: Feature) => {
      const features = [...next.features];
      features.splice(next.rollback, 0, f);
      next = { ...next, features, rollback: next.rollback + 1 };
    };
    if (solids.length > 1) add({ ...createBoolean('union', solids, [], next.features), name: nextName('Group', next.features) });
    if (holes.length) add({ ...createBoolean('subtract', solids.slice(0, 1), holes, next.features), name: nextName('Holes', next.features) });
    return next;
  });
  S().setSel([{ kind: 'part', part: solids[0], index: -1 }]);
}

/** Undo a group: remove the trailing booleans that produced the selected part. */
export function ungroupSelection() {
  const s = begin();
  const id = s.sel.find((x) => x.kind === 'part')?.part;
  if (!id) return s.toast('Select a group to ungroup');
  const active = s.doc.features.slice(0, s.doc.rollback);
  const remove: string[] = [];
  const freed = new Set<string>();
  for (let i = active.length - 1; i >= 0; i--) {
    const f = active[i];
    if (f.type !== 'boolean') break;
    const result = f.op === 'subtract' ? f.targets.includes(id) : [...new Set([...f.targets, ...f.tools])][0] === id;
    if (!result) break;
    remove.push(f.id);
    for (const p of [...f.targets, ...f.tools]) freed.add(p);
  }
  if (!remove.length) return s.toast("This part isn't a group (or later features depend on it)");
  s.commit((d) => removeFeatures(d, remove));
  S().setSel([...freed].map((p) => ({ kind: 'part' as const, part: p, index: -1 })));
}

export function toggleHole(ids = selectedParts()) {
  const s = S();
  if (!ids.length) return;
  const makeHole = !ids.every((id) => s.doc.parts[id]?.hole);
  s.commit((d) => ({ ...d, parts: { ...d.parts, ...Object.fromEntries(ids.map((id) => [id, { ...d.parts[id], hole: makeHole }])) } }));
}

export function deleteSelection() {
  const ids = [...new Set(S().sel.filter((x) => x.kind === 'part').map((x) => x.part))];
  if (ids.length) S().deleteParts(ids);
}

export function selectAll() {
  const s = S();
  s.setSel(s.parts.filter((p) => !s.doc.parts[p.id]?.hidden).map((p) => ({ kind: 'part', part: p.id, index: -1 })));
}

export function hideSelection(hidden = true) {
  for (const id of selectedParts()) S().setPartProps(id, { hidden });
  S().setSel([]);
}

export function showAllParts() {
  const s = S();
  s.commit((d) => ({ ...d, parts: Object.fromEntries(Object.entries(d.parts).map(([k, v]) => [k, { ...v, hidden: false }])) }));
}

// ---------------------------------------------------------------- files

export async function importFile(file?: File) {
  const f = file ?? (await pickFile(IMPORT_ACCEPT));
  if (!f) return;
  const s = begin();
  s.toast(`Reading ${f.name}…`);
  try {
    const p = await readImport(f);
    s.startFeature(createImport(p.format, f.name, p.data, p.dataHash, p.scale, S().doc.features));
    if (p.scale !== 1) s.toast('glTF is in metres, so the scale is set to 1000 to convert to millimetres.');
    setTimeout(() => viewApi.fitAll(true), 600);
  } catch (e) {
    s.toast(`Couldn't import ${f.name}: ${(e as Error).message}`, 'error');
  }
}

export async function exportAs(format: ExportFormat, onlySelected = false) {
  const s = S();
  const ids = onlySelected && selectedParts().length ? selectedParts() : s.parts.filter((p) => !s.doc.parts[p.id]?.hidden).map((p) => p.id);
  if (!ids.length) return s.toast('There is nothing to export yet', 'error');
  try {
    await exportParts(format, ids, s.doc.name);
    s.toast(`Exported ${ids.length} part${ids.length > 1 ? 's' : ''} as ${format.toUpperCase()}`, 'success');
  } catch (e) {
    s.toast(`Export failed: ${(e as Error).message}`, 'error');
  }
}

export async function saveNow() {
  const s = S();
  // Don't clutter the documents list with empty, untouched documents.
  if (!s.doc.features.length && !s.doc.variables.length && s.doc.name === 'Untitled') {
    useStore.setState({ saveState: 'saved' });
    return;
  }
  useStore.setState({ saveState: 'saving' });
  try {
    await saveDoc(s.doc, viewApi.capture());
    useStore.setState({ saveState: S().doc === s.doc ? 'saved' : 'unsaved' });
  } catch (e) {
    useStore.setState({ saveState: 'unsaved' });
    s.toast(`Couldn't save locally: ${(e as Error).message}`, 'error');
  }
}

export async function openDocument(id: string) {
  await saveNow();
  const doc = await loadDoc(id);
  if (!doc) return S().toast('That document could not be found', 'error');
  S().loadDoc(doc, { saved: true });
  S().setModal(null);
  setTimeout(() => viewApi.fitAll(false), 400);
}

export async function newDocument() {
  await saveNow();
  begin().newDoc();
}

export async function openExample() {
  await saveNow();
  begin().loadDoc(bracketExample());
  setTimeout(() => viewApi.setView('iso', false), 500);
}

export function downloadDocument() {
  const { doc } = S();
  download(new Blob([JSON.stringify(doc)], { type: 'application/json' }), `${safeFileName(doc.name)}.ocad`);
}

export async function openDocumentFile() {
  const f = await pickFile('.ocad,.json');
  if (!f) return;
  try {
    const parsed: unknown = JSON.parse(await f.text());
    if (!isCadDocument(parsed)) throw new Error('This is not an OnlineCAD document');
    await saveNow();
    // Opening a file creates a separate local copy instead of overwriting the original.
    const doc: CadDocument = { ...parsed, id: freshId() };
    S().loadDoc(doc);
    setTimeout(() => viewApi.fitAll(false), 400);
  } catch (e) {
    S().toast(`Couldn't open ${f.name}: ${(e as Error).message}`, 'error');
  }
}
