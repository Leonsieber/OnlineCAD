import { useEffect, useState, type ReactNode } from 'react';
import {
  IconAlertTriangle,
  IconBorderRadius,
  IconAngle,
  IconBoxModel,
  IconCopy,
  IconEye,
  IconEyeOff,
  IconInfoCircle,
  IconLayersIntersect,
  IconLayersSubtract,
  IconLayersUnion,
  IconLoader2,
  IconTrash,
  IconX,
  IconCheck,
  IconCircleDashed,
  IconStack2,
  IconStackPop,
} from '@tabler/icons-react';
import { kernel } from '../kernel/client';
import { EDGE_INFO_STRIDE, FACE_INFO_STRIDE, type MeasureResult } from '../kernel/protocol';
import { BOOLEAN_LABELS, PART_COLORS, PRIMITIVES, featureLabel } from '../model/defaults';
import { evalNum, formatNum } from '../model/expr';
import type { EdgeRef, FaceRef, Feature, NumExpr } from '../model/types';
import { meshOf, partColor, partName, useStore, type Draft } from '../store/store';
import {
  deleteSelection,
  duplicateSelection,
  exportAs,
  groupSelection,
  startBoolean,
  startEdgeFeature,
  startShell,
  ungroupSelection,
} from '../app/actions';
import { Field, NumInput, RefField, Segmented, Switch, Vec3Input, type Chip } from './controls';
import { featureIcon } from './icons';

export function Properties() {
  const draft = useStore((s) => s.draft);
  const sel = useStore((s) => s.sel);
  if (draft) return <FeatureDialog draft={draft} />;
  if (sel.length) return <SelectionInfo />;
  return <DocumentInfo />;
}

function Panel({ title, icon, children, actions }: { title: ReactNode; icon?: ReactNode; children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="props">
      <div className="props-head">
        {icon}
        <div className="props-title">{title}</div>
        {actions}
      </div>
      <div className="props-body">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------- feature dialogs

function FeatureDialog({ draft }: { draft: Draft }) {
  const f = draft.feature;
  const status = useStore((s) => s.statuses[f.id]);
  const busy = useStore((s) => s.busy);
  const patch = useStore((s) => s.patchDraft);
  const confirm = useStore((s) => s.confirmDraft);
  const cancel = useStore((s) => s.cancelDraft);
  const Icon = featureIcon(f);
  const set = (p: Partial<Feature>) => patch((x) => ({ ...x, ...p }) as Feature);

  return (
    <div className="props dialog">
      <div className="props-head">
        <Icon size={18} className="accent-icon" />
        <input className="title-input" value={f.name} onChange={(e) => set({ name: e.target.value })} aria-label="Feature name" />
        <button className="icon-btn" title="Cancel (Esc)" aria-label="Cancel" onClick={cancel}>
          <IconX size={16} />
        </button>
      </div>
      <div className="props-sub">{draft.isNew ? `New ${featureLabel(f).toLowerCase()}` : `Editing ${featureLabel(f).toLowerCase()}`}</div>
      <div className="props-body">
        <FeatureFields draft={draft} set={set} />
        {status?.warning && (
          <div className="banner caution">
            <IconAlertTriangle size={16} />
            <span>{status.message}</span>
          </div>
        )}
        {status?.state === 'error' && (
          <div className={`banner ${status.incomplete ? 'info' : 'error'}`}>
            {status.incomplete ? <IconInfoCircle size={16} /> : <IconAlertTriangle size={16} />}
            <span>{status.message}</span>
          </div>
        )}
      </div>
      <div className="props-foot">
        <span className="foot-status">{busy ? <><IconLoader2 size={14} className="spin" /> Updating preview</> : status?.ms !== undefined ? `Built in ${Math.max(1, Math.round(status.ms))} ms` : ''}</span>
        <button className="btn" onClick={cancel}>
          Cancel
        </button>
        <button className="btn primary" onClick={confirm} title="Apply (Enter)">
          <IconCheck size={15} /> OK
        </button>
      </div>
    </div>
  );
}

function usePartChips(ids: string[]): Chip[] {
  const parts = useStore((s) => s.parts);
  const doc = useStore((s) => s.doc);
  return ids.map((id) => ({ key: id, label: parts.some((p) => p.id === id) ? partName(id, { doc, parts }) : 'Missing part', color: partColor(id, { doc, parts }) }));
}

function PartsRef({ draft, field, label, ids, onChange }: { draft: Draft; field: string; label: string; ids: string[]; onChange: (ids: string[]) => void }) {
  const setField = useStore((s) => s.setDraftField);
  const chips = usePartChips(ids);
  return (
    <RefField
      label={label}
      chips={chips}
      active={draft.field === field}
      placeholder="Click parts in the view or the parts list"
      onActivate={() => setField(field)}
      onRemove={(k) => onChange(ids.filter((x) => x !== k))}
      onClear={() => onChange([])}
    />
  );
}

function TopoRef<T extends EdgeRef | FaceRef>({ draft, field, label, refs, onChange, noun }: { draft: Draft; field: string; label: string; refs: T[]; onChange: (r: T[]) => void; noun: string }) {
  const setField = useStore((s) => s.setDraftField);
  const doc = useStore((s) => s.doc);
  const parts = useStore((s) => s.parts);
  const chips = refs.map((r, i) => ({ key: String(i), label: `${noun} ${i + 1} · ${partName(r.part, { doc, parts })}`, color: partColor(r.part, { doc, parts }) }));
  return (
    <RefField
      label={label}
      chips={chips}
      active={draft.field === field}
      placeholder={`Click ${noun.toLowerCase()}s in the view`}
      onActivate={() => setField(field)}
      onRemove={(k) => onChange(refs.filter((_, i) => String(i) !== k))}
      onClear={() => onChange([])}
    />
  );
}

const AXIS_OPTS = [
  { value: 'X' as const, label: 'X' },
  { value: 'Y' as const, label: 'Y' },
  { value: 'Z' as const, label: 'Z' },
];

function FeatureFields({ draft, set }: { draft: Draft; set: (p: Partial<Feature>) => void }) {
  const f = draft.feature;
  switch (f.type) {
    case 'primitive': {
      const def = PRIMITIVES[f.kind];
      return (
        <>
          {def.params.map((p, i) => (
            <Field key={p.key} label={p.label}>
              <NumInput
                autoFocus={i === 0 && draft.isNew}
                value={f.params[p.key] ?? p.def}
                unit={p.unit}
                min={p.integer ? p.min : undefined}
                integer={p.integer}
                onChange={(v) => set({ params: { ...f.params, [p.key]: v } } as Partial<Feature>)}
              />
            </Field>
          ))}
          <div className="section-label">Placement</div>
          <Field label="Position">
            <Vec3Input value={f.placement.position} onChange={(position) => set({ placement: { ...f.placement, position } } as Partial<Feature>)} />
          </Field>
          <Field label="Rotation">
            <Vec3Input value={f.placement.rotation} unit="°" step={15} onChange={(rotation) => set({ placement: { ...f.placement, rotation } } as Partial<Feature>)} />
          </Field>
          {f.placement.scale && (
            <Field label="Stretch">
              <Vec3Input value={f.placement.scale} unit="×" step={0.1} onChange={(scale) => set({ placement: { ...f.placement, scale } } as Partial<Feature>)} />
            </Field>
          )}
          <p className="hint">Drag the white squares in the view to resize, the cone to lift it. Fields take formulas like 20*2 or 1 in.</p>
        </>
      );
    }
    case 'boolean':
      return (
        <>
          <Segmented
            value={f.op}
            options={[
              { value: 'union', label: BOOLEAN_LABELS.union, icon: <IconLayersUnion size={14} /> },
              { value: 'subtract', label: BOOLEAN_LABELS.subtract, icon: <IconLayersSubtract size={14} /> },
              { value: 'intersect', label: BOOLEAN_LABELS.intersect, icon: <IconLayersIntersect size={14} /> },
            ]}
            onChange={(op) => set({ op } as Partial<Feature>)}
          />
          <PartsRef draft={draft} field="targets" label={f.op === 'subtract' ? 'Cut from' : 'Parts'} ids={f.targets} onChange={(targets) => set({ targets } as Partial<Feature>)} />
          {f.op === 'subtract' && <PartsRef draft={draft} field="tools" label="Subtract these" ids={f.tools} onChange={(tools) => set({ tools } as Partial<Feature>)} />}
          <Switch checked={f.keepTools} onChange={(keepTools) => set({ keepTools } as Partial<Feature>)} label="Keep tool parts" />
        </>
      );
    case 'fillet':
    case 'chamfer':
      return (
        <>
          <TopoRef draft={draft} field="edges" label="Edges" noun="Edge" refs={f.edges} onChange={(edges) => set({ edges } as Partial<Feature>)} />
          {f.type === 'fillet' ? (
            <Field label="Radius">
              <NumInput autoFocus value={f.radius} step={0.5} onChange={(radius) => set({ radius } as Partial<Feature>)} />
            </Field>
          ) : (
            <Field label="Distance">
              <NumInput autoFocus value={f.distance} step={0.5} onChange={(distance) => set({ distance } as Partial<Feature>)} />
            </Field>
          )}
          <p className="hint">Hover an edge to highlight it, click to add it. The preview updates as you go.</p>
        </>
      );
    case 'shell':
      return (
        <>
          <TopoRef draft={draft} field="faces" label="Faces to remove" noun="Face" refs={f.faces} onChange={(faces) => set({ faces } as Partial<Feature>)} />
          <Field label="Wall thickness">
            <NumInput value={f.thickness} step={0.5} onChange={(thickness) => set({ thickness } as Partial<Feature>)} />
          </Field>
          <Segmented
            value={f.outward ? 'out' : 'in'}
            options={[
              { value: 'in', label: 'Inward' },
              { value: 'out', label: 'Outward' },
            ]}
            onChange={(v) => set({ outward: v === 'out' } as Partial<Feature>)}
          />
        </>
      );
    case 'transform':
      return (
        <>
          <PartsRef draft={draft} field="parts" label="Parts" ids={f.parts} onChange={(parts) => set({ parts } as Partial<Feature>)} />
          <Field label="Move">
            <Vec3Input value={f.translate} onChange={(translate) => set({ translate } as Partial<Feature>)} />
          </Field>
          <Field label="Rotate">
            <Vec3Input value={f.rotate} unit="°" step={15} onChange={(rotate) => set({ rotate } as Partial<Feature>)} />
          </Field>
          <Field label="Pivot">
            <Vec3Input
              value={f.pivot}
              onChange={(v) => {
                try {
                  set({ pivot: v.map((x) => evalNum(x)) as [number, number, number] } as Partial<Feature>);
                } catch {
                  // ignore invalid pivot input
                }
              }}
            />
          </Field>
          <Field label="Scale">
            <NumInput value={f.scale} unit="×" step={0.1} onChange={(scale) => set({ scale } as Partial<Feature>)} />
          </Field>
          <Switch checked={f.copy} onChange={(copy) => set({ copy } as Partial<Feature>)} label="Keep the original (make a copy)" />
        </>
      );
    case 'mirror':
      return (
        <>
          <PartsRef draft={draft} field="parts" label="Parts" ids={f.parts} onChange={(parts) => set({ parts } as Partial<Feature>)} />
          <Field label="Mirror across">
            <Segmented
              value={f.plane}
              options={[
                { value: 'YZ', label: 'X' },
                { value: 'XZ', label: 'Y' },
                { value: 'XY', label: 'Z' },
              ]}
              onChange={(plane) => set({ plane } as Partial<Feature>)}
            />
          </Field>
          <Field label="Plane offset">
            <NumInput value={f.offset} onChange={(offset) => set({ offset } as Partial<Feature>)} />
          </Field>
          <Switch checked={f.merge} onChange={(merge) => set({ merge } as Partial<Feature>)} label="Merge with the original" />
        </>
      );
    case 'linearPattern':
    case 'circularPattern':
      return (
        <>
          <PartsRef draft={draft} field="parts" label="Parts" ids={f.parts} onChange={(parts) => set({ parts } as Partial<Feature>)} />
          <Field label={f.type === 'linearPattern' ? 'Direction' : 'Axis'}>
            <Segmented value={f.axis} options={AXIS_OPTS} onChange={(axis) => set({ axis } as Partial<Feature>)} />
          </Field>
          <Field label="Count">
            <NumInput value={f.count} unit="" integer min={2} onChange={(count) => set({ count } as Partial<Feature>)} />
          </Field>
          {f.type === 'linearPattern' ? (
            <Field label="Spacing">
              <NumInput value={f.spacing} onChange={(spacing) => set({ spacing } as Partial<Feature>)} />
            </Field>
          ) : (
            <>
              <Field label="Total angle">
                <NumInput value={f.angle} unit="°" step={15} onChange={(angle) => set({ angle } as Partial<Feature>)} />
              </Field>
              <Field label="Center">
                <Vec3Input value={f.center} onChange={(center) => set({ center } as Partial<Feature>)} />
              </Field>
            </>
          )}
          <Switch checked={f.merge} onChange={(merge) => set({ merge } as Partial<Feature>)} label="Merge copies into one part" />
        </>
      );
    case 'import':
      return (
        <>
          <Field label="File">
            <span className="readonly">{f.fileName}</span>
          </Field>
          <Field label="Scale">
            <NumInput value={f.scale} unit="×" step={0.1} onChange={(scale) => set({ scale } as Partial<Feature>)} />
          </Field>
          <p className="hint">
            {f.format === 'step'
              ? 'STEP files import as exact solids, so you can fillet, cut, and combine them.'
              : 'Mesh files import as triangles. You can move, pattern, and export them; solid tools such as fillet need STEP files.'}
          </p>
        </>
      );
    case 'deleteParts':
      return <PartsRef draft={draft} field="parts" label="Parts to delete" ids={f.parts} onChange={(parts) => set({ parts } as Partial<Feature>)} />;
  }
}

// ---------------------------------------------------------------- selection info

function fmt(v: number, unit: string, digits = 2) {
  return `${formatNum(v, digits)} ${unit}`;
}

function SelectionInfo() {
  const sel = useStore((s) => s.sel);
  const parts = useStore((s) => s.parts);
  const ids = [...new Set(sel.map((x) => x.part))];
  const first = sel[0];
  if (sel.length === 1 && first.kind === 'part') return <PartInfo id={first.part} />;
  if (sel.length === 1 && first.kind !== 'part') return <TopoInfo kind={first.kind} part={first.part} index={first.index} />;
  const kinds = new Set(sel.map((x) => x.kind));
  return (
    <Panel title={`${sel.length} selected`} icon={<IconInfoCircle size={18} className="accent-icon" />}>
      <p className="muted">
        {ids.length} part{ids.length > 1 ? 's' : ''} · {parts.length} in the model
      </p>
      {kinds.has('part') && ids.length >= 2 && (
        <div className="action-grid">
          <button className="btn primary" onClick={groupSelection} title="Ctrl+G">
            <IconStack2 size={15} /> Group
          </button>
          <button className="btn" onClick={() => startBoolean('union')}>
            <IconLayersUnion size={15} /> Union
          </button>
          <button className="btn" onClick={() => startBoolean('subtract')}>
            <IconLayersSubtract size={15} /> Subtract
          </button>
          <button className="btn" onClick={() => startBoolean('intersect')}>
            <IconLayersIntersect size={15} /> Intersect
          </button>
        </div>
      )}
      {kinds.has('edge') && (
        <div className="action-grid">
          <button className="btn" onClick={() => startEdgeFeature('fillet')}>
            <IconBorderRadius size={15} /> Fillet edges
          </button>
          <button className="btn" onClick={() => startEdgeFeature('chamfer')}>
            <IconAngle size={15} /> Chamfer edges
          </button>
        </div>
      )}
      {kinds.has('face') && (
        <div className="action-grid">
          <button className="btn" onClick={startShell}>
            <IconBoxModel size={15} /> Shell from faces
          </button>
        </div>
      )}
    </Panel>
  );
}

function useMeasure(id: string, key: string | undefined) {
  const [m, setM] = useState<MeasureResult | null>(null);
  useEffect(() => {
    let alive = true;
    setM(null);
    if (key) kernel.measure(id).then((r) => alive && setM(r)).catch(() => alive && setM(null));
    return () => {
      alive = false;
    };
  }, [id, key]);
  return m;
}

function PartInfo({ id }: { id: string }) {
  const doc = useStore((s) => s.doc);
  const parts = useStore((s) => s.parts);
  const setProps = useStore((s) => s.setPartProps);
  const result = parts.find((p) => p.id === id);
  const m = useMeasure(id, result?.key);
  const name = partName(id, { doc, parts });
  const color = partColor(id, { doc, parts });
  const hidden = !!doc.parts[id]?.hidden;
  const [nameText, setNameText] = useState(name);
  useEffect(() => setNameText(name), [name]);
  if (!result) return null;
  const size = [0, 1, 2].map((i) => result.bbox[1][i] - result.bbox[0][i]);
  return (
    <Panel
      title={
        <input
          className="title-input"
          value={nameText}
          aria-label="Part name"
          onChange={(e) => setNameText(e.target.value)}
          onBlur={() => nameText.trim() && nameText !== name && setProps(id, { name: nameText.trim() })}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
      }
      icon={<span className="swatch-lg" style={{ background: color }} />}
      actions={
        <button className="icon-btn" title={hidden ? 'Show' : 'Hide'} onClick={() => setProps(id, { hidden: !hidden })}>
          {hidden ? <IconEyeOff size={16} /> : <IconEye size={16} />}
        </button>
      }
    >
      <Segmented
        value={doc.parts[id]?.hole ? 'hole' : 'solid'}
        options={[
          { value: 'solid', label: 'Solid', icon: <span className="swatch-sm" style={{ background: color }} /> },
          { value: 'hole', label: 'Hole', icon: <IconCircleDashed size={14} /> },
        ]}
        onChange={(v) => setProps(id, { hole: v === 'hole' })}
      />
      {doc.parts[id]?.hole && <p className="hint">Holes are cut out of the solids you group them with (Ctrl+G).</p>}
      <div className="section-label">Color</div>
      <div className="swatches">
        {PART_COLORS.map((c) => (
          <button key={c} className={`swatch${c === color ? ' on' : ''}`} style={{ background: c }} aria-label={`Color ${c}`} onClick={() => setProps(id, { color: c })} />
        ))}
        <label className="swatch custom" title="Custom color">
          <input type="color" value={color} onChange={(e) => setProps(id, { color: e.target.value })} />
        </label>
      </div>
      <div className="section-label">Size</div>
      <div className="stats">
        <Stat label="X" value={fmt(size[0], 'mm')} />
        <Stat label="Y" value={fmt(size[1], 'mm')} />
        <Stat label="Z" value={fmt(size[2], 'mm')} />
      </div>
      <div className="section-label">Mass properties</div>
      {result.kind === 'mesh' ? (
        <p className="muted">Imported mesh · volume needs a solid part</p>
      ) : m ? (
        <div className="stats">
          <Stat label="Volume" value={m.volume >= 1000 ? fmt(m.volume / 1000, 'cm³') : fmt(m.volume, 'mm³')} />
          <Stat label="Area" value={m.area >= 10000 ? fmt(m.area / 100, 'cm²') : fmt(m.area, 'mm²')} />
          <Stat label="Mass (PLA)" value={fmt((m.volume / 1000) * 1.24, 'g', 1)} />
        </div>
      ) : (
        <p className="muted">
          <IconLoader2 size={13} className="spin" /> Measuring
        </p>
      )}
      <div className="action-grid">
        <button className="btn" onClick={ungroupSelection} title="Ctrl+Shift+G: split a group back into its parts">
          <IconStackPop size={15} /> Ungroup
        </button>
        <button className="btn" onClick={duplicateSelection}>
          <IconCopy size={15} /> Duplicate
        </button>
        <button className="btn danger" onClick={deleteSelection}>
          <IconTrash size={15} /> Delete
        </button>
        <button className="btn" onClick={() => exportAs('stl', true)}>
          Export STL
        </button>
        <button className="btn" onClick={() => exportAs('step', true)}>
          Export STEP
        </button>
      </div>
    </Panel>
  );
}

function TopoInfo({ kind, part, index }: { kind: 'face' | 'edge'; part: string; index: number }) {
  const meshes = useStore((s) => s.meshes);
  void meshes;
  const data = meshOf(part);
  const info = data ? (kind === 'face' ? data.faceInfo.subarray(index * FACE_INFO_STRIDE, (index + 1) * FACE_INFO_STRIDE) : data.edgeInfo.subarray(index * EDGE_INFO_STRIDE, (index + 1) * EDGE_INFO_STRIDE)) : null;
  return (
    <Panel title={kind === 'face' ? 'Face' : 'Edge'} icon={<IconInfoCircle size={18} className="accent-icon" />}>
      <p className="muted">On {partName(part)}</p>
      {info && kind === 'face' && (
        <div className="stats">
          <Stat label="Area" value={fmt(info[6], 'mm²')} />
          <Stat label="Normal" value={`${formatNum(info[3], 2)}, ${formatNum(info[4], 2)}, ${formatNum(info[5], 2)}`} />
        </div>
      )}
      {info && kind === 'edge' && (
        <div className="stats">
          <Stat label="Length" value={fmt(info[9], 'mm')} />
        </div>
      )}
      <div className="action-grid">
        {kind === 'edge' ? (
          <>
            <button className="btn" onClick={() => startEdgeFeature('fillet')}>
              <IconBorderRadius size={15} /> Fillet
            </button>
            <button className="btn" onClick={() => startEdgeFeature('chamfer')}>
              <IconAngle size={15} /> Chamfer
            </button>
          </>
        ) : (
          <button className="btn" onClick={startShell}>
            <IconBoxModel size={15} /> Shell
          </button>
        )}
      </div>
      <p className="hint">Shift-click to select more.</p>
    </Panel>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
    </div>
  );
}

// ---------------------------------------------------------------- nothing selected

function DocumentInfo() {
  const doc = useStore((s) => s.doc);
  const parts = useStore((s) => s.parts);
  const statuses = useStore((s) => s.statuses);
  const errors = Object.values(statuses).filter((s) => s.state === 'error').length;
  return (
    <Panel title="Document" icon={<IconInfoCircle size={18} className="accent-icon" />}>
      <div className="stats">
        <Stat label="Parts" value={String(parts.length)} />
        <Stat label="Features" value={String(doc.features.length)} />
        <Stat label="Units" value="mm" />
      </div>
      {errors > 0 && (
        <div className="banner error">
          <IconAlertTriangle size={16} />
          <span>
            {errors} feature{errors > 1 ? 's' : ''} failed to build. They're marked in red in the history.
          </span>
        </div>
      )}
      <div className="section-label">Controls</div>
      <ul className="tips">
        <li><kbd>Left drag</kbd> orbit · <kbd>Right drag</kbd> pan · <kbd>Scroll</kbd> zoom</li>
        <li><kbd>Click</kbd> select · <kbd>Shift</kbd>+click add to selection</li>
        <li><kbd>W</kbd> move · <kbd>E</kbd> rotate · <kbd>F</kbd> fit view</li>
        <li><kbd>Ctrl</kbd>+<kbd>Z</kbd> undo · <kbd>Ctrl</kbd>+<kbd>D</kbd> duplicate · <kbd>Del</kbd> delete</li>
      </ul>
      <p className="hint">Pick Part, Face, or Edge at the bottom left of the view to choose what clicks select.</p>
    </Panel>
  );
}

export function numOrExpr(v: NumExpr): string {
  return typeof v === 'number' ? formatNum(v) : v;
}
