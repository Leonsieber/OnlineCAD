import type { Feature, Variable, Vec3 } from '../model/types';

export const FACE_INFO_STRIDE = 8; // center(3), normal(3), area, surface type
export const EDGE_INFO_STRIDE = 14; // midpoint(3), start(3), end(3), length, curve type, face-normal sum(3)

export interface EvalRequest {
  seq: number;
  features: Feature[];
  variables: Variable[];
}

export interface PartResult {
  id: string;
  kind: 'brep' | 'mesh';
  /** Identifies the exact geometry; unchanged keys mean the mesh can be reused. */
  key: string;
  bbox: [Vec3, Vec3];
  /** Feature that created the part, and the last feature that changed it. */
  source: string;
  last: string;
  label: string;
  /** Appearance falls back to this part (copies look like their original). */
  inherit?: string;
  color?: string;
}

export interface MeshData {
  key: string;
  kind: 'brep' | 'mesh';
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  /** [indexStart, indexCount] per B-rep face, in the same order as the shape's faces. */
  faceRanges: Uint32Array;
  /** Line-segment vertex pairs for all B-rep edges. */
  edgePositions: Float32Array;
  /** [vertexStart, vertexCount] per edge into edgePositions. */
  edgeRanges: Uint32Array;
  faceInfo: Float32Array;
  edgeInfo: Float32Array;
}

export type FeatureState = 'ok' | 'error' | 'suppressed' | 'inactive';

export interface FeatureStatus {
  state: FeatureState;
  message?: string;
  /** The error only means "nothing picked yet". */
  incomplete?: boolean;
  /** Built fine, but `message` explains something surprising (like a hole that cut nothing). */
  warning?: boolean;
  ms?: number;
}

export interface EvalResult {
  seq: number;
  parts: PartResult[];
  meshes: MeshData[];
  statuses: Record<string, FeatureStatus>;
  variables: Record<string, number>;
  variableErrors: Record<string, string>;
  ms: number;
}

export interface ExportMesh {
  id: string;
  positions: Float32Array;
  indices: Uint32Array;
}

export interface MeasureResult {
  volume: number;
  area: number;
  centerOfMass: Vec3;
  bbox: [Vec3, Vec3];
  solid: boolean;
}
