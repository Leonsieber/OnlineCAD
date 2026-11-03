import { describe, expect, it } from 'vitest';
import { sculpt, smooth, subdivide, weld, type MeshGeom } from './meshOps';

/** A unit cube as 12 triangles with unshared corners, the way STL files store it. */
function cube(): MeshGeom {
  const v = [
    [0, 0, 0],
    [1, 0, 0],
    [1, 1, 0],
    [0, 1, 0],
    [0, 0, 1],
    [1, 0, 1],
    [1, 1, 1],
    [0, 1, 1],
  ];
  const faces = [
    [0, 2, 1, 0, 3, 2],
    [4, 5, 6, 4, 6, 7],
    [0, 1, 5, 0, 5, 4],
    [1, 2, 6, 1, 6, 5],
    [2, 3, 7, 2, 7, 6],
    [3, 0, 4, 3, 4, 7],
  ].flat();
  return { positions: Float32Array.from(faces.flatMap((i) => v[i])), indices: Uint32Array.from(faces.map((_, i) => i)) };
}

describe('mesh tools', () => {
  it('welds repeated corners', () => {
    const m = weld(cube());
    expect(m.positions.length / 3).toBe(8);
    expect(m.indices.length / 3).toBe(12);
  });

  it('subdivides into four triangles per level and rounds the shape inward', () => {
    const m = subdivide(cube(), 2);
    expect(m.indices.length / 3).toBe(12 * 16);
    let maxX = -Infinity;
    for (let i = 0; i < m.positions.length; i += 3) maxX = Math.max(maxX, m.positions[i]);
    expect(maxX).toBeLessThan(1);
  });

  it('smooths without moving the mesh off center', () => {
    const m = smooth(subdivide(cube(), 1), 3);
    let cx = 0;
    for (let i = 0; i < m.positions.length; i += 3) cx += m.positions[i];
    expect(cx / (m.positions.length / 3)).toBeCloseTo(0.5, 2);
  });

  it('inflates only near the stroke', () => {
    const base = subdivide(cube(), 2);
    const out = sculpt(base, [{ brush: 'inflate', points: [[0.5, 0.5, 1.1]], normal: [0, 0, 1], radius: 0.3, strength: 1 }]);
    const welded = weld(base);
    let moved = 0;
    for (let i = 0; i < out.positions.length; i += 3) {
      const d = Math.hypot(out.positions[i] - welded.positions[i], out.positions[i + 1] - welded.positions[i + 1], out.positions[i + 2] - welded.positions[i + 2]);
      if (d > 1e-6) moved++;
    }
    expect(moved).toBeGreaterThan(0);
    expect(moved).toBeLessThan(out.positions.length / 3 / 4);
  });
});
