import { newId } from './hash';
import type {
  BooleanFeature,
  BooleanOp,
  CadDocument,
  ChamferFeature,
  CircularPatternFeature,
  DeletePartsFeature,
  EdgeRef,
  FaceRef,
  Feature,
  FeatureType,
  FilletFeature,
  ImportFeature,
  ImportFormat,
  LinearPatternFeature,
  MirrorFeature,
  PrimitiveFeature,
  PrimitiveKind,
  ShellFeature,
  TransformFeature,
  Vec3,
  SketchFeature,
  SketchFrame,
  SketchPlaneName,
  ExtrudeFeature,
  RevolveFeature,
  SweepFeature,
  LoftFeature,
  SolidOp,
  MeshEditFeature,
  MeshOp,
  SculptFeature,
  ScriptFeature,
} from './types';
import { LIBRARY, SCRIPT_TEMPLATE } from './library';

export interface ParamDef {
  key: string;
  label: string;
  def: number;
  min?: number;
  integer?: boolean;
  unit: 'mm' | 'deg' | '';
}

const mm = (key: string, label: string, def: number, min = 0.001): ParamDef => ({ key, label, def, min, unit: 'mm' });

export const PRIMITIVES: Record<PrimitiveKind, { label: string; params: ParamDef[] }> = {
  box: { label: 'Box', params: [mm('width', 'Width (X)', 20), mm('depth', 'Depth (Y)', 20), mm('height', 'Height (Z)', 20)] },
  cylinder: { label: 'Cylinder', params: [mm('radius', 'Radius', 10), mm('height', 'Height', 20)] },
  sphere: { label: 'Sphere', params: [mm('radius', 'Radius', 10)] },
  cone: {
    label: 'Cone',
    params: [mm('bottomRadius', 'Bottom radius', 10, 0), mm('topRadius', 'Top radius', 0, 0), mm('height', 'Height', 20)],
  },
  torus: { label: 'Torus', params: [mm('majorRadius', 'Ring radius', 15), mm('minorRadius', 'Tube radius', 4)] },
  tube: {
    label: 'Tube',
    params: [mm('outerRadius', 'Outer radius', 10), mm('innerRadius', 'Inner radius', 7), mm('height', 'Height', 20)],
  },
  wedge: { label: 'Wedge', params: [mm('width', 'Width (X)', 20), mm('depth', 'Depth (Y)', 20), mm('height', 'Height (Z)', 20)] },
  pyramid: {
    label: 'Pyramid',
    params: [{ key: 'sides', label: 'Sides', def: 4, min: 3, integer: true, unit: '' }, mm('radius', 'Base radius', 14), mm('height', 'Height', 20)],
  },
  prism: {
    label: 'Prism',
    params: [{ key: 'sides', label: 'Sides', def: 6, min: 3, integer: true, unit: '' }, mm('radius', 'Radius', 10), mm('height', 'Height', 20)],
  },
  ellipsoid: {
    label: 'Ellipsoid',
    params: [mm('radiusX', 'Radius X', 15), mm('radiusY', 'Radius Y', 10), mm('radiusZ', 'Radius Z', 8)],
  },
};

export const PRIMITIVE_ORDER: PrimitiveKind[] = ['box', 'cylinder', 'sphere', 'cone', 'torus', 'tube', 'wedge', 'pyramid', 'prism', 'ellipsoid'];

export const FEATURE_LABELS: Record<FeatureType, string> = {
  primitive: 'Shape',
  boolean: 'Boolean',
  fillet: 'Fillet',
  chamfer: 'Chamfer',
  shell: 'Shell',
  transform: 'Transform',
  mirror: 'Mirror',
  linearPattern: 'Linear pattern',
  circularPattern: 'Circular pattern',
  import: 'Import',
  deleteParts: 'Delete parts',
  sketch: 'Sketch',
  extrude: 'Extrude',
  revolve: 'Revolve',
  sweep: 'Sweep',
  loft: 'Loft',
  meshEdit: 'Mesh edit',
  sculpt: 'Sculpt',
  script: 'Script',
};

export const BOOLEAN_LABELS: Record<BooleanOp, string> = { union: 'Union', subtract: 'Subtract', intersect: 'Intersect' };

export const PART_COLORS = ['#6f9cff', '#f2994a', '#5fc28d', '#e05d73', '#b38cf2', '#4cc3d9', '#e8c35a', '#9aa6b8'];

export function featureLabel(f: Feature): string {
  if (f.type === 'primitive') return PRIMITIVES[f.kind].label;
  if (f.type === 'meshEdit') return MESH_OP_LABELS[f.op];
  if (f.type === 'boolean') return BOOLEAN_LABELS[f.op];
  return FEATURE_LABELS[f.type];
}

export function nextName(base: string, features: Feature[]): string {
  let max = 0;
  const re = new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} (\\d+)$`);
  for (const f of features) {
    const m = re.exec(f.name);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${base} ${max + 1}`;
}

export function createDocument(name = 'Untitled'): CadDocument {
  const now = Date.now();
  return {
    format: 'onlinecad',
    version: 1,
    id: newId(),
    name,
    units: 'mm',
    features: [],
    rollback: 0,
    parts: {},
    variables: [],
    created: now,
    modified: now,
  };
}

export function createPrimitive(kind: PrimitiveKind, features: Feature[], position: Vec3 = [0, 0, 0]): PrimitiveFeature {
  const def = PRIMITIVES[kind];
  return {
    id: newId(),
    type: 'primitive',
    kind,
    name: nextName(def.label, features),
    params: Object.fromEntries(def.params.map((p) => [p.key, p.def])),
    placement: { position: [...position], rotation: [0, 0, 0] },
  };
}

export function createBoolean(op: BooleanOp, targets: string[], tools: string[], features: Feature[]): BooleanFeature {
  return { id: newId(), type: 'boolean', op, name: nextName(BOOLEAN_LABELS[op], features), targets, tools, keepTools: false };
}

export function createFillet(edges: EdgeRef[], features: Feature[]): FilletFeature {
  return { id: newId(), type: 'fillet', name: nextName('Fillet', features), edges, radius: 2 };
}

export function createChamfer(edges: EdgeRef[], features: Feature[]): ChamferFeature {
  return { id: newId(), type: 'chamfer', name: nextName('Chamfer', features), edges, distance: 1 };
}

export function createShell(faces: FaceRef[], features: Feature[]): ShellFeature {
  return { id: newId(), type: 'shell', name: nextName('Shell', features), faces, thickness: 2, outward: false };
}

export function createTransform(parts: string[], pivot: Vec3, features: Feature[], copy = false): TransformFeature {
  return {
    id: newId(),
    type: 'transform',
    name: nextName(copy ? 'Copy' : 'Transform', features),
    parts,
    translate: [0, 0, 0],
    rotate: [0, 0, 0],
    pivot,
    scale: 1,
    copy,
  };
}

export function createMirror(parts: string[], features: Feature[]): MirrorFeature {
  return { id: newId(), type: 'mirror', name: nextName('Mirror', features), parts, plane: 'YZ', offset: 0, merge: false };
}

export function createLinearPattern(parts: string[], features: Feature[]): LinearPatternFeature {
  return { id: newId(), type: 'linearPattern', name: nextName('Linear pattern', features), parts, axis: 'X', count: 3, spacing: 30, merge: false };
}

export function createCircularPattern(parts: string[], features: Feature[]): CircularPatternFeature {
  return {
    id: newId(),
    type: 'circularPattern',
    name: nextName('Circular pattern', features),
    parts,
    axis: 'Z',
    center: [0, 0, 0],
    count: 6,
    angle: 360,
    merge: false,
  };
}

export function createImport(
  format: ImportFormat,
  fileName: string,
  data: string,
  dataHash: string,
  scale: number,
  features: Feature[],
): ImportFeature {
  return { id: newId(), type: 'import', name: nextName('Import', features), format, fileName, data, dataHash, scale };
}

export function createDeleteParts(parts: string[], features: Feature[]): DeletePartsFeature {
  return { id: newId(), type: 'deleteParts', name: nextName('Delete parts', features), parts };
}

/** The standard sketch planes. Sketch y is normal × x, so Front and Right have Z pointing up. */
export const SKETCH_PLANES: Record<Exclude<SketchPlaneName, 'face'>, { label: string; frame: SketchFrame }> = {
  XY: { label: 'Top (XY)', frame: { origin: [0, 0, 0], xDir: [1, 0, 0], normal: [0, 0, 1] } },
  XZ: { label: 'Front (XZ)', frame: { origin: [0, 0, 0], xDir: [1, 0, 0], normal: [0, -1, 0] } },
  YZ: { label: 'Right (YZ)', frame: { origin: [0, 0, 0], xDir: [0, 1, 0], normal: [1, 0, 0] } },
};

/** The fixed origin point every sketch starts with, so shapes can be pinned to it. */
export const SKETCH_ORIGIN = 'o';

export function createSketch(plane: SketchPlaneName, features: Feature[], frame?: SketchFrame): SketchFeature {
  return {
    id: newId(),
    type: 'sketch',
    name: nextName('Sketch', features),
    plane,
    offset: 0,
    frame: frame ?? SKETCH_PLANES[plane === 'face' ? 'XY' : plane].frame,
    points: [{ id: SKETCH_ORIGIN, x: 0, y: 0 }],
    entities: [],
    constraints: [{ id: 'fix-origin', type: 'fix', refs: [SKETCH_ORIGIN] }],
  };
}

/** The most recent sketch, which new extrudes and revolves pick by default. */
export function lastSketch(features: Feature[]): string {
  for (let i = features.length - 1; i >= 0; i--) if (features[i].type === 'sketch') return features[i].id;
  return '';
}

export function createExtrude(features: Feature[], op: SolidOp = 'new'): ExtrudeFeature {
  return { id: newId(), type: 'extrude', name: nextName('Extrude', features), sketch: lastSketch(features), distance: 10, extent: 'one', distance2: 5, flip: op === 'cut', op, targets: [] };
}

export function createRevolve(features: Feature[]): RevolveFeature {
  return { id: newId(), type: 'revolve', name: nextName('Revolve', features), sketch: lastSketch(features), axis: 'Y', angle: 360, op: 'new', targets: [] };
}

export function createSweep(features: Feature[]): SweepFeature {
  const sketches = features.filter((f) => f.type === 'sketch');
  return {
    id: newId(),
    type: 'sweep',
    name: nextName('Sweep', features),
    sketch: sketches.at(-1)?.id ?? '',
    path: sketches.at(-2)?.id ?? '',
    op: 'new',
    targets: [],
  };
}

export function createLoft(features: Feature[]): LoftFeature {
  return { id: newId(), type: 'loft', name: nextName('Loft', features), sketches: features.filter((f) => f.type === 'sketch').slice(-2).map((f) => f.id), ruled: false, op: 'new', targets: [] };
}

export const MESH_OP_LABELS: Record<MeshOp, string> = { toMesh: 'Convert to mesh', subdivide: 'Subdivide', smooth: 'Smooth' };

export function createMeshEdit(op: MeshOp, parts: string[], features: Feature[]): MeshEditFeature {
  return { id: newId(), type: 'meshEdit', name: nextName(MESH_OP_LABELS[op], features), parts, op, amount: op === 'smooth' ? 5 : 1 };
}

export function createSculpt(part: string, features: Feature[]): SculptFeature {
  return { id: newId(), type: 'sculpt', name: nextName('Sculpt', features), part, strokes: [] };
}

export function createScript(features: Feature[], libraryId?: string, position: Vec3 = [0, 0, 0]): ScriptFeature {
  const item = libraryId ? LIBRARY.find((l) => l.id === libraryId) : undefined;
  return {
    id: newId(),
    type: 'script',
    name: nextName(item?.label ?? 'Script', features),
    code: item?.code ?? SCRIPT_TEMPLATE,
    params: item ? item.params.map((x) => ({ ...x })) : [{ name: 'size', value: 30 }],
    ...(item && { library: item.id }),
    placement: { position: [...position], rotation: [0, 0, 0] },
  };
}

/** Features with their own placement (shapes and scripts), which moves edit directly. */
export const isPlaced = (f: Feature | undefined): f is PrimitiveFeature | ScriptFeature => f?.type === 'primitive' || f?.type === 'script';

/** Part ids a feature reads, so we can tell whether a part is still "free" to edit in place. */
export function referencedParts(f: Feature): string[] {
  switch (f.type) {
    case 'boolean':
      return [...f.targets, ...f.tools];
    case 'fillet':
    case 'chamfer':
      return f.edges.map((e) => e.part);
    case 'shell':
      return f.faces.map((e) => e.part);
    case 'transform':
    case 'mirror':
    case 'linearPattern':
    case 'circularPattern':
    case 'deleteParts':
    case 'meshEdit':
      return f.parts;
    case 'sculpt':
      return [f.part];
    case 'extrude':
    case 'revolve':
    case 'sweep':
    case 'loft':
      return f.targets;
    default:
      return [];
  }
}
