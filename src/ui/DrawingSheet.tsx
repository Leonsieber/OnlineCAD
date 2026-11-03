// 2D technical drawing: front, top, and right views with hidden lines, an isometric view, overall
// dimensions, and a title block on an A4 sheet. Exports as SVG, or prints (and so saves as PDF).
import { useEffect, useMemo, useRef, useState } from 'react';
import { IconDownload, IconLoader2, IconPrinter } from '@tabler/icons-react';
import { kernel } from '../kernel/client';
import type { DrawingView } from '../kernel/protocol';
import { formatNum } from '../model/expr';
import { useStore } from '../store/store';
import { download, safeFileName } from '../io/files';
import { Segmented } from './controls';

const SHEET_W = 297;
const SHEET_H = 210;
const MARGIN = 10;
const TITLE_H = 24;
const GAP = 22;
const SCALES = [10, 5, 2, 1, 0.5, 0.2, 0.1, 0.05, 0.02, 0.01];

type Angle = 'first' | 'third';

function scaleLabel(s: number) {
  return s >= 1 ? `${s}:1` : `1:${Math.round(1 / s)}`;
}

/** Places a view: its model box (y up) maps to sheet coordinates (y down) at `scale`, centered at (cx, cy). */
function placed(v: DrawingView, scale: number, cx: number, cy: number) {
  const [x0, y0, x1, y1] = v.box;
  const mx = (x0 + x1) / 2;
  const my = (y0 + y1) / 2;
  // Paths are already in SVG orientation (y negated), so the view's middle sits at (mx, -my).
  return `translate(${cx} ${cy}) scale(${scale}) translate(${-mx} ${my})`;
}

function Dim({ x1, y1, x2, y2, label, offset, vertical }: { x1: number; y1: number; x2: number; y2: number; label: string; offset: number; vertical?: boolean }) {
  // A dimension line offset from the measured edge, with extension lines and arrows.
  const ax = vertical ? x1 + offset : x1;
  const bx = vertical ? x2 + offset : x2;
  const ay = vertical ? y1 : y1 + offset;
  const by = vertical ? y2 : y2 + offset;
  const tx = (ax + bx) / 2;
  const ty = (ay + by) / 2;
  return (
    <g className="dim" stroke="#222" strokeWidth={0.18} fill="#222">
      <line x1={x1} y1={y1} x2={ax} y2={ay} />
      <line x1={x2} y1={y2} x2={bx} y2={by} />
      <line x1={ax} y1={ay} x2={bx} y2={by} markerStart="url(#arrow)" markerEnd="url(#arrow)" />
      <text x={tx} y={ty} dy={vertical ? 0 : -1.2} fontSize={3} textAnchor="middle" stroke="none" transform={vertical ? `rotate(-90 ${tx} ${ty}) translate(0 -1.2)` : undefined}>
        {label}
      </text>
    </g>
  );
}

export function DrawingSheet({ onClose }: { onClose: () => void }) {
  const doc = useStore((s) => s.doc);
  const parts = useStore((s) => s.parts);
  const sel = useStore((s) => s.sel);
  const [views, setViews] = useState<DrawingView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [angle, setAngle] = useState<Angle>('first');
  const svgRef = useRef<SVGSVGElement>(null);

  const ids = useMemo(() => {
    const chosen = [...new Set(sel.map((x) => x.part))];
    const pool = chosen.length ? chosen : parts.filter((p) => !doc.parts[p.id]?.hidden).map((p) => p.id);
    return pool.filter((id) => parts.find((p) => p.id === id)?.kind === 'brep');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!ids.length) {
      setError('There are no solid parts to draw. Drawings need solids (meshes have no exact edges).');
      return;
    }
    kernel
      .drawingViews(ids)
      .then(setViews)
      .catch((e: Error) => setError(e.message));
  }, [ids]);

  const layout = useMemo(() => {
    if (!views) return null;
    const v = Object.fromEntries(views.map((x) => [x.name, x])) as Record<DrawingView['name'], DrawingView>;
    const w = (x: DrawingView) => x.box[2] - x.box[0];
    const h = (x: DrawingView) => x.box[3] - x.box[1];
    const W = w(v.front);
    const H = h(v.front);
    const D = h(v.top);
    const areaW = SHEET_W - 2 * MARGIN;
    const areaH = SHEET_H - 2 * MARGIN - TITLE_H;
    // The three orthographic views take the left two thirds; the iso view gets the top right.
    const fit = Math.min((areaW * 0.68 - 3 * GAP) / Math.max(W + D, 1), (areaH - 3 * GAP) / Math.max(H + D, 1));
    const scale = SCALES.find((s) => s <= fit) ?? SCALES[SCALES.length - 1];
    const left = MARGIN + GAP;
    const top = MARGIN + GAP * 0.8;
    // First angle (ISO): top view below the front view, right view to the left. Third angle: the opposite.
    const frontX = angle === 'first' ? left + D * scale + GAP + (W * scale) / 2 : left + (W * scale) / 2;
    const frontY = angle === 'first' ? top + (H * scale) / 2 : top + D * scale + GAP + (H * scale) / 2;
    const topY = angle === 'first' ? frontY + (H * scale) / 2 + GAP + (D * scale) / 2 : top + (D * scale) / 2;
    const rightX = angle === 'first' ? left + (D * scale) / 2 : frontX + (W * scale) / 2 + GAP + (D * scale) / 2;
    const isoW = w(v.iso);
    const isoH = h(v.iso);
    const isoBoxW = SHEET_W - MARGIN - (angle === 'first' ? frontX + (W * scale) / 2 : rightX + (D * scale) / 2) - GAP;
    const isoScale = Math.min(isoBoxW / Math.max(isoW, 1), (areaH * 0.6) / Math.max(isoH, 1));
    const isoX = SHEET_W - MARGIN - GAP * 0.5 - (isoW * isoScale) / 2;
    const isoY = MARGIN + GAP * 0.5 + (isoH * isoScale) / 2;
    return { v, W, H, D, scale, frontX, frontY, topY, rightX, isoScale, isoX, isoY };
  }, [views, angle]);

  const exportSvg = () => {
    const svg = svgRef.current;
    if (!svg) return;
    const text = `<?xml version="1.0" encoding="UTF-8"?>\n${svg.outerHTML}`;
    download(new Blob([text], { type: 'image/svg+xml' }), `${safeFileName(doc.name)} drawing.svg`);
  };

  const print = () => {
    const svg = svgRef.current;
    if (!svg) return;
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(
      `<!doctype html><title>${doc.name} drawing</title><style>@page{size:A4 landscape;margin:0}html,body{margin:0}svg{width:297mm;height:210mm;display:block}</style>${svg.outerHTML}<script>onload=()=>{print()}</script>`,
    );
    w.document.close();
  };

  const today = new Date().toLocaleDateString();
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal drawing-modal" role="dialog" aria-modal="true" aria-label="2D drawing">
        <div className="modal-head">
          <h2>2D drawing</h2>
          <div className="drawing-actions">
            <Segmented
              value={angle}
              options={[
                { value: 'first', label: 'First angle (ISO)' },
                { value: 'third', label: 'Third angle (US)' },
              ]}
              onChange={setAngle}
            />
            <button className="btn" onClick={exportSvg} disabled={!layout}>
              <IconDownload size={15} /> SVG
            </button>
            <button className="btn primary" onClick={print} disabled={!layout}>
              <IconPrinter size={15} /> Print / PDF
            </button>
            <button className="btn" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
        <div className="drawing-body">
          {error && <p className="banner error">{error}</p>}
          {!error && !layout && (
            <p className="muted">
              <IconLoader2 size={14} className="spin" /> Projecting views with hidden lines…
            </p>
          )}
          {layout && (
            <svg ref={svgRef} className="drawing-sheet" xmlns="http://www.w3.org/2000/svg" viewBox={`0 0 ${SHEET_W} ${SHEET_H}`} width={`${SHEET_W}mm`} height={`${SHEET_H}mm`}>
              <defs>
                <marker id="arrow" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse">
                  <path d="M 0 2 L 10 5 L 0 8 z" fill="#222" />
                </marker>
              </defs>
              <rect width={SHEET_W} height={SHEET_H} fill="#fff" />
              <rect x={MARGIN / 2} y={MARGIN / 2} width={SHEET_W - MARGIN} height={SHEET_H - MARGIN} fill="none" stroke="#222" strokeWidth={0.5} />
              {(
                [
                  ['front', layout.frontX, layout.frontY, layout.scale],
                  ['top', layout.frontX, layout.topY, layout.scale],
                  ['right', layout.rightX, layout.frontY, layout.scale],
                  ['iso', layout.isoX, layout.isoY, layout.isoScale],
                ] as const
              ).map(([name, cx, cy, s]) => (
                <g key={name} transform={placed(layout.v[name], s, cx, cy)}>
                  {name !== 'iso' &&
                    layout.v[name].hidden.map((d, i) => (
                      <path key={`h${i}`} d={d} fill="none" stroke="#666" strokeWidth={0.18 / s} strokeDasharray={`${1.2 / s} ${0.8 / s}`} />
                    ))}
                  {layout.v[name].visible.map((d, i) => (
                    <path key={`v${i}`} d={d} fill="none" stroke="#111" strokeWidth={0.35 / s} strokeLinejoin="round" strokeLinecap="round" />
                  ))}
                </g>
              ))}
              {/* Overall dimensions */}
              <Dim
                x1={layout.frontX - (layout.W * layout.scale) / 2}
                y1={layout.frontY + (layout.H * layout.scale) / 2}
                x2={layout.frontX + (layout.W * layout.scale) / 2}
                y2={layout.frontY + (layout.H * layout.scale) / 2}
                offset={angle === 'first' ? 7 : 7}
                label={formatNum(layout.W, 2)}
              />
              <Dim
                x1={layout.frontX + (layout.W * layout.scale) / 2}
                y1={layout.frontY + (layout.H * layout.scale) / 2}
                x2={layout.frontX + (layout.W * layout.scale) / 2}
                y2={layout.frontY - (layout.H * layout.scale) / 2}
                offset={7}
                vertical
                label={formatNum(layout.H, 2)}
              />
              <Dim
                x1={layout.rightX - (layout.D * layout.scale) / 2}
                y1={layout.frontY - (layout.H * layout.scale) / 2}
                x2={layout.rightX + (layout.D * layout.scale) / 2}
                y2={layout.frontY - (layout.H * layout.scale) / 2}
                offset={-6}
                label={formatNum(layout.D, 2)}
              />
              {/* Title block */}
              <g transform={`translate(${SHEET_W - MARGIN / 2 - 150} ${SHEET_H - MARGIN / 2 - TITLE_H})`} fontFamily="Arial, Helvetica, sans-serif" fill="#111">
                <rect width={150} height={TITLE_H} fill="#fff" stroke="#222" strokeWidth={0.5} />
                <line x1={0} y1={12} x2={150} y2={12} stroke="#222" strokeWidth={0.3} />
                <line x1={90} y1={0} x2={90} y2={TITLE_H} stroke="#222" strokeWidth={0.3} />
                <line x1={120} y1={12} x2={120} y2={TITLE_H} stroke="#222" strokeWidth={0.3} />
                <text x={3} y={4.5} fontSize={2.4} fill="#666">
                  Title
                </text>
                <text x={3} y={10} fontSize={5} fontWeight="bold">
                  {doc.name}
                </text>
                <text x={93} y={4.5} fontSize={2.4} fill="#666">
                  Drawn with
                </text>
                <text x={93} y={9.5} fontSize={3.6}>
                  OnlineCAD
                </text>
                <text x={3} y={16.5} fontSize={2.4} fill="#666">
                  Date · Units · Projection
                </text>
                <text x={3} y={21.5} fontSize={3.4}>
                  {today} · mm · {angle === 'first' ? 'First angle (ISO)' : 'Third angle'}
                </text>
                <text x={93} y={16.5} fontSize={2.4} fill="#666">
                  Scale
                </text>
                <text x={93} y={21.5} fontSize={3.8}>
                  {scaleLabel(layout.scale)}
                </text>
                <text x={123} y={16.5} fontSize={2.4} fill="#666">
                  Sheet
                </text>
                <text x={123} y={21.5} fontSize={3.8}>
                  A4 · 1/1
                </text>
              </g>
            </svg>
          )}
        </div>
      </div>
    </div>
  );
}
