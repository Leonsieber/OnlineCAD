// Compact binary container for imported triangle meshes, stored base64-encoded inside Import features.
// Layout: "OCM1", u32 count, then per mesh: u32 nameLen, name (padded to 4), i32 color (-1 = none),
// u32 floatCount, u32 indexCount, f32[floatCount], u32[indexCount].

export interface PackedMesh {
  name: string;
  color: number | null;
  positions: Float32Array;
  indices: Uint32Array;
}

const MAGIC = 0x314d434f; // "OCM1" little-endian

export function packMeshes(meshes: PackedMesh[]): Uint8Array {
  const enc = new TextEncoder();
  const names = meshes.map((m) => enc.encode(m.name));
  let size = 8;
  meshes.forEach((m, i) => {
    size += 4 + Math.ceil(names[i].length / 4) * 4 + 12 + m.positions.length * 4 + m.indices.length * 4;
  });
  const buf = new ArrayBuffer(size);
  const dv = new DataView(buf);
  const u8 = new Uint8Array(buf);
  dv.setUint32(0, MAGIC, true);
  dv.setUint32(4, meshes.length, true);
  let o = 8;
  meshes.forEach((m, i) => {
    dv.setUint32(o, names[i].length, true);
    o += 4;
    u8.set(names[i], o);
    o += Math.ceil(names[i].length / 4) * 4;
    dv.setInt32(o, m.color ?? -1, true);
    dv.setUint32(o + 4, m.positions.length, true);
    dv.setUint32(o + 8, m.indices.length, true);
    o += 12;
    new Float32Array(buf, o, m.positions.length).set(m.positions);
    o += m.positions.length * 4;
    new Uint32Array(buf, o, m.indices.length).set(m.indices);
    o += m.indices.length * 4;
  });
  return u8;
}

export function unpackMeshes(bytes: Uint8Array): PackedMesh[] {
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== MAGIC) throw new Error('Not a packed mesh');
  const count = dv.getUint32(4, true);
  const dec = new TextDecoder();
  const out: PackedMesh[] = [];
  let o = 8;
  for (let i = 0; i < count; i++) {
    const nameLen = dv.getUint32(o, true);
    o += 4;
    const name = dec.decode(new Uint8Array(buf, o, nameLen));
    o += Math.ceil(nameLen / 4) * 4;
    const color = dv.getInt32(o, true);
    const nf = dv.getUint32(o + 4, true);
    const ni = dv.getUint32(o + 8, true);
    o += 12;
    const positions = new Float32Array(buf.slice(o, o + nf * 4));
    o += nf * 4;
    const indices = new Uint32Array(buf.slice(o, o + ni * 4));
    o += ni * 4;
    out.push({ name, color: color < 0 ? null : color, positions, indices });
  }
  return out;
}

export function bytesToBase64(bytes: Uint8Array): string {
  const native = (bytes as unknown as { toBase64?: () => string }).toBase64;
  if (typeof native === 'function') return native.call(bytes);
  let s = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK) as unknown as number[]);
  }
  return btoa(s);
}

export function base64ToBytes(b64: string): Uint8Array {
  const fromBase64 = (Uint8Array as unknown as { fromBase64?: (s: string) => Uint8Array }).fromBase64;
  if (typeof fromBase64 === 'function') return fromBase64(b64);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
