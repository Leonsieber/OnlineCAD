import { describe, expect, it } from 'vitest';
import { evalExpression, evalNum, evalVariables } from './expr';

describe('formulas', () => {
  it('does arithmetic with the usual precedence', () => {
    expect(evalExpression('2 + 3 * 4')).toBe(14);
    expect(evalExpression('(2 + 3) * 4')).toBe(20);
    expect(evalExpression('2 ^ 3')).toBe(8);
  });

  it('converts units to millimetres', () => {
    expect(evalExpression('1 in')).toBeCloseTo(25.4);
    expect(evalExpression('2 cm + 5 mm')).toBeCloseTo(25);
  });

  it('uses degrees for trig', () => {
    expect(evalExpression('sin(30)')).toBeCloseTo(0.5);
    expect(evalExpression('atan2(1, 1)')).toBeCloseTo(45);
  });

  it('reads variables', () => {
    expect(evalNum('width / 2', { width: 40 })).toBe(20);
    expect(evalNum(12)).toBe(12);
  });

  it('resolves variables that use other variables', () => {
    const { scope, errors } = evalVariables([
      { name: 'a', expr: '10' },
      { name: 'b', expr: 'a * 2' },
    ]);
    expect(errors).toEqual({});
    expect(scope.b).toBe(20);
  });

  it('rejects unknown names', () => {
    expect(() => evalExpression('nope + 1')).toThrow();
  });
});
