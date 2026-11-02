import * as Comlink from 'comlink';
import { effectiveFeatures } from '../model/docOps';
import type { Feature, Variable } from '../model/types';
import { useStore } from '../store/store';
import type { KernelApi } from './kernel.worker';
import { nextSeq } from './seq';

const worker = new Worker(new URL('./kernel.worker.ts', import.meta.url), { type: 'module' });
export const kernel = Comlink.wrap<KernelApi>(worker);

interface Pending {
  seq: number;
  features: Feature[];
  variables: Variable[];
}

const sentBlobs = new Set<string>();
let inflight = false;
let pending: Pending | null = null;
let started = false;

export function startKernel() {
  if (started) return;
  started = true;
  const store = useStore.getState();
  kernel
    .init()
    .then((ms) => {
      console.info(`[kernel] OpenCascade ready in ${Math.round(ms)} ms`);
      useStore.getState().setKernel('ready');
      scheduleEval();
    })
    .catch((e) => {
      console.error(e);
      store.setKernel('error', String(e?.message ?? e));
    });
  worker.addEventListener('error', (e) => {
    useStore.getState().setKernel('error', e.message || 'The geometry worker stopped');
  });
  useStore.subscribe((s, prev) => {
    if (s.doc !== prev.doc || s.draft !== prev.draft) scheduleEval();
  });
}

/** Queue a rebuild of the current document; bursts of edits collapse into one rebuild. */
export function scheduleEval() {
  const s = useStore.getState();
  pending = { seq: nextSeq(), features: effectiveFeatures(s.doc, s.draft), variables: s.doc.variables };
  void pump();
}

async function pump() {
  if (inflight || !pending || useStore.getState().kernel !== 'ready') return;
  const req = pending;
  pending = null;
  inflight = true;
  useStore.setState({ busy: true });
  try {
    for (const f of req.features) {
      if (f.type === 'import' && !sentBlobs.has(f.dataHash)) {
        await kernel.putBlob(f.dataHash, f.data);
        sentBlobs.add(f.dataHash);
      }
    }
    const features = req.features.map((f) => (f.type === 'import' ? { ...f, data: '' } : f));
    const res = await kernel.evaluate({ seq: req.seq, features, variables: req.variables });
    useStore.getState().applyEval(res);
  } catch (e) {
    console.error('[kernel] rebuild failed', e);
    useStore.getState().toast(`Rebuild failed: ${(e as Error)?.message ?? e}`, 'error');
  } finally {
    inflight = false;
    if (pending) void pump();
    else useStore.setState({ busy: false });
  }
}
