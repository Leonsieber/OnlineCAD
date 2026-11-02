import { Matrix4, Mesh, type BufferGeometry, type Material, type Object3D } from 'three';
import { ThreeMFLoader } from 'three/examples/jsm/loaders/3MFLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { hashString } from '../model/hash';
import { bytesToBase64, packMeshes, type PackedMesh } from '../model/meshPack';
import type { ImportFormat } from '../model/types';

export const IMPORT_ACCEPT = '.step,.stp,.stl,.obj,.ply,.glb,.gltf,.3mf,.off';
export const IMPORT_LABEL = 'STEP, STL, OBJ, PLY, GLB/glTF, 3MF, OFF';

export interface ImportPayload {
  format: ImportFormat;
  data: string;
  dataHash: string;
  /** Suggested scale to millimetres (glTF is in metres). */
  scale: number;
  triangles: number;
}

// Y-up formats get rotated so "up" becomes +Z, matching CAD convention.
const Y_UP_TO_Z_UP = new Matrix4().makeRotationX(Math.PI / 2);

function packGeometry(g: BufferGeometry, name: string, color: number | null, matrix?: Matrix4): PackedMesh {
  const geo = matrix ? g.clone().applyMatrix4(matrix) : g;
  const pos = geo.getAttribute('position');
  const positions = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    positions[i * 3] = pos.getX(i);
    positions[i * 3 + 1] = pos.getY(i);
    positions[i * 3 + 2] = pos.getZ(i);
  }
  const indices = geo.index ? Uint32Array.from(geo.index.array) : Uint32Array.from({ length: pos.count }, (_, i) => i);
  if (geo !== g) geo.dispose();
  return { name, color, positions, indices };
}

function materialColor(m: Material | Material[] | undefined): number | null {
  const mat = Array.isArray(m) ? m[0] : m;
  const c = (mat as { color?: { getHex(): number } } | undefined)?.color;
  return c ? c.getHex() : null;
}

function collect(root: Object3D, extra?: Matrix4): PackedMesh[] {
  root.updateMatrixWorld(true);
  const out: PackedMesh[] = [];
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh || !mesh.geometry?.getAttribute('position')) return;
    const m = extra ? extra.clone().multiply(mesh.matrixWorld) : mesh.matrixWorld;
    out.push(packGeometry(mesh.geometry, mesh.name || `Mesh ${out.length + 1}`, materialColor(mesh.material), m));
  });
  if (out.length > 64) {
    // Hundreds of tiny parts are unusable in the tree; merge them into one.
    const total = out.reduce((n, p) => n + p.positions.length, 0);
    const positions = new Float32Array(total);
    const indices: number[] = [];
    let offset = 0;
    for (const p of out) {
      positions.set(p.positions, offset);
      const base = offset / 3;
      for (const i of p.indices) indices.push(i + base);
      offset += p.positions.length;
    }
    return [{ name: 'Merged', color: out[0].color, positions, indices: Uint32Array.from(indices) }];
  }
  return out;
}

function parseOFF(text: string, name: string): PackedMesh {
  const tokens = text
    .split('\n')
    .map((l) => l.replace(/#.*/, '').trim())
    .filter(Boolean)
    .join(' ')
    .split(/\s+/);
  let i = 0;
  if (/^C?N?OFF$/i.test(tokens[0])) i++;
  const nv = Number(tokens[i++]);
  const nf = Number(tokens[i++]);
  i++; // edge count
  const positions = new Float32Array(nv * 3);
  for (let v = 0; v < nv * 3; v++) positions[v] = Number(tokens[i++]);
  const indices: number[] = [];
  for (let f = 0; f < nf; f++) {
    const n = Number(tokens[i++]);
    const poly = tokens.slice(i, i + n).map(Number);
    i += n;
    for (let k = 1; k + 1 < n; k++) indices.push(poly[0], poly[k], poly[k + 1]);
  }
  if (!nv || !indices.length) throw new Error('This OFF file has no faces');
  return { name, color: null, positions, indices: Uint32Array.from(indices) };
}

export async function readImport(file: File): Promise<ImportPayload> {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  const buf = await file.arrayBuffer();
  const base = file.name.replace(/\.[^.]+$/, '');
  if (ext === 'step' || ext === 'stp') {
    const data = bytesToBase64(new Uint8Array(buf));
    return { format: 'step', data, dataHash: hashString(data), scale: 1, triangles: 0 };
  }
  let meshes: PackedMesh[];
  let scale = 1;
  switch (ext) {
    case 'stl':
      meshes = [packGeometry(new STLLoader().parse(buf), base, null)];
      break;
    case 'ply':
      meshes = [packGeometry(new PLYLoader().parse(buf), base, null)];
      break;
    case 'obj':
      meshes = collect(new OBJLoader().parse(new TextDecoder().decode(buf)), Y_UP_TO_Z_UP);
      break;
    case 'glb':
    case 'gltf': {
      const gltf = await new GLTFLoader().parseAsync(buf, '');
      meshes = collect(gltf.scene, Y_UP_TO_Z_UP);
      scale = 1000;
      break;
    }
    case '3mf':
      meshes = collect(new ThreeMFLoader().parse(buf));
      break;
    case 'off':
      meshes = [parseOFF(new TextDecoder().decode(buf), base)];
      break;
    default:
      throw new Error(`.${ext} files aren't supported yet. Try ${IMPORT_LABEL}.`);
  }
  if (!meshes.length) throw new Error('No geometry found in this file');
  const data = bytesToBase64(packMeshes(meshes));
  const triangles = meshes.reduce((n, m) => n + m.indices.length / 3, 0);
  return { format: 'mesh', data, dataHash: hashString(data), scale, triangles };
}
