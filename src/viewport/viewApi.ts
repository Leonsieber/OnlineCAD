import { Box3, Plane, Raycaster, Sphere, Vector2, Vector3, type Camera, type Mesh } from 'three';
import { useStore } from '../store/store';
import type { Vec3 } from '../model/types';
import { pickables, viewRefs } from './registry';

export type ViewName = 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom' | 'iso';

const VIEW_DIRS: Record<ViewName, Vec3> = {
  front: [0, -1, 0],
  back: [0, 1, 0],
  left: [-1, 0, 0],
  right: [1, 0, 0],
  // A hair of tilt keeps the "up" direction well defined when looking straight down or up.
  top: [0, -1e-4, 1],
  bottom: [0, 1e-4, -1],
  iso: [1, -1, 0.85],
};

let getCamera: () => Camera | null = () => null;
let invalidateFn: () => void = () => {};

export function bindView(camera: () => Camera | null, invalidate: () => void) {
  getCamera = camera;
  invalidateFn = invalidate;
}

/** Bounding box of visible parts (or of the given part ids). */
export function partsBox(ids?: string[]): Box3 {
  const { parts, doc } = useStore.getState();
  const box = new Box3();
  for (const p of parts) {
    if (ids && !ids.includes(p.id)) continue;
    if (!ids && doc.parts[p.id]?.hidden) continue;
    box.expandByPoint(new Vector3(...p.bbox[0]));
    box.expandByPoint(new Vector3(...p.bbox[1]));
  }
  return box;
}

function fitSphere(ids?: string[]): Sphere {
  const box = partsBox(ids);
  if (box.isEmpty()) return new Sphere(new Vector3(0, 0, 10), 60);
  const s = box.getBoundingSphere(new Sphere());
  s.radius = Math.max(s.radius, 5);
  return s;
}

export const viewApi = {
  invalidate() {
    invalidateFn();
  },
  fitAll(animate = true, ids?: string[]) {
    const c = viewRefs.controls;
    if (!c) return;
    void c.fitToSphere(fitSphere(ids), animate);
  },
  setView(name: ViewName, animate = true) {
    const c = viewRefs.controls;
    const cam = getCamera();
    if (!c || !cam) return;
    const s = fitSphere();
    const fov = 'fov' in cam ? ((cam as { fov: number }).fov * Math.PI) / 180 : 0.6;
    const dist = (s.radius / Math.sin(fov / 2)) * 1.05;
    const d = new Vector3(...VIEW_DIRS[name]).normalize().multiplyScalar(dist);
    void c.setLookAt(s.center.x + d.x, s.center.y + d.y, s.center.z + d.z, s.center.x, s.center.y, s.center.z, animate);
    if ('isOrthographicCamera' in cam) void c.fitToSphere(s, animate);
  },
  /** Looks straight at a plane (for sketching), with `up` pointing up on screen. */
  lookAlong(normal: Vec3, up: Vec3, center: Vec3, radius: number, animate = true) {
    const c = viewRefs.controls;
    const cam = getCamera();
    if (!c || !cam) return;
    const fov = 'fov' in cam ? ((cam as { fov: number }).fov * Math.PI) / 180 : 0.6;
    const dist = (radius / Math.sin(fov / 2)) * 1.1;
    // A hair of tilt toward -up keeps "up" well defined when the normal is vertical.
    const d = new Vector3(...normal).normalize().addScaledVector(new Vector3(...up).normalize(), -1e-4).normalize().multiplyScalar(dist);
    void c.setLookAt(center[0] + d.x, center[1] + d.y, center[2] + d.z, center[0], center[1], center[2], animate);
    if ('isOrthographicCamera' in cam) void c.fitToSphere(new Sphere(new Vector3(...center), radius), animate);
  },
  /** Point on the ground plane under the middle of the view, snapped to a 5 mm grid. */
  groundPointAtCenter(): Vec3 {
    const cam = getCamera();
    if (!cam) return [0, 0, 0];
    const ray = new Raycaster();
    ray.setFromCamera(new Vector2(0, 0), cam);
    const hit = ray.ray.intersectPlane(new Plane(new Vector3(0, 0, 1), 0), new Vector3());
    if (!hit || hit.length() > 5000) return [0, 0, 0];
    const snap = (v: number) => Math.round(v / 5) * 5 + 0;
    return [snap(hit.x), snap(hit.y), 0];
  },
  /**
   * Where a shape dropped at this screen point should land: on the face under the cursor (with that
   * face's normal) or on the ground plane. Null when the point is outside the 3D view.
   */
  dropAt(clientX: number, clientY: number, exclude?: string): { point: Vec3; normal: Vec3 } | null {
    const canvas = viewRefs.canvas;
    const cam = getCamera();
    if (!canvas || !cam) return null;
    const r = canvas.getBoundingClientRect();
    if (clientX < r.left || clientX > r.right || clientY < r.top || clientY > r.bottom) return null;
    const ray = new Raycaster();
    ray.setFromCamera(new Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1), cam);
    const { doc } = useStore.getState();
    const meshes = [...pickables.values()].filter((e) => e.partId !== exclude && !doc.parts[e.partId]?.hidden).map((e) => e.mesh as Mesh);
    const hit = ray.intersectObjects(meshes, false)[0];
    if (hit?.face) {
      const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
      if (n.dot(ray.ray.direction) > 0) n.negate();
      return { point: hit.point.toArray() as Vec3, normal: n.toArray() as Vec3 };
    }
    const p = ray.ray.intersectPlane(new Plane(new Vector3(0, 0, 1), 0), new Vector3());
    if (!p || p.length() > 20000) return null;
    return { point: p.toArray() as Vec3, normal: [0, 0, 1] };
  },

  /** Saves the view as a PNG at twice the screen resolution. */
  saveImage() {
    const canvas = viewRefs.canvas;
    const gl = viewRefs.renderer;
    if (!canvas || !gl) return;
    const { doc } = useStore.getState();
    const prev = gl.getPixelRatio();
    gl.setPixelRatio(Math.min(prev * 2, 4));
    viewRefs.renderNow?.();
    canvas.toBlob((blob) => {
      gl.setPixelRatio(prev);
      invalidateFn();
      if (!blob) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${doc.name.replace(/[^\w\- ]+/g, '').trim() || 'model'}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    }, 'image/png');
  },
  /** Small thumbnail of the current view for the documents list. */
  capture(): string | null {
    const src = viewRefs.canvas;
    if (!src || !src.width) return null;
    const w = 320;
    const h = Math.round((w * src.height) / src.width);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(src, 0, 0, w, h);
    return c.toDataURL('image/webp', 0.75);
  },
};
