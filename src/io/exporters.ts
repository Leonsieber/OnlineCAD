import { strToU8, zipSync } from 'fflate';
import { BufferAttribute, BufferGeometry, Group, Mesh, MeshStandardMaterial } from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { kernel } from '../kernel/client';
import type { ExportMesh } from '../kernel/protocol';
import { partColor, partName } from '../store/store';
import { download, safeFileName } from './files';

export type ExportFormat = 'step' | 'stl' | '3mf' | 'obj' | 'ply' | 'glb';

export const EXPORT_FORMATS: { id: ExportFormat; label: string; hint: string }[] = [
  { id: 'step', label: 'STEP (.step)', hint: 'Exact solids for other CAD tools' },
  { id: 'stl', label: 'STL (.stl)', hint: '3D printing' },
  { id: '3mf', label: '3MF (.3mf)', hint: '3D printing with colors' },
  { id: 'obj', label: 'OBJ (.obj)', hint: 'Meshes for most 3D apps' },
  { id: 'ply', label: 'PLY (.ply)', hint: 'Meshes, compact binary' },
  { id: 'glb', label: 'glTF binary (.glb)', hint: 'Web, AR, and game engines' },
];

function triNormal(p: Float32Array, a: number, b: number, c: number): [number, number, number] {
  const ux = p[b * 3] - p[a * 3];
  const uy = p[b * 3 + 1] - p[a * 3 + 1];
  const uz = p[b * 3 + 2] - p[a * 3 + 2];
  const vx = p[c * 3] - p[a * 3];
  const vy = p[c * 3 + 1] - p[a * 3 + 1];
  const vz = p[c * 3 + 2] - p[a * 3 + 2];
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const l = Math.hypot(nx, ny, nz) || 1;
  return [nx / l, ny / l, nz / l];
}

function writeSTL(meshes: ExportMesh[]): Blob {
  const tris = meshes.reduce((n, m) => n + m.indices.length / 3, 0);
  const buf = new ArrayBuffer(84 + tris * 50);
  const dv = new DataView(buf);
  new Uint8Array(buf).set(strToU8('Exported from OnlineCAD'.padEnd(80, ' ')));
  dv.setUint32(80, tris, true);
  let o = 84;
  for (const m of meshes) {
    const p = m.positions;
    for (let t = 0; t < m.indices.length; t += 3) {
      const ids = [m.indices[t], m.indices[t + 1], m.indices[t + 2]];
      const n = triNormal(p, ids[0], ids[1], ids[2]);
      for (const v of n) {
        dv.setFloat32(o, v, true);
        o += 4;
      }
      for (const i of ids) {
        dv.setFloat32(o, p[i * 3], true);
        dv.setFloat32(o + 4, p[i * 3 + 1], true);
        dv.setFloat32(o + 8, p[i * 3 + 2], true);
        o += 12;
      }
      o += 2;
    }
  }
  return new Blob([buf], { type: 'model/stl' });
}

const f6 = (v: number) => (Math.round(v * 1e6) / 1e6).toString();

function writeOBJ(meshes: ExportMesh[]): Blob {
  // OBJ readers (Blender, Maya, game engines) assume Y up, so convert from our Z-up world.
  const out: string[] = ['# Exported from OnlineCAD (units: mm, Y up)'];
  let base = 1;
  for (const m of meshes) {
    out.push(`o ${partName(m.id).replace(/\s+/g, '_')}`);
    for (let i = 0; i < m.positions.length; i += 3) out.push(`v ${f6(m.positions[i])} ${f6(m.positions[i + 2])} ${f6(-m.positions[i + 1])}`);
    for (let t = 0; t < m.indices.length; t += 3) out.push(`f ${m.indices[t] + base} ${m.indices[t + 1] + base} ${m.indices[t + 2] + base}`);
    base += m.positions.length / 3;
  }
  return new Blob([out.join('\n') + '\n'], { type: 'model/obj' });
}

function writePLY(meshes: ExportMesh[]): Blob {
  const nv = meshes.reduce((n, m) => n + m.positions.length / 3, 0);
  const nf = meshes.reduce((n, m) => n + m.indices.length / 3, 0);
  const header = strToU8(
    `ply\nformat binary_little_endian 1.0\ncomment Exported from OnlineCAD\nelement vertex ${nv}\nproperty float x\nproperty float y\nproperty float z\nelement face ${nf}\nproperty list uchar int vertex_indices\nend_header\n`,
  );
  const buf = new ArrayBuffer(header.length + nv * 12 + nf * 13);
  new Uint8Array(buf).set(header);
  const dv = new DataView(buf);
  let o = header.length;
  for (const m of meshes) for (const v of m.positions) {
    dv.setFloat32(o, v, true);
    o += 4;
  }
  let base = 0;
  for (const m of meshes) {
    for (let t = 0; t < m.indices.length; t += 3) {
      dv.setUint8(o, 3);
      dv.setInt32(o + 1, m.indices[t] + base, true);
      dv.setInt32(o + 5, m.indices[t + 1] + base, true);
      dv.setInt32(o + 9, m.indices[t + 2] + base, true);
      o += 13;
    }
    base += m.positions.length / 3;
  }
  return new Blob([buf], { type: 'application/octet-stream' });
}

const xmlEsc = (s: string) => s.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]!);

function write3MF(meshes: ExportMesh[]): Blob {
  const parts: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">',
    '<resources>',
    '<basematerials id="1">',
    ...meshes.map((m) => `<base name="${xmlEsc(partName(m.id))}" displaycolor="${partColor(m.id).toUpperCase()}FF"/>`),
    '</basematerials>',
  ];
  meshes.forEach((m, k) => {
    parts.push(`<object id="${k + 2}" type="model" name="${xmlEsc(partName(m.id))}" pid="1" pindex="${k}"><mesh><vertices>`);
    for (let i = 0; i < m.positions.length; i += 3) parts.push(`<vertex x="${f6(m.positions[i])}" y="${f6(m.positions[i + 1])}" z="${f6(m.positions[i + 2])}"/>`);
    parts.push('</vertices><triangles>');
    for (let t = 0; t < m.indices.length; t += 3) parts.push(`<triangle v1="${m.indices[t]}" v2="${m.indices[t + 1]}" v3="${m.indices[t + 2]}"/>`);
    parts.push('</triangles></mesh></object>');
  });
  parts.push('</resources><build>', ...meshes.map((_, k) => `<item objectid="${k + 2}"/>`), '</build></model>');
  const zip = zipSync({
    '[Content_Types].xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>',
    ),
    '_rels/.rels': strToU8(
      '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>',
    ),
    '3D/3dmodel.model': strToU8(parts.join('\n')),
  });
  return new Blob([zip as BlobPart], { type: 'model/3mf' });
}

async function writeGLB(meshes: ExportMesh[]): Promise<Blob> {
  // glTF is Y-up and in metres.
  const root = new Group();
  root.rotation.x = -Math.PI / 2;
  root.scale.setScalar(0.001);
  for (const m of meshes) {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(m.positions, 3));
    g.setIndex(new BufferAttribute(m.indices, 1));
    g.computeVertexNormals();
    const mesh = new Mesh(g, new MeshStandardMaterial({ color: partColor(m.id), roughness: 0.5, metalness: 0.05 }));
    mesh.name = partName(m.id);
    root.add(mesh);
  }
  const result = await new GLTFExporter().parseAsync(root, { binary: true });
  return new Blob([result as ArrayBuffer], { type: 'model/gltf-binary' });
}

export async function buildExport(format: ExportFormat, ids: string[]): Promise<Blob> {
  if (format === 'step') {
    const buf = await kernel.exportStep(ids.map((id) => ({ id, name: partName(id), color: partColor(id) })));
    return new Blob([buf], { type: 'model/step' });
  }
  const meshes = await kernel.exportMeshes(ids);
  if (format === 'stl') return writeSTL(meshes);
  if (format === 'obj') return writeOBJ(meshes);
  if (format === 'ply') return writePLY(meshes);
  if (format === '3mf') return write3MF(meshes);
  return writeGLB(meshes);
}

export async function exportParts(format: ExportFormat, ids: string[], baseName: string) {
  download(await buildExport(format, ids), `${safeFileName(baseName)}.${format}`);
}
