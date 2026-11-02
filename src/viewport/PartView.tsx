import { useEffect, useMemo, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import { BufferAttribute, BufferGeometry, DoubleSide, EdgesGeometry, Group, Mesh, MeshStandardMaterial } from 'three';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import type { MeshData } from '../kernel/protocol';
import type { DisplayMode } from '../store/store';
import { liveMove } from './liveMove';
import { pickables } from './registry';

export type PartLook = 'none' | 'hover' | 'selected';

interface Props {
  id: string;
  data: MeshData;
  color: string;
  display: DisplayMode;
  look: PartLook;
  edgeColor: string;
  accent: string;
  hover: string;
  /** Tinkercad-style hole: drawn as see-through gray glass. */
  hole?: boolean;
}

const HOLE_COLOR = '#9aa3b4';

export function buildGeometry(data: MeshData): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(data.positions, 3));
  g.setIndex(new BufferAttribute(data.indices, 1));
  if (data.normals.length && data.normals.length === data.positions.length) g.setAttribute('normal', new BufferAttribute(data.normals, 3));
  else g.computeVertexNormals();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  // indirect keeps the index buffer order intact, which our face ranges depend on.
  if (data.indices.length) (g.computeBoundsTree as (o: { indirect: boolean }) => unknown)({ indirect: true });
  return g;
}

export function PartView({ id, data, color, display, look, edgeColor, accent, hover, hole = false }: Props) {
  const invalidate = useThree((s) => s.invalidate);
  const group = useRef<Group>(null!);
  const meshRef = useRef<Mesh>(null!);

  const geometry = useMemo(() => buildGeometry(data), [data]);
  useEffect(
    () => () => {
      geometry.disposeBoundsTree();
      geometry.dispose();
    },
    [geometry],
  );

  const edges = useMemo(() => {
    let pos: ArrayLike<number> = data.edgePositions;
    // Imported meshes have no B-rep edges; draw creases instead (skip for huge meshes).
    if (data.kind === 'mesh' && data.indices.length < 1_500_000) {
      const eg = new EdgesGeometry(geometry, 30);
      pos = eg.getAttribute('position').array as Float32Array;
      eg.dispose();
    }
    if (!pos.length) return null;
    const g = new LineSegmentsGeometry();
    g.setPositions(pos as Float32Array);
    const ls = new LineSegments2(g, new LineMaterial({ color: 0x000000, linewidth: 1.15, worldUnits: false }));
    ls.raycast = () => {};
    return ls;
  }, [data, geometry]);
  useEffect(
    () => () => {
      edges?.geometry.dispose();
      (edges?.material as LineMaterial | undefined)?.dispose();
    },
    [edges],
  );

  const material = useMemo(
    () =>
      new MeshStandardMaterial({
        roughness: 0.5,
        metalness: 0.08,
        side: DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
      }),
    [],
  );
  useEffect(() => () => material.dispose(), [material]);

  useEffect(() => {
    material.color.set(hole ? HOLE_COLOR : color);
    material.emissive.set(look === 'none' ? '#000000' : look === 'hover' ? hover : accent);
    material.emissiveIntensity = look === 'selected' ? 0.28 : look === 'hover' ? 0.16 : 0;
    const see = display === 'xray' || hole;
    const wire = display === 'wireframe';
    material.transparent = see;
    material.opacity = hole ? 0.32 : see ? 0.28 : 1;
    material.depthWrite = !see && !wire;
    material.colorWrite = !wire;
    material.needsUpdate = true;
    if (edges) {
      const m = edges.material as LineMaterial;
      m.color.set(look === 'selected' ? accent : look === 'hover' ? hover : hole ? HOLE_COLOR : edgeColor);
      m.linewidth = look === 'none' ? 1.15 : 2;
    }
    invalidate();
  }, [material, edges, color, look, display, edgeColor, accent, hover, hole, invalidate]);

  useEffect(() => {
    pickables.set(id, { partId: id, mesh: meshRef.current, data });
    return () => {
      if (pickables.get(id)?.data === data) pickables.delete(id);
    };
  }, [id, data]);

  useEffect(() => {
    const apply = () => {
      const g = group.current;
      if (!g) return;
      if (liveMove.parts.includes(id)) g.matrix.copy(liveMove.matrix);
      else g.matrix.identity();
      g.matrixWorldNeedsUpdate = true;
      invalidate();
    };
    apply();
    return liveMove.subscribe(apply);
  }, [id, invalidate]);

  const showEdges = display !== 'shaded';
  return (
    <group ref={group} matrixAutoUpdate={false}>
      <mesh ref={meshRef} geometry={geometry} material={material} userData={{ partId: id }} />
      {edges && showEdges && <primitive object={edges} />}
    </group>
  );
}
