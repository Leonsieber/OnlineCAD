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
 */
export interface EdgeRef {
  part: string;
  index: number;
  fp: number[];
}
export interface FaceRef {
  part: string;
  index: number;
  fp: number[];
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
  | DeletePartsFeature;

export type FeatureType = Feature['type'];

export interface PartProps {
  name?: string;
  color?: string;
  hidden?: boolean;
  /** Tinkercad-style hole: shown see-through and subtracted when grouped. */
  hole?: boolean;
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
