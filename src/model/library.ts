// The parts library: ready-made parametric parts. Each one is a script with parameters, so it
// rebuilds when you change a size, and you can open the code to adapt it.

export interface LibraryItem {
  id: string;
  label: string;
  category: 'Fasteners' | 'Mechanical' | 'Enclosures' | 'Basics';
  description: string;
  params: { name: string; value: number }[];
  code: string;
}

export const LIBRARY: LibraryItem[] = [
  {
    id: 'hexBolt',
    label: 'Hex bolt',
    category: 'Fasteners',
    description: 'Metric hex bolt (head sizes follow ISO 4017)',
    params: [
      { name: 'd', value: 6 },
      { name: 'length', value: 20 },
    ],
    code: `// Head across flats is about 1.6 × d, head height 0.7 × d.
const s = p.d * 1.6;
const k = p.d * 0.7;
const head = cad.move(cad.prism(6, s / Math.sqrt(3), k), 0, 0, p.length);
const shank = cad.cylinder(p.d / 2, p.length);
return cad.union(shank, head);`,
  },
  {
    id: 'hexNut',
    label: 'Hex nut',
    category: 'Fasteners',
    description: 'Metric hex nut with a clearance hole',
    params: [{ name: 'd', value: 6 }],
    code: `const s = p.d * 1.6;
const m = p.d * 0.8;
const body = cad.prism(6, s / Math.sqrt(3), m);
const hole = cad.move(cad.cylinder(p.d / 2 + 0.1, m + 2), 0, 0, -1);
return cad.subtract(body, hole);`,
  },
  {
    id: 'washer',
    label: 'Washer',
    category: 'Fasteners',
    description: 'Flat washer (ISO 7089 proportions)',
    params: [{ name: 'd', value: 6 }],
    code: `const od = p.d * 2;
const t = Math.max(0.5, p.d * 0.16);
const ring = cad.cylinder(od / 2, t);
const hole = cad.move(cad.cylinder(p.d / 2 + 0.2, t + 2), 0, 0, -1);
return cad.subtract(ring, hole);`,
  },
  {
    id: 'standoff',
    label: 'Standoff',
    category: 'Fasteners',
    description: 'Hex spacer with a through hole, for circuit boards',
    params: [
      { name: 'd', value: 3 },
      { name: 'height', value: 10 },
    ],
    code: `const body = cad.prism(6, (p.d * 1.8) / Math.sqrt(3), p.height);
const hole = cad.move(cad.cylinder(p.d / 2, p.height + 2), 0, 0, -1);
return cad.subtract(body, hole);`,
  },
  {
    id: 'spurGear',
    label: 'Spur gear',
    category: 'Mechanical',
    description: 'Involute spur gear: set the tooth count and module',
    params: [
      { name: 'teeth', value: 20 },
      { name: 'module', value: 2 },
      { name: 'thickness', value: 6 },
      { name: 'bore', value: 5 },
    ],
    code: `// Involute teeth, 20° pressure angle.
const z = Math.round(p.teeth), m = p.module;
const rp = (z * m) / 2;                 // pitch radius
const rb = rp * Math.cos((20 * Math.PI) / 180); // base radius
const ra = rp + m;                      // tip radius
const rf = Math.max(rp - 1.25 * m, 1);  // root radius
const inv = (r) => { const a = Math.acos(Math.min(1, rb / r)); return Math.tan(a) - a; };
const half = Math.PI / (2 * z) + inv(rp); // half tooth angle at the base circle
const pts = [];
for (let i = 0; i < z; i++) {
  const c = (i * 2 * Math.PI) / z;
  const flank = [];
  for (let j = 0; j <= 6; j++) {
    const r = Math.max(rb, rf) + ((ra - Math.max(rb, rf)) * j) / 6;
    flank.push([r, half - inv(r)]);
  }
  pts.push([rf * Math.cos(c - half - 0.02), rf * Math.sin(c - half - 0.02)]);
  for (const [r, a] of flank) pts.push([r * Math.cos(c - a), r * Math.sin(c - a)]);
  for (const [r, a] of [...flank].reverse()) pts.push([r * Math.cos(c + a), r * Math.sin(c + a)]);
  pts.push([rf * Math.cos(c + half + 0.02), rf * Math.sin(c + half + 0.02)]);
}
const gear = cad.extrudePoints(pts, p.thickness);
if (p.bore <= 0) return gear;
return cad.subtract(gear, cad.move(cad.cylinder(p.bore / 2, p.thickness + 2), 0, 0, -1));`,
  },
  {
    id: 'spring',
    label: 'Coil spring',
    category: 'Mechanical',
    description: 'Helical compression spring',
    params: [
      { name: 'radius', value: 8 },
      { name: 'wire', value: 1.2 },
      { name: 'pitch', value: 4 },
      { name: 'height', value: 30 },
    ],
    code: `const helix = cad.makeHelix(p.pitch, p.height, p.radius);
// The wire's circle sits across the start of the helix.
const t = [0, 2 * Math.PI * p.radius, p.pitch];
const plane = new cad.Plane([p.radius, 0, 0], [1, 0, 0], t);
const profile = cad.drawCircle(p.wire / 2).sketchOnPlane(plane).wire;
return cad.genericSweep(profile, helix, { frenet: true });`,
  },
  {
    id: 'bearing',
    label: 'Ball bearing',
    category: 'Mechanical',
    description: 'Simplified radial bearing (608 by default)',
    params: [
      { name: 'inner', value: 8 },
      { name: 'outer', value: 22 },
      { name: 'width', value: 7 },
    ],
    code: `const ring = (r1, r2, h) => cad.subtract(cad.cylinder(r2, h), cad.move(cad.cylinder(r1, h + 2), 0, 0, -1));
const gap = (p.outer - p.inner) / 2;
const outerRing = ring(p.outer / 2 - gap * 0.3, p.outer / 2, p.width);
const innerRing = ring(p.inner / 2, p.inner / 2 + gap * 0.3, p.width);
return [{ shape: outerRing, name: 'Outer ring' }, { shape: innerRing, name: 'Inner ring' }];`,
  },
  {
    id: 'enclosure',
    label: 'Project box',
    category: 'Enclosures',
    description: 'Hollow box with rounded corners and an open top',
    params: [
      { name: 'width', value: 80 },
      { name: 'depth', value: 50 },
      { name: 'height', value: 30 },
      { name: 'wall', value: 2 },
      { name: 'corner', value: 4 },
    ],
    code: `let b = cad.box(p.width, p.depth, p.height);
// Round the vertical edges, then hollow it out from the top face.
b = b.fillet(p.corner, (e) => e.inDirection('Z'));
return b.shell(p.wall, (f) => f.inPlane('XY', p.height));`,
  },
  {
    id: 'lid',
    label: 'Box lid',
    category: 'Enclosures',
    description: 'Lid with a lip that fits the project box',
    params: [
      { name: 'width', value: 80 },
      { name: 'depth', value: 50 },
      { name: 'wall', value: 2 },
      { name: 'corner', value: 4 },
    ],
    code: `const plate = cad.box(p.width, p.depth, p.wall).fillet(p.corner, (e) => e.inDirection('Z'));
const lipW = p.width - 2 * p.wall - 0.4, lipD = p.depth - 2 * p.wall - 0.4;
let lip = cad.box(lipW, lipD, 3).fillet(Math.max(p.corner - p.wall, 0.5), (e) => e.inDirection('Z'));
lip = cad.subtract(lip, cad.move(cad.box(lipW - 2 * p.wall, lipD - 2 * p.wall, 5), 0, 0, -1));
return cad.union(plate, cad.move(lip, 0, 0, -3));`,
  },
  {
    id: 'roundedBlock',
    label: 'Rounded block',
    category: 'Basics',
    description: 'A box with every edge rounded',
    params: [
      { name: 'width', value: 40 },
      { name: 'depth', value: 30 },
      { name: 'height', value: 20 },
      { name: 'radius', value: 4 },
    ],
    code: `return cad.box(p.width, p.depth, p.height).fillet(p.radius);`,
  },
  {
    id: 'tube',
    label: 'Pipe elbow',
    category: 'Basics',
    description: 'A 90° bent pipe',
    params: [
      { name: 'outer', value: 10 },
      { name: 'wall', value: 1.5 },
      { name: 'bend', value: 20 },
    ],
    code: `const ring = cad.drawCircle(p.outer / 2).cut(cad.drawCircle(p.outer / 2 - p.wall));
// Revolve the ring a quarter turn around an axis "bend" away from its center.
return ring.sketchOnPlane('XZ').revolve([0, 0, 1], { origin: [p.bend, 0, 0], angle: 90 });`,
  },
];

export const SCRIPT_TEMPLATE = `// Return a shape. "cad" has helpers (box, cylinder, sphere, cone, prism,
// union, subtract, move, turn) plus the whole replicad API. "p" holds the
// parameters listed above. Example:
const base = cad.box(p.size, p.size, 10);
const hole = cad.move(cad.cylinder(p.size / 4, 12), 0, 0, -1);
return cad.subtract(base, hole);`;
