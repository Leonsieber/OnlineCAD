// Shape-size math shared by the kernel (to build shapes) and the UI (to place resize handles).
import type { PrimitiveKind, Vec3 } from './types';

/** Regular polygon with a flat side at the bottom (-Y), so squares and hexagons line up with the grid. */
export function polygonVertices(sides: number, radius: number): [number, number][] {
  const n = Math.max(3, Math.round(sides));
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const t = -Math.PI / 2 + Math.PI / n + (2 * Math.PI * i) / n;
    out.push([radius * Math.cos(t), radius * Math.sin(t)]);
  }
  return out;
}

/** Bounding box of a primitive in its own frame (base on z = 0, centered on the Z axis), stretch included. */
export function primitiveLocalBox(kind: PrimitiveKind, p: Record<string, number>, s: Vec3 = [1, 1, 1]): [Vec3, Vec3] {
  let x0 = 0;
  let x1 = 0;
  let y0 = 0;
  let y1 = 0;
  let h = 0;
  const round = (r: number) => {
    x0 = y0 = -r;
    x1 = y1 = r;
  };
  switch (kind) {
    case 'box':
    case 'wedge':
      x0 = -p.width / 2;
      x1 = p.width / 2;
      y0 = -p.depth / 2;
      y1 = p.depth / 2;
      h = p.height;
      break;
    case 'cylinder':
      round(p.radius);
      h = p.height;
      break;
    case 'tube':
      round(p.outerRadius);
      h = p.height;
      break;
    case 'cone':
      round(Math.max(p.bottomRadius, p.topRadius));
      h = p.height;
      break;
    case 'sphere':
      round(p.radius);
      h = 2 * p.radius;
      break;
    case 'ellipsoid':
      x0 = -p.radiusX;
      x1 = p.radiusX;
      y0 = -p.radiusY;
      y1 = p.radiusY;
      h = 2 * p.radiusZ;
      break;
    case 'torus':
      round(p.majorRadius + p.minorRadius);
      h = 2 * p.minorRadius;
      break;
    case 'prism':
    case 'pyramid': {
      const v = polygonVertices(p.sides, p.radius);
      x0 = Math.min(...v.map((q) => q[0]));
      x1 = Math.max(...v.map((q) => q[0]));
      y0 = Math.min(...v.map((q) => q[1]));
      y1 = Math.max(...v.map((q) => q[1]));
      h = p.height;
      break;
    }
  }
  return [
    [x0 * s[0], y0 * s[1], 0],
    [x1 * s[0], y1 * s[1], h * s[2]],
  ];
}
