import { Vector3, type Camera, type Mesh } from 'three';
import type { CameraControlsImpl } from '@react-three/drei';
import type { MeshData } from '../kernel/protocol';

/** Part meshes the picker can raycast against, keyed by part id. */
export interface PickEntry {
  partId: string;
  mesh: Mesh;
  data: MeshData;
}
export const pickables = new Map<string, PickEntry>();

/** Camera pose survives switching between perspective and orthographic cameras. */
export const cameraPose = {
  position: new Vector3(150, -210, 140),
  target: new Vector3(0, 0, 10),
  /** World-space height visible at the target distance; keeps zoom equal across projections. */
  visibleHeight: 160,
};

export const cameraEvents = new EventTarget();

export const viewRefs: {
  controls: CameraControlsImpl | null;
  camera: Camera | null;
  /** The gizmo's hovered handle ("X", "XY", ...) or null; clicks on a handle must not select. */
  gizmoAxis: () => string | null;
  gizmoDragging: boolean;
  /** A resize handle, arrow, or part body is being dragged (or the pointer is over a handle). */
  handleDragging: boolean;
  handleHovered: boolean;
  canvas: HTMLCanvasElement | null;
} = { controls: null, camera: null, gizmoAxis: () => null, gizmoDragging: false, handleDragging: false, handleHovered: false, canvas: null };
