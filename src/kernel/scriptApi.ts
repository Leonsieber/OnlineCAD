// Runs Script features in the geometry worker. A script is the body of a JavaScript function that
// gets `cad` (the whole replicad API plus the helpers below) and `p` (its parameters, already
// evaluated) and returns a shape, an array of shapes, or an array of { shape, name } objects.
import * as R from 'replicad';
import type { AnyShape } from 'replicad';
import { UserError } from './geometry';

type Shape = AnyShape & { fuse(o: AnyShape): AnyShape; cut(o: AnyShape): AnyShape; intersect(o: AnyShape): AnyShape };

/** Simple helpers so short scripts read like OpenSCAD: Z is up, boxes and cylinders sit on the plate. */
const helpers = {
  /** A box centered on X and Y, from Z = 0 up. */
  box: (x: number, y: number, z: number) => R.makeBaseBox(x, y, z),
  /** A cylinder standing on the plate at the origin. */
  cylinder: (radius: number, height: number) => R.makeCylinder(radius, height),
  sphere: (radius: number) => R.makeSphere(radius),
  /** A cone or truncated cone standing on the plate. */
  cone: (r1: number, r2: number, height: number) => {
    const base = R.drawCircle(r1).sketchOnPlane('XY') as R.Sketch;
    const top = R.drawCircle(Math.max(r2, 1e-3)).sketchOnPlane('XY', height) as R.Sketch;
    return base.loftWith(top);
  },
  /** A regular polygon prism (e.g. 6 sides for a hex), with `radius` to the corners. */
  prism: (sides: number, radius: number, height: number) => (R.drawPolysides(radius, sides).sketchOnPlane('XY') as R.Sketch).extrude(height),
  /** A prism from a closed 2D outline of [x, y] points. */
  extrudePoints: (points: [number, number][], height: number) => {
    const pen = R.draw(points[0]);
    for (const pt of points.slice(1)) pen.lineTo(pt);
    return (pen.close().sketchOnPlane('XY') as R.Sketch).extrude(height);
  },
  union: (...shapes: AnyShape[]) => shapes.slice(1).reduce((a, b) => (a as Shape).fuse(b), shapes[0]),
  subtract: (base: AnyShape, ...tools: AnyShape[]) => tools.reduce((a, b) => (a as Shape).cut(b), base),
  intersect: (a: AnyShape, b: AnyShape) => (a as Shape).intersect(b),
  /** Moves a shape (replicad's translate consumes the original, so this reads as a plain function). */
  move: (s: AnyShape, x: number, y: number, z: number) => (s as never as { translate(v: number[]): AnyShape }).translate([x, y, z]),
  /** Rotates a shape about an axis through the origin, in degrees. */
  turn: (s: AnyShape, degrees: number, axis: [number, number, number] = [0, 0, 1]) => (s as never as { rotate(a: number, c: number[], d: number[]): AnyShape }).rotate(degrees, [0, 0, 0], axis),
};

export interface ScriptPart {
  shape: AnyShape;
  name?: string;
}

export function runScript(code: string, params: Record<string, number>): ScriptPart[] {
  const api = { ...R, ...helpers };
  let fn: (...args: unknown[]) => unknown;
  try {
    // Shadow the worker's network and global access; scripts only need `cad` and `p`.
    fn = new Function('cad', 'p', 'fetch', 'XMLHttpRequest', 'importScripts', 'WebSocket', 'postMessage', 'self', 'globalThis', `"use strict";\n${code}`) as typeof fn;
  } catch (e) {
    throw new UserError(`Script syntax error: ${(e as Error).message}`);
  }
  let out: unknown;
  try {
    out = fn(api, params);
  } catch (e) {
    if (e instanceof UserError) throw e;
    const msg = e instanceof Error ? e.message : typeof e === 'object' ? 'OpenCascade could not build that shape' : String(e);
    throw new UserError(`Script error: ${msg}`);
  }
  const list = Array.isArray(out) ? out : [out];
  const parts: ScriptPart[] = [];
  for (const item of list) {
    if (!item) continue;
    if (typeof item === 'object' && 'shape' in (item as object)) parts.push(item as ScriptPart);
    else parts.push({ shape: item as AnyShape });
  }
  if (!parts.length) throw new UserError('The script must return a shape (for example: return cad.box(20, 20, 10))');
  for (const pt of parts) {
    if (!pt.shape || typeof (pt.shape as { delete?: unknown }).delete !== 'function') throw new UserError('The script returned something that is not a shape');
  }
  return parts;
}
