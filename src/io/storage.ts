// Local documents live in IndexedDB, so work survives reloads and works offline.
import { del, get, getMany, keys, set } from 'idb-keyval';
import type { CadDocument } from '../model/types';

export interface DocMeta {
  id: string;
  name: string;
  created: number;
  modified: number;
  features: number;
  thumb: string | null;
}

export async function saveDoc(doc: CadDocument, thumb: string | null) {
  const prev = await get<DocMeta>(`meta:${doc.id}`);
  const meta: DocMeta = {
    id: doc.id,
    name: doc.name,
    created: doc.created,
    modified: doc.modified,
    features: doc.features.length,
    thumb: thumb ?? prev?.thumb ?? null,
  };
  await set(`doc:${doc.id}`, doc);
  await set(`meta:${doc.id}`, meta);
  await set('last', doc.id);
}

export const loadDoc = (id: string) => get<CadDocument>(`doc:${id}`);

export async function listDocs(): Promise<DocMeta[]> {
  const ks = (await keys()).filter((k): k is string => typeof k === 'string' && k.startsWith('meta:'));
  const metas = (await getMany<DocMeta | undefined>(ks)).filter((m): m is DocMeta => !!m);
  return metas.sort((a, b) => b.modified - a.modified);
}

export async function deleteDoc(id: string) {
  await del(`doc:${id}`);
  await del(`meta:${id}`);
  if ((await get('last')) === id) await del('last');
}

export const lastDocId = () => get<string>('last');

export function isCadDocument(x: unknown): x is CadDocument {
  const d = x as CadDocument;
  return !!d && d.format === 'onlinecad' && Array.isArray(d.features) && typeof d.id === 'string';
}

/** Renames a saved document without opening it. */
export async function renameStoredDoc(id: string, name: string) {
  const doc = await loadDoc(id);
  const meta = await get<DocMeta>(`meta:${id}`);
  if (!doc || !meta) return;
  await set(`doc:${id}`, { ...doc, name });
  await set(`meta:${id}`, { ...meta, name });
}

/** Saves a copy of a document under a new id and returns the copy's metadata. */
export async function duplicateStoredDoc(id: string, newId: string): Promise<DocMeta | undefined> {
  const doc = await loadDoc(id);
  const meta = await get<DocMeta>(`meta:${id}`);
  if (!doc || !meta) return;
  const now = Date.now();
  const copy: CadDocument = { ...doc, id: newId, name: `${doc.name} copy`, created: now, modified: now };
  const copyMeta: DocMeta = { ...meta, id: newId, name: copy.name, created: now, modified: now };
  await set(`doc:${newId}`, copy);
  await set(`meta:${newId}`, copyMeta);
  return copyMeta;
}
