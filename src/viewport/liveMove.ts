import { Matrix4 } from 'three';

// Transient transform applied to parts while the gizmo is dragged (and until the rebuilt
// geometry arrives), kept outside React state so dragging doesn't re-render the app.
type Listener = () => void;

let parts: string[] = [];
let matrix = new Matrix4();
let holdUntilSeq: number | null = null;
const listeners = new Set<Listener>();

const emit = () => listeners.forEach((l) => l());

export const liveMove = {
  get parts() {
    return parts;
  },
  get matrix() {
    return matrix;
  },
  get holdUntil() {
    return holdUntilSeq;
  },
  set(ids: string[], m: Matrix4) {
    parts = ids;
    matrix = m.clone();
    holdUntilSeq = null;
    emit();
  },
  /** Keep showing the moved preview until the rebuild with this sequence number lands. */
  hold(seq: number) {
    holdUntilSeq = seq;
  },
  clear() {
    if (!parts.length && holdUntilSeq === null) return;
    parts = [];
    matrix = new Matrix4();
    holdUntilSeq = null;
    emit();
  },
  subscribe(l: Listener) {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },
};
