// Monotonic id for rebuild requests, shared by the kernel client and the store.
let seq = 0;
export const nextSeq = () => ++seq;
export const currentSeq = () => seq;
