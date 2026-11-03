// Document model shared by the UI thread and the geometry worker.
// Everything here must stay plain JSON so documents can be saved, diffed, and sent to the worker.

export type Vec3 = [number, number, number];
/** A number, or an expression such as "width / 2" or "1 in" that is evaluated at rebuild time. */
export type NumExpr = number | string;
export type Vec3Expr = [NumExpr, NumExpr, NumExpr];

export type PrimitiveKind =
  | 'box'
  | 'cylinder'
  | 'sphere'
  | 'cone'
  | 'torus'
  | 'tube'
  | 'wedge'
  | 'pyramid'
  | 'prism'
  | 'ellipsoid';

/**
 * `scale` stretches the shape along its own axes first (from resize handles; missing means 1, 1, 1).
 * Rotation is in degrees, applied about world X, then Y, then Z, then the shape is moved to `position`.
 */
export interface Placement {
  position: Vec3Expr;
  rotation: Vec3Expr;
  scale?: Vec3Expr;
}

/**
 * Edges and faces are referenced by a geometric fingerprint so the reference survives rebuilds
 * (the index alone changes whenever upstream topology changes).
 * Edge fingerprint: midpoint(3), start(3), end(3), length. Face fingerprint: center(3), normal(3), area.
 * `box` is the part's bounding box when it was picked, so the reference can follow the part when it
 * is moved or resized later (older documents don't have it).
 */
export interface EdgeRef {
  part: string;
  index: number;
  fp: number[];
  box?: [Vec3, Vec3];
}
export interface FaceRef {
  part: string;
  index: number;
  fp: number[];
  box?: [Vec3, Vec3];
}

interface FeatureBase {
  id: string;
  name: string;
  suppressed?: boolean;
}

export interface PrimitiveFeature extends FeatureBase {
  type: 'primitive';
  kind: PrimitiveKind;
  params: Record<string, NumExpr>;
  placement: Placement;
}

export type BooleanOp = 'union' | 'subtract' | 'intersect';
export interface BooleanFeature extends FeatureBase {
  type: 'boolean';
  op: BooleanOp;
  targets: string[];
  tools: string[];
  keepTools: boolean;
}

export interface FilletFeature extends FeatureBase {
  type: 'fillet';
  edges: EdgeRef[];
  radius: NumExpr;
}

export interface ChamferFeature extends FeatureBase {
  type: 'chamfer';
  edges: EdgeRef[];
  distance: NumExpr;
}

export interface ShellFeature extends FeatureBase {
  type: 'shell';
  faces: FaceRef[];
  thickness: NumExpr;
  outward: boolean;
}

export interface TransformFeature extends FeatureBase {
  type: 'transform';
  parts: string[];
  translate: Vec3Expr;
  rotate: Vec3Expr;
  pivot: Vec3;
  scale: NumExpr;
  /** Per-axis stretch about the pivot (world axes). Only mesh parts can stretch unevenly. */
  stretch?: Vec3Expr;
  copy: boolean;
}

export type AxisName = 'X' | 'Y' | 'Z';
export type MirrorPlane = 'YZ' | 'XZ' | 'XY';

export interface MirrorFeature extends FeatureBase {
  type: 'mirror';
  parts: string[];
  plane: MirrorPlane;
  offset: NumExpr;
  merge: boolean;
}

export interface LinearPatternFeature extends FeatureBase {
  type: 'linearPattern';
  parts: string[];
  axis: AxisName;
  count: NumExpr;
  spacing: NumExpr;
  merge: boolean;
}

export interface CircularPatternFeature extends FeatureBase {
  type: 'circularPattern';
  parts: string[];
  axis: AxisName;
  center: Vec3Expr;
  count: NumExpr;
  angle: NumExpr;
  merge: boolean;
}

export type ImportFormat = 'step' | 'mesh';
export interface ImportFeature extends FeatureBase {
  type: 'import';
  format: ImportFormat;
  fileName: string;
  /** Base64 file payload: the original STEP file, or packed triangles for mesh formats. */
  data: string;
  dataHash: string;
  scale: NumExpr;
}

export interface DeletePartsFeature extends FeatureBase {
  type: 'deleteParts';
  parts: string[];
}

// ---- Sketches: 2D geometry with constraints, drawn on a plane ----

/** Where a sketch lies in 3D. y is normal × xDir. */
export interface SketchFrame {
  origin: Vec3;
  xDir: Vec3;
  normal: Vec3;
}

export interface SkPoint {
  id: string;
  x: number;
  y: number;
}

export type SkEntity =
  | { id: string; type: 'line'; a: string; b: string; construction?: boolean }
  | { id: string; type: 'circle'; c: string; r: number; construction?: boolean }
  /** Counter-clockwise from a to b around c. */
  | { id: string; type: 'arc'; c: string; a: string; b: string; construction?: boolean };

export type SkConstraintType =
  | 'coincident'
  | 'horizontal'
  | 'vertical'
  | 'parallel'
  | 'perpendicular'
  | 'equal'
  | 'tangent'
  | 'pointOn'
  | 'midpoint'
  | 'fix'
  | 'distance'
  | 'hdistance'
  | 'vdistance'
  | 'radius'
  | 'angle';

/** `refs` are point or entity ids. Dimensions (distance, radius, angle) carry a value that takes formulas. */
export interface SkConstraint {
  id: string;
  type: SkConstraintType;
  refs: string[];
  value?: NumExpr;
}

export type SketchPlaneName = 'XY' | 'XZ' | 'YZ' | 'face';

export interface SketchFeature extends FeatureBase {
  type: 'sketch';
  plane: SketchPlaneName;
  /** Offset along the normal for the standard planes. */
  offset: NumExpr;
  frame: SketchFrame;
  points: SkPoint[];
  entities: SkEntity[];
  constraints: SkConstraint[];
  /** Picked face for sketches on a face (shown in the dialog; the frame is what gets used). */
  face?: FaceRef;
}

export type SolidOp = 'new' | 'add' | 'cut' | 'intersect';

export interface ExtrudeFeature extends FeatureBase {
  type: 'extrude';
  sketch: string;
  distance: NumExpr;
  /** one: along the normal; symmetric: half each way; both: `distance` forward and `distance2` back. */
  extent: 'one' | 'symmetric' | 'both';
  distance2: NumExpr;
  flip: boolean;
  op: SolidOp;
  /** Parts to add to or cut from. Empty means every solid the new shape touches. */
  targets: string[];
}

export interface RevolveFeature extends FeatureBase {
  type: 'revolve';
  sketch: string;
  /** 'X' or 'Y' (the sketch's own axes) or the id of a line in the sketch. */
  axis: string;
  angle: NumExpr;
  op: SolidOp;
  targets: string[];
}

export interface SweepFeature extends FeatureBase {
  type: 'sweep';
  /** Closed profile. */
  sketch: string;
  /** Sketch whose lines and arcs form the path. */
  path: string;
  op: SolidOp;
  targets: string[];
}

export interface LoftFeature extends FeatureBase {
  type: 'loft';
  /** Two or more sketches, each with one closed profile, in order. */
  sketches: string[];
  ruled: boolean;
  op: SolidOp;
  targets: string[];
}

// ---- Mesh tools ----

export type MeshOp = 'toMesh' | 'subdivide' | 'smooth';

export interface MeshEditFeature extends FeatureBase {
  type: 'meshEdit';
  parts: string[];
  op: MeshOp;
  /** Subdivision levels or smoothing passes. */
  amount: NumExpr;
}

export type SculptBrush = 'inflate' | 'deflate' | 'smooth' | 'flatten' | 'grab';

/** One brush stroke, recorded in world coordinates and replayed on rebuild. */
export interface SculptStroke {
  brush: SculptBrush;
  points: Vec3[];
  normal: Vec3;
  radius: number;
  strength: number;
}

export interface SculptFeature extends FeatureBase {
  type: 'sculpt';
  part: string;
  strokes: SculptStroke[];
}

// ---- Scripts ----

export interface ScriptParam {
  name: string;
  value: NumExpr;
}

/** JavaScript that builds shapes with the replicad API (see src/kernel/scriptApi.ts). */
export interface ScriptFeature extends FeatureBase {
  type: 'script';
  code: string;
  params: ScriptParam[];
  /** Library item this came from, if any. */
  library?: string;
  placement: Placement;
}

export type Feature =
  | PrimitiveFeature
  | BooleanFeature
  | FilletFeature
  | ChamferFeature
  | ShellFeature
  | TransformFeature
  | MirrorFeature
  | LinearPatternFeature
  | CircularPatternFeature
  | ImportFeature
  | DeletePartsFeature
  | SketchFeature
  | ExtrudeFeature
  | RevolveFeature
  | SweepFeature
  | LoftFeature
  | MeshEditFeature
  | SculptFeature
  | ScriptFeature;

export type FeatureType = Feature['type'];

export interface PartProps {
  name?: string;
  color?: string;
  hidden?: boolean;
  /** Tinkercad-style hole: shown see-through and subtracted when grouped. */
  hole?: boolean;
  /** Material preset id (see src/model/materials.ts); PLA when missing. */
  material?: string;
}

export interface Variable {
  name: string;
  expr: string;
}

export interface CadDocument {
  format: 'onlinecad';
  version: 1;
  id: string;
  name: string;
  units: 'mm';
  features: Feature[];
  /** Number of active features; features at index >= rollback are rolled back (not built). */
  rollback: number;
  parts: Record<string, PartProps>;
  variables: Variable[];
  created: number;
  modified: number;
}
