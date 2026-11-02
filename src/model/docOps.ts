import type { CadDocument, Feature } from './types';

export interface DraftLike {
  feature: Feature;
  isNew: boolean;
  index: number;
}

export const activeFeatures = (doc: CadDocument) => doc.features.slice(0, doc.rollback);

/** Features the kernel should build: the active history with the dialog's draft applied. */
export function effectiveFeatures(doc: CadDocument, draft: DraftLike | null): Feature[] {
  const active = activeFeatures(doc);
  if (!draft) return active;
  if (draft.isNew) return [...active.slice(0, draft.index), draft.feature];
  return active.map((f) => (f.id === draft.feature.id ? draft.feature : f));
}

export function insertFeature(doc: CadDocument, f: Feature, index = doc.rollback): CadDocument {
  const features = [...doc.features];
  features.splice(index, 0, f);
  return { ...doc, features, rollback: Math.min(doc.rollback + 1, features.length) };
}

export function replaceFeature(doc: CadDocument, f: Feature): CadDocument {
  return { ...doc, features: doc.features.map((x) => (x.id === f.id ? f : x)) };
}

export function removeFeatures(doc: CadDocument, ids: string[]): CadDocument {
  const set = new Set(ids);
  const before = doc.features.slice(0, doc.rollback).filter((f) => set.has(f.id)).length;
  return { ...doc, features: doc.features.filter((f) => !set.has(f.id)), rollback: doc.rollback - before };
}

export function setRollback(doc: CadDocument, n: number): CadDocument {
  return { ...doc, rollback: Math.max(0, Math.min(n, doc.features.length)) };
}
