// 3D-print check: paints overhangs that need support, shows the printer's build volume, and sums
// up whether the model fits, sits on the plate, and roughly how much filament and time it takes.
import { useEffect, useMemo, useState } from 'react';
import { Line } from '@react-three/drei';
import { BufferAttribute, BufferGeometry, DoubleSide } from 'three';
import { create } from 'zustand';
import { kernel } from '../kernel/client';
import type { MeshData } from '../kernel/protocol';
import { formatNum } from '../model/expr';
import { materialDef } from '../model/materials';
import { useStore } from '../store/store';
import { partsBox } from './viewApi';

interface PrintCheckState {
  active: boolean;
  bed: [number, number, number];
  /** Surfaces flatter than this (degrees from horizontal, facing down) need support. */
  angle: number;
}

const loadBed = (): [number, number, number] => {
  try {
    const v = JSON.parse(localStorage.getItem('onlinecad.bed') ?? 'null');
    if (Array.isArray(v) && v.length === 3) return v as [number, number, number];
  } catch {
    // storage unavailable: use the default
  }
  return [220, 220, 250];
};

export const usePrintCheck = create<PrintCheckState>(() => ({ active: false, bed: loadBed(), angle: 45 }));

export function togglePrintCheck(on = !usePrintCheck.getState().active) {
  usePrintCheck.setState({ active: on });
}

export function setBed(bed: [number, number, number]) {
  usePrintCheck.setState({ bed });
  try {
    localStorage.setItem('onlinecad.bed', JSON.stringify(bed));
  } catch {
    // storage unavailable: the size just isn't remembered
  }
}

/** Triangles facing down more steeply than the limit, skipping ones that rest on the plate. */
function overhangs(m: MeshData, angle: number, floor: number): { positions: Float32Array; area: number; total: number } {
  const p = m.positions;
  const idx = m.indices;
  const limit = -Math.cos((angle * Math.PI) / 180);
  const out: number[] = [];
  let area = 0;
  let total = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3;
    const b = idx[t + 1] * 3;
    const c = idx[t + 2] * 3;
    const ux = p[b] - p[a];
    const uy = p[b + 1] - p[a + 1];
    const uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a];
    const vy = p[c + 1] - p[a + 1];
    const vz = p[c + 2] - p[a + 2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (!len) continue;
    const ar = len / 2;
    total += ar;
    if (nz / len >= limit) continue;
    if (Math.max(p[a + 2], p[b + 2], p[c + 2]) < floor + 0.05) continue;
    area += ar;
    out.push(p[a], p[a + 1], p[a + 2], p[b], p[b + 1], p[b + 2], p[c], p[c + 1], p[c + 2]);
  }
  return { positions: Float32Array.from(out), area, total };
}

function useCheckedParts() {
  const parts = useStore((s) => s.parts);
  const doc = useStore((s) => s.doc);
  const meshes = useStore((s) => s.meshes);
  return useMemo(() => parts.filter((p) => !doc.parts[p.id]?.hidden && !doc.parts[p.id]?.hole).map((p) => ({ part: p, mesh: meshes.get(p.key) })), [parts, doc, meshes]);
}

export function PrintCheckLayer() {
  const { active, bed, angle } = usePrintCheck();
  const checked = useCheckedParts();
  const box = useMemo(() => partsBox(checked.map((c) => c.part.id)), [checked]);
  const floor = box.isEmpty() ? 0 : Math.min(box.min.z, 0);
  const geoms = useMemo(() => {
    if (!active) return [];
    return checked.flatMap(({ part, mesh }) => {
      if (!mesh) return [];
      const o = overhangs(mesh, angle, floor);
      if (!o.positions.length) return [];
      const g = new BufferGeometry();
      g.setAttribute('position', new BufferAttribute(o.positions, 3));
      return [{ id: part.id, g }];
    });
  }, [active, checked, angle, floor]);
  useEffect(() => () => geoms.forEach((x) => x.g.dispose()), [geoms]);
  if (!active) return null;
  const fits = !box.isEmpty() && box.max.x - box.min.x <= bed[0] && box.max.y - box.min.y <= bed[1] && box.max.z - box.min.z <= bed[2];
  const [bx, by, bz] = [bed[0] / 2, bed[1] / 2, bed[2]];
  const c: [number, number, number][] = [
    [-bx, -by, 0],
    [bx, -by, 0],
    [bx, by, 0],
    [-bx, by, 0],
  ];
  const color = fits ? '#3fb97a' : '#f2626e';
  return (
    <>
      {geoms.map((x) => (
        <mesh key={x.id} geometry={x.g} renderOrder={6}>
          <meshBasicMaterial color="#ff3b4f" side={DoubleSide} transparent opacity={0.75} polygonOffset polygonOffsetFactor={-2} polygonOffsetUnits={-2} depthWrite={false} />
        </mesh>
      ))}
      <Line points={[...c, c[0]]} color={color} lineWidth={1.6} />
      <Line points={[...c.map(([x, y]) => [x, y, bz] as [number, number, number]), [c[0][0], c[0][1], bz]]} color={color} lineWidth={1} transparent opacity={0.6} />
      {c.map(([x, y], i) => (
        <Line key={i} points={[[x, y, 0], [x, y, bz]]} color={color} lineWidth={1} transparent opacity={0.6} />
      ))}
    </>
  );
}

/** The summary card shown over the view while the print check is on. */
export function PrintCheckCard() {
  const { active, bed, angle } = usePrintCheck();
  const checked = useCheckedParts();
  const doc = useStore((s) => s.doc);
  const [volume, setVolume] = useState<{ mm3: number; grams: number; meshOnly: boolean } | null>(null);
  const key = checked.map((c) => c.part.key).join('|');

  useEffect(() => {
    if (!active) return;
    let stop = false;
    void Promise.all(checked.map((c) => (c.part.kind === 'brep' ? kernel.measure(c.part.id) : null))).then((rs) => {
      if (stop) return;
      let mm3 = 0;
      let grams = 0;
      rs.forEach((r, i) => {
        if (!r) return;
        mm3 += r.volume;
        // Typical slicer settings: two walls plus 20% infill come to roughly 40% of the solid volume.
        grams += (r.volume / 1000) * 0.4 * materialDef(doc.parts[checked[i].part.id]?.material).density;
      });
      setVolume({ mm3, grams, meshOnly: rs.every((r) => !r) });
    });
    return () => {
      stop = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, key]);

  if (!active) return null;
  const box = partsBox(checked.map((c) => c.part.id));
  const size = box.isEmpty() ? [0, 0, 0] : [box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z];
  const fits = size[0] <= bed[0] && size[1] <= bed[1] && size[2] <= bed[2];
  const floor = box.isEmpty() ? 0 : Math.min(box.min.z, 0);
  let over = 0;
  let total = 0;
  for (const c of checked) {
    if (!c.mesh) continue;
    const o = overhangs(c.mesh, angle, floor);
    over += o.area;
    total += o.total;
  }
  const below = !box.isEmpty() && box.min.z < -0.01;
  const floating = !box.isEmpty() && box.min.z > 0.01;
  // Rough time: about 8 mm³ of plastic per second on a typical printer.
  const minutes = volume ? (volume.mm3 * 0.4) / 8 / 60 : 0;
  const row = (ok: boolean | null, label: string, value: string) => (
    <div className={`pc-row${ok === false ? ' bad' : ok ? ' good' : ''}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
  return (
    <div className="print-card">
      <div className="pc-title">3D print check</div>
      {row(fits, 'Fits the printer', `${formatNum(size[0], 0)} × ${formatNum(size[1], 0)} × ${formatNum(size[2], 0)} mm`)}
      <div className="pc-bed">
        Build volume
        {[0, 1, 2].map((i) => (
          <input
            key={i}
            type="number"
            value={bed[i]}
            aria-label={['Bed X', 'Bed Y', 'Bed Z'][i]}
            onChange={(e) => {
              const b = [...bed] as [number, number, number];
              b[i] = Math.max(1, Number(e.target.value) || 1);
              setBed(b);
            }}
          />
        ))}
      </div>
      {row(over < 1, 'Overhangs (red)', over < 1 ? 'none' : `${formatNum(over / 100, 1)} cm² · ${formatNum((over / Math.max(total, 1)) * 100, 0)}%`)}
      <div className="pc-bed">
        Support angle
        <input type="number" value={angle} min={10} max={89} aria-label="Support angle" onChange={(e) => usePrintCheck.setState({ angle: Math.min(89, Math.max(10, Number(e.target.value) || 45)) })} />°
      </div>
      {below && row(false, 'Below the plate', 'press D to drop it')}
      {floating && row(false, 'Not on the plate', `${formatNum(box.min.z, 2)} mm up · press D`)}
      {!below && !floating && row(true, 'Sits on the plate', 'yes')}
      {volume && !volume.meshOnly && row(null, 'Filament (estimate)', `~${formatNum(volume.grams, 0)} g · ~${minutes >= 60 ? `${formatNum(minutes / 60, 1)} h` : `${formatNum(minutes, 0)} min`}`)}
      <p className="pc-note">Estimates assume two walls and 20% infill. Your slicer has the final word.</p>
    </div>
  );
}
