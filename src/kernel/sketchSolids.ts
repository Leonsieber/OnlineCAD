// Builds solids from sketches: extrude, revolve, sweep, and loft. Runs in the geometry worker.
import { draw, drawCircle, genericSweep, Plane, type AnyShape, type Drawing, type Sketch, type Sketches } from 'replicad';
import { evalNum } from '../model/expr';
import type { ExtrudeFeature, LoftFeature, NumExpr, RevolveFeature, SketchFeature, Vec3 } from '../model/types';
import { arcMid, sketchProfiles, type Loop, type Region, type Seg } from '../sketch/profiles';
import { solveSketch } from '../sketch/solver';
import { IncompleteError, UserError, safeDelete } from './geometry';

const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const add = (a: Vec3, b: Vec3, k = 1): Vec3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];

export interface SolvedSketch {
  feature: SketchFeature;
  regions: Region[];
  chains: Seg[][];
  loops: Loop[];
  /** Sketch coordinates to world coordinates. */
  toWorld(x: number, y: number): Vec3;
  plane(): Plane;
}

/** Solves a sketch with the current variable values and finds its profiles. */
export function solveForBuild(f: SketchFeature, scope: Record<string, number>): SolvedSketch {
  const r = solveSketch(f, scope);
  if (r.errors.length) throw new UserError(r.errors[0]);
  const geom = { points: r.points, entities: r.entities, constraints: f.constraints };
  const { regions, chains, loops } = sketchProfiles(geom);
  const { origin, xDir, normal } = f.frame;
  const yDir = cross(normal, xDir);
  const shift = scale(normal, evalNum(f.offset ?? 0, scope));
  const o = add(origin, shift);
  return {
    feature: { ...f, points: r.points, entities: r.entities },
    regions,
    chains,
    loops,
    toWorld: (x, y) => add(add(o, xDir, x), yDir, y),
    plane: () => new Plane(o, xDir, normal),
  };
}

function loopDrawing(l: Loop): Drawing {
  if (l.circle) return drawCircle(l.circle.r).translate(l.circle.center[0], l.circle.center[1]);
  const pen = draw(l.segs[0].from);
  for (const s of l.segs) {
    if (s.kind === 'line') pen.lineTo(s.to);
    else pen.threePointsArcTo(s.to, arcMid(s));
  }
  return pen.close();
}

function regionDrawing(r: Region): Drawing {
  let d = loopDrawing(r.outer);
  for (const h of r.holes) d = d.cut(loopDrawing(h));
  return d;
}

function regionsDrawing(regions: Region[]): Drawing {
  let d = regionDrawing(regions[0]);
  for (const r of regions.slice(1)) d = d.fuse(regionDrawing(r));
  return d;
}

function chainDrawing(chain: Seg[]): Drawing {
  const pen = draw(chain[0].from);
  for (const s of chain) {
    if (s.kind === 'line') pen.lineTo(s.to);
    else pen.threePointsArcTo(s.to, arcMid(s));
  }
  return pen.done();
}

function needRegions(s: SolvedSketch): Region[] {
  if (!s.regions.length) throw new UserError(`"${s.feature.name}" has no closed profile. Close the outline (the shaded area shows what will be used).`);
  return s.regions;
}

const onPlane = (d: Drawing, s: SolvedSketch) => d.sketchOnPlane(s.plane()) as Sketch | Sketches;

export function extrudeSolid(f: ExtrudeFeature, s: SolvedSketch, num: (v: NumExpr, label: string) => number): AnyShape {
  const regions = needRegions(s);
  const d1 = num(f.distance, 'Distance');
  const d2 = f.extent === 'both' ? num(f.distance2, 'Second distance') : 0;
  if (!(d1 > 0) && f.extent !== 'both') throw new UserError('Distance must be greater than 0');
  const n = scale(s.feature.frame.normal, f.flip ? -1 : 1);
  const total = f.extent === 'symmetric' ? d1 : f.extent === 'both' ? d1 + d2 : d1;
  if (!(total > 0)) throw new UserError('The total depth must be greater than 0');
  const back = f.extent === 'symmetric' ? d1 / 2 : f.extent === 'both' ? d2 : 0;
  const sk = onPlane(regionsDrawing(regions), s);
  const plane = s.plane();
  const origin = add([plane.origin.x, plane.origin.y, plane.origin.z], n, -back);
  plane.delete();
  return sk.extrude(total, { extrusionDirection: n, origin });
}

export function revolveSolid(f: RevolveFeature, s: SolvedSketch, num: (v: NumExpr, label: string) => number): AnyShape {
  const regions = needRegions(s);
  const angle = num(f.angle, 'Angle');
  if (!(Math.abs(angle) > 0)) throw new UserError('Angle must not be 0');
  let origin: Vec3 = s.toWorld(0, 0);
  let axis: Vec3;
  if (f.axis === 'X') axis = s.feature.frame.xDir;
  else if (f.axis === 'Y') axis = cross(s.feature.frame.normal, s.feature.frame.xDir);
  else {
    const line = s.feature.entities.find((e) => e.id === f.axis);
    if (!line || line.type !== 'line') throw new IncompleteError('Pick the axis: a line in the sketch, or its X or Y axis');
    const pa = s.feature.points.find((p) => p.id === line.a)!;
    const pb = s.feature.points.find((p) => p.id === line.b)!;
    origin = s.toWorld(pa.x, pa.y);
    const b = s.toWorld(pb.x, pb.y);
    axis = [b[0] - origin[0], b[1] - origin[1], b[2] - origin[2]];
  }
  const sk = onPlane(regionsDrawing(regions), s);
  return sk.revolve(axis, { origin, angle: Math.min(Math.abs(angle), 360) * Math.sign(angle) });
}

export function sweepSolid(profile: SolvedSketch, path: SolvedSketch): AnyShape {
  const regions = needRegions(profile);
  const chain = path.chains[0] ?? path.loops[0]?.segs;
  if (!chain?.length) throw new UserError(`"${path.feature.name}" has no path. Draw connected lines or arcs in it.`);
  const spine = (chainDrawing(chain).sketchOnPlane(path.plane()) as Sketch).wire;
  const sweepLoop = (l: Loop): AnyShape => {
    const wire = (loopDrawing(l).sketchOnPlane(profile.plane()) as Sketch).wire;
    return genericSweep(wire, spine, { frenet: true }, false) as AnyShape;
  };
  let result: AnyShape | null = null;
  for (const r of regions) {
    let solid = sweepLoop(r.outer);
    for (const h of r.holes) {
      const cutter = sweepLoop(h);
      const next = (solid as never as { cut(o: AnyShape): AnyShape }).cut(cutter);
      safeDelete(cutter);
      safeDelete(solid);
      solid = next;
    }
    if (!result) result = solid;
    else {
      const next = (result as never as { fuse(o: AnyShape): AnyShape }).fuse(solid);
      safeDelete(result);
      safeDelete(solid);
      result = next;
    }
  }
  return result!;
}

export function loftSolid(f: LoftFeature, sketches: SolvedSketch[]): AnyShape {
  if (sketches.length < 2) throw new IncompleteError('Pick at least two sketches to loft between');
  const profiles = sketches.map((s) => {
    const r = needRegions(s);
    return loopDrawing(r[0].outer).sketchOnPlane(s.plane()) as Sketch;
  });
  return profiles[0].loftWith(profiles.slice(1), { ruled: f.ruled });
}
