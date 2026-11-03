// The right-hand panel while a sketch is open: choose a plane, pick a drawing tool, apply
// constraints to the selection, and see whether the sketch is fully defined.
import { useEffect, useMemo } from 'react';
import {
  IconAngle,
  IconArrowsHorizontal,
  IconArrowsVertical,
  IconCheck,
  IconCircle,
  IconCircleDot,
  IconEqual,
  IconLine,
  IconLock,
  IconPencil,
  IconPoint,
  IconPointer,
  IconRectangle,
  IconRuler2,
  IconSlash,
  IconTrash,
  IconVectorBezierArc,
  IconX,
  type Icon,
} from '@tabler/icons-react';
import { SKETCH_PLANES } from '../model/defaults';
import type { SkConstraintType, SketchFeature, SketchPlaneName } from '../model/types';
import { sketchProfiles } from '../sketch/profiles';
import { applyEdit, current, deleteItems, resetSketchUi, useSketchUi, type SketchTool } from '../sketch/sketchUi';
import { useStore, type Draft } from '../store/store';
import { applyConstraintToSelection, constraintOptions } from '../viewport/SketchEditor';
import { Field, NumInput } from './controls';

const TOOLS: { id: SketchTool; label: string; icon: Icon; key: string }[] = [
  { id: 'select', label: 'Select', icon: IconPointer, key: 'S' },
  { id: 'line', label: 'Line', icon: IconLine, key: 'L' },
  { id: 'rect', label: 'Rectangle', icon: IconRectangle, key: 'R' },
  { id: 'circle', label: 'Circle', icon: IconCircle, key: 'C' },
  { id: 'arc', label: 'Arc', icon: IconVectorBezierArc, key: 'A' },
  { id: 'point', label: 'Point', icon: IconPoint, key: 'P' },
  { id: 'dimension', label: 'Dimension', icon: IconRuler2, key: 'D' },
];

const CONSTRAINTS: { id: SkConstraintType; label: string; icon: Icon; key?: string }[] = [
  { id: 'coincident', label: 'Coincident', icon: IconCircleDot },
  { id: 'horizontal', label: 'Horizontal', icon: IconArrowsHorizontal, key: 'H' },
  { id: 'vertical', label: 'Vertical', icon: IconArrowsVertical, key: 'V' },
  { id: 'parallel', label: 'Parallel', icon: IconSlash },
  { id: 'perpendicular', label: 'Perpendicular', icon: IconAngle },
  { id: 'equal', label: 'Equal', icon: IconEqual },
  { id: 'tangent', label: 'Tangent', icon: IconVectorBezierArc },
  { id: 'midpoint', label: 'Midpoint', icon: IconPoint },
  { id: 'fix', label: 'Fix', icon: IconLock },
];

const TOOL_HINTS: Record<SketchTool, string> = {
  select: 'Click to select, Shift+click to add. Drag points, lines, and circles: constraints keep holding.',
  line: 'Click to start, click again for each corner. Click the first point to close, or press Esc to stop.',
  rect: 'Click one corner, then the opposite corner.',
  circle: 'Click the center, then a point on the circle.',
  arc: 'Click the start, the end, then a point the arc passes through.',
  point: 'Click to place a point (for construction and dimensions).',
  dimension: 'Click a line for its length, a circle for its radius, two points for a distance, or two lines for an angle.',
};

export function SketchPanel({ draft }: { draft: Draft }) {
  const f = draft.feature as SketchFeature;
  const choosing = draft.field === 'faces';
  const ui = useSketchUi();
  const patch = useStore((s) => s.patchDraft);
  const confirm = useStore((s) => s.confirmDraft);
  const cancel = useStore((s) => s.cancelDraft);
  const setField = useStore((s) => s.setDraftField);
  const opts = useMemo(() => constraintOptions(f, ui.sel), [f, ui.sel]);
  const profiles = useMemo(() => sketchProfiles(f), [f]);

  // A fresh sketch starts with the line tool and an empty undo history.
  useEffect(() => {
    resetSketchUi();
  }, [f.id]);

  const pickPlane = (plane: Exclude<SketchPlaneName, 'face'>) => {
    patch((x) => (x.type === 'sketch' ? { ...x, plane, frame: SKETCH_PLANES[plane].frame, face: undefined } : x));
    setField(null);
  };

  const status = !ui.ok
    ? { cls: 'bad', text: 'Some constraints conflict. Undo (Ctrl+Z) or delete one.' }
    : ui.dof === 0
      ? { cls: 'good', text: 'Fully defined' }
      : { cls: 'info', text: `${ui.dof} degree${ui.dof === 1 ? '' : 's'} of freedom left (blue geometry can still move)` };

  return (
    <div className="props sketch-panel">
      <div className="props-head">
        <IconPencil size={16} />
        <div className="props-title">{f.name}</div>
        <button className="icon-btn" title="Cancel (discard changes)" aria-label="Cancel sketch" onClick={cancel}>
          <IconX size={16} />
        </button>
      </div>
      <div className="props-sub">{choosing ? 'Choose where to sketch' : f.plane === 'face' ? 'On a face' : SKETCH_PLANES[f.plane].label}</div>
      <div className="props-body">
        {choosing ? (
          <>
            <div className="sk-planes">
              {(Object.keys(SKETCH_PLANES) as (keyof typeof SKETCH_PLANES)[]).map((p) => (
                <button key={p} className="sk-plane" onClick={() => pickPlane(p)}>
                  <span className={`sk-plane-icon ${p}`} />
                  {SKETCH_PLANES[p].label}
                </button>
              ))}
            </div>
            <p className="hint">Or click a flat face of a part in the view to sketch on it.</p>
          </>
        ) : (
          <>
            <div className="section-label">Draw</div>
            <div className="sk-tools">
              {TOOLS.map((t) => (
                <button key={t.id} className={`sk-tool${ui.tool === t.id ? ' on' : ''}`} title={`${t.label} (${t.key})`} onClick={() => useSketchUi.setState({ tool: t.id })}>
                  <t.icon size={17} stroke={1.6} />
                  <span>{t.label}</span>
                </button>
              ))}
            </div>
            <label className="sk-check">
              <input type="checkbox" checked={ui.construction} onChange={(e) => useSketchUi.setState({ construction: e.target.checked })} />
              Construction geometry (X)
            </label>
            <p className="hint">{TOOL_HINTS[ui.tool]}</p>

            <div className="section-label">Constrain the selection</div>
            <div className="sk-cons">
              {CONSTRAINTS.map((c) => (
                <button
                  key={c.id}
                  className="sk-con"
                  disabled={!opts.has(c.id)}
                  title={`${c.label}${c.key ? ` (${c.key})` : ''}`}
                  onClick={() => {
                    if (applyConstraintToSelection(c.id)) useSketchUi.setState({ sel: [] });
                  }}
                >
                  <c.icon size={15} stroke={1.7} />
                  <span>{c.label}</span>
                </button>
              ))}
            </div>
            {ui.sel.length > 0 && (
              <div className="sk-selbar">
                <span>{ui.sel.length} selected</span>
                <button
                  className="btn sm"
                  onClick={() => {
                    const g = current();
                    const ents = new Set(ui.sel);
                    applyEdit({ ...g, entities: g.entities.map((e) => (ents.has(e.id) ? { ...e, construction: !e.construction } : e)) });
                  }}
                >
                  Construction
                </button>
                <button
                  className="btn sm danger"
                  onClick={() => {
                    applyEdit(deleteItems(current(), ui.sel));
                    useSketchUi.setState({ sel: [] });
                  }}
                >
                  <IconTrash size={13} /> Delete
                </button>
              </div>
            )}

            <div className={`sk-status ${status.cls}`}>{status.text}</div>
            <div className="sk-profiles">
              {profiles.regions.length
                ? `${profiles.regions.length} closed profile${profiles.regions.length === 1 ? '' : 's'} (shaded) ready to extrude`
                : profiles.chains.length
                  ? 'Open outline: close it to extrude, or use it as a sweep path'
                  : 'Draw a closed outline to extrude it'}
            </div>

            {f.plane !== 'face' && (
              <Field label="Plane offset">
                <NumInput value={f.offset} onChange={(offset) => patch((x) => (x.type === 'sketch' ? { ...x, offset } : x))} />
              </Field>
            )}
            <p className="hint">Left-click draws · right-drag orbits · middle-drag pans · Ctrl+Z undoes inside the sketch.</p>
          </>
        )}
      </div>
      <div className="props-foot">
        <span className="foot-status" />
        <button className="btn" onClick={cancel}>
          Cancel
        </button>
        <button className="btn primary" onClick={confirm} disabled={choosing} title="Finish the sketch (Enter)">
          <IconCheck size={15} /> Finish
        </button>
      </div>
    </div>
  );
}
