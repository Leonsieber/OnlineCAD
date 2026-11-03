import { describe, expect, it } from 'vitest';
import type { SkConstraint, SkEntity, SkPoint } from '../model/types';
import { sketchProfiles } from './profiles';
import { solveSketch } from './solver';

/** A rough rectangle with its corner pinned at the origin, plus a circle. */
function rectangle() {
  const points: SkPoint[] = [
    { id: 'o', x: 0, y: 0 },
    { id: 'p1', x: 0.3, y: -0.2 },
    { id: 'p2', x: 38, y: 1 },
    { id: 'p3', x: 41, y: 22 },
    { id: 'p4', x: -1, y: 19 },
    { id: 'c', x: 20, y: 10 },
  ];
  const entities: SkEntity[] = [
    { id: 'l1', type: 'line', a: 'p1', b: 'p2' },
    { id: 'l2', type: 'line', a: 'p2', b: 'p3' },
    { id: 'l3', type: 'line', a: 'p3', b: 'p4' },
    { id: 'l4', type: 'line', a: 'p4', b: 'p1' },
    { id: 'k', type: 'circle', c: 'c', r: 3 },
  ];
  const constraints: SkConstraint[] = [
    { id: 'f', type: 'fix', refs: ['o'] },
    { id: 'c0', type: 'coincident', refs: ['p1', 'o'] },
    { id: 'h1', type: 'horizontal', refs: ['l1'] },
    { id: 'h2', type: 'horizontal', refs: ['l3'] },
    { id: 'v1', type: 'vertical', refs: ['l2'] },
    { id: 'v2', type: 'vertical', refs: ['l4'] },
    { id: 'w', type: 'distance', refs: ['l1'], value: 'width' },
    { id: 'h', type: 'distance', refs: ['l2'], value: 20 },
  ];
  return { points, entities, constraints };
}

describe('constraint solver', () => {
  it('solves a dimensioned rectangle exactly, with formulas', () => {
    const r = solveSketch(rectangle(), { width: 40 });
    expect(r.ok).toBe(true);
    const p = Object.fromEntries(r.points.map((q) => [q.id, [q.x, q.y]]));
    expect(p.p2[0]).toBeCloseTo(40, 6);
    expect(p.p3[1]).toBeCloseTo(20, 6);
    expect(p.p4[0]).toBeCloseTo(0, 6);
  });

  it('counts the remaining degrees of freedom', () => {
    // The circle can still move (x, y) and grow (r).
    expect(solveSketch(rectangle(), { width: 40 }).dof).toBe(3);
    const g = rectangle();
    g.constraints.push(
      { id: 'r', type: 'radius', refs: ['k'], value: 5 },
      { id: 'cx', type: 'hdistance', refs: ['o', 'c'], value: 20 },
      { id: 'cy', type: 'vdistance', refs: ['o', 'c'], value: 10 },
    );
    expect(solveSketch(g, { width: 40 }).dof).toBe(0);
  });

  it('reports conflicting constraints', () => {
    const g = rectangle();
    g.constraints.push({ id: 'bad', type: 'distance', refs: ['l3'], value: 55 });
    const r = solveSketch(g, { width: 40 });
    expect(r.ok).toBe(false);
  });

  it('follows a dragged point while keeping constraints', () => {
    const r = solveSketch(
      {
        points: [
          { id: 'a', x: 0, y: 0 },
          { id: 'b', x: 10, y: 0 },
        ],
        entities: [{ id: 'l', type: 'line', a: 'a', b: 'b' }],
        constraints: [
          { id: 'f', type: 'fix', refs: ['a'] },
          { id: 'h', type: 'horizontal', refs: ['l'] },
        ],
      },
      {},
      { drag: { point: 'b', x: 25, y: 7 } },
    );
    const b = r.points.find((p) => p.id === 'b')!;
    expect(b.x).toBeCloseTo(25, 3);
    expect(b.y).toBeCloseTo(0, 6);
  });
});

describe('profiles', () => {
  it('finds a region with a hole', () => {
    const r = solveSketch(rectangle(), { width: 40 });
    const { regions } = sketchProfiles({ points: r.points, entities: r.entities, constraints: rectangle().constraints });
    expect(regions).toHaveLength(1);
    expect(regions[0].outer.area).toBeCloseTo(800, 3);
    expect(regions[0].holes).toHaveLength(1);
    expect(regions[0].holes[0].area).toBeCloseTo(Math.PI * 9, 1);
  });

  it('turns an open chain into a path, not a region', () => {
    const { regions, chains } = sketchProfiles({
      points: [
        { id: 'a', x: 0, y: 0 },
        { id: 'b', x: 10, y: 0 },
        { id: 'c', x: 10, y: 10 },
      ],
      entities: [
        { id: 'l1', type: 'line', a: 'a', b: 'b' },
        { id: 'l2', type: 'line', a: 'b', b: 'c' },
      ],
      constraints: [],
    });
    expect(regions).toHaveLength(0);
    expect(chains).toHaveLength(1);
    expect(chains[0]).toHaveLength(2);
  });

  it('ignores construction lines', () => {
    const g = rectangle();
    g.entities = g.entities.map((e) => (e.id === 'l1' ? { ...e, construction: true } : e));
    const r = solveSketch(g, { width: 40 });
    const { regions } = sketchProfiles({ points: r.points, entities: r.entities, constraints: g.constraints });
    // Only the circle is still closed.
    expect(regions).toHaveLength(1);
    expect(regions[0].outer.circle).toBeDefined();
  });
});
