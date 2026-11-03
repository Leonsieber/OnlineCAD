import * as Comlink from 'comlink';
import { initOCC } from './geometry';
import * as K from './evaluate';
import type { EvalRequest, EvalResult } from './protocol';

// Kernel calls touch shared OpenCascade state, so run them strictly one at a time.
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T> | T): Promise<T> {
  const run = queue.then(async () => {
    await initOCC();
    return fn();
  });
  queue = run.catch(() => undefined);
  return run;
}

function transferables(r: EvalResult): Transferable[] {
  const out: Transferable[] = [];
  for (const m of r.meshes) {
    out.push(m.positions.buffer, m.normals.buffer, m.indices.buffer, m.faceRanges.buffer, m.edgePositions.buffer, m.edgeRanges.buffer, m.faceInfo.buffer, m.edgeInfo.buffer);
  }
  return out;
}

const api = {
  async init(): Promise<number> {
    const t0 = performance.now();
    await initOCC();
    return performance.now() - t0;
  },
  evaluate(req: EvalRequest) {
    return serial(async () => {
      const r = await K.evaluate(req);
      return Comlink.transfer(r, transferables(r));
    });
  },
  putBlob(hash: string, data: string) {
    K.putBlob(hash, data);
  },
  resetSent() {
    K.resetSent();
  },
  measure(id: string) {
    return serial(() => K.measure(id));
  },
  drawingViews(ids: string[]) {
    return serial(() => K.drawingViews(ids));
  },
  exportMeshes(ids: string[]) {
    return serial(() => {
      const meshes = K.exportMeshes(ids);
      return Comlink.transfer(meshes, meshes.flatMap((m) => [m.positions.buffer, m.indices.buffer]));
    });
  },
  exportStep(items: { id: string; name: string; color: string }[]) {
    return serial(async () => {
      const buf = await K.exportStep(items);
      return Comlink.transfer(buf, [buf]);
    });
  },
};

export type KernelApi = typeof api;

Comlink.expose(api);
