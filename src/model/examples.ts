import { createDocument } from './defaults';
import type { CadDocument, EdgeRef, Feature, NumExpr, PrimitiveKind, Vec3Expr } from './types';

const prim = (id: string, name: string, kind: PrimitiveKind, params: Record<string, NumExpr>, position: Vec3Expr): Feature => ({
  id,
  type: 'primitive',
  kind,
  name,
  params,
  placement: { position, rotation: [0, 0, 0] },
});

/** Vertical corner edge of the base plate, described by its fingerprint (the trailing 1 means "straight line"). */
const corner = (x: number, y: number): EdgeRef => ({ part: 'base', index: -1, fp: [x, y, 4, x, y, 0, x, y, 8, 8, 1] });

/** A small bracket that shows off the history: shapes, booleans, a fillet, and variables. */
export function bracketExample(): CadDocument {
  const doc = createDocument('Mounting bracket');
  const features: Feature[] = [
    prim('base', 'Base', 'box', { width: 'length', depth: 'width', height: 'thickness' }, [0, 0, 0]),
    prim('boss', 'Boss', 'cylinder', { radius: 12, height: 22 }, [-13, 0, 0]),
    { id: 'join', type: 'boolean', op: 'union', name: 'Union 1', targets: ['base'], tools: ['boss'], keepTools: false },
    prim('bore', 'Bore', 'cylinder', { radius: 6, height: 40 }, [-13, 0, -5]),
    prim('holeA', 'Hole A', 'cylinder', { radius: 'hole', height: 20 }, ['length / 2 - 12', 12, -5]),
    prim('holeB', 'Hole B', 'cylinder', { radius: 'hole', height: 20 }, ['length / 2 - 12', -12, -5]),
    { id: 'cut', type: 'boolean', op: 'subtract', name: 'Subtract 1', targets: ['base'], tools: ['bore', 'holeA', 'holeB'], keepTools: false },
    { id: 'round', type: 'fillet', name: 'Fillet 1', radius: 6, edges: [corner(30, 20), corner(30, -20), corner(-30, 20), corner(-30, -20)] },
  ];
  return {
    ...doc,
    features,
    rollback: features.length,
    variables: [
      { name: 'length', expr: '60 mm' },
      { name: 'width', expr: '40 mm' },
      { name: 'thickness', expr: '8 mm' },
      { name: 'hole', expr: '3.5 mm' },
    ],
    parts: { base: { name: 'Bracket', color: '#6f9cff' } },
  };
}
