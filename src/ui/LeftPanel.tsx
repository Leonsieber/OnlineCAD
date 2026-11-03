import { useEffect, useRef, useState } from 'react';
import * as ContextMenu from '@radix-ui/react-context-menu';
import {
  IconAlertTriangle,
  IconChevronDown,
  IconChevronRight,
  IconEye,
  IconEyeOff,
  IconPlus,
  IconTarget,
  IconTrash,
  IconVariable,
  IconX,
} from '@tabler/icons-react';
import { formatNum } from '../model/expr';
import type { Variable } from '../model/types';
import { partColor, partName, statusText, useStore } from '../store/store';
import { exportAs } from '../app/actions';
import { featureIcon } from './icons';

export function LeftPanel() {
  return (
    <aside className="left">
      <FeatureList />
      <PartsList />
      <Variables />
    </aside>
  );
}

function Section({ title, count, children, actions, grow, defaultOpen = true }: { title: string; count?: number; children: React.ReactNode; actions?: React.ReactNode; grow?: boolean; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={`section${grow ? ' grow' : ''}${open ? '' : ' closed'}`}>
      <div className="section-head">
        <button className="section-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? <IconChevronDown size={13} /> : <IconChevronRight size={13} />}
          <span>{title}</span>
          {count !== undefined && <span className="count">{count}</span>}
        </button>
        {actions}
      </div>
      {open && <div className="section-body">{children}</div>}
    </section>
  );
}

function FeatureList() {
  const doc = useStore((s) => s.doc);
  const parts = useStore((s) => s.parts);
  const statuses = useStore((s) => s.statuses);
  const draft = useStore((s) => s.draft);
  const editFeature = useStore((s) => s.editFeature);
  const setRollback = useStore((s) => s.setRollback);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const startDrag = (e: React.PointerEvent) => {
    e.preventDefault();
    const rows = [...(listRef.current?.querySelectorAll<HTMLElement>('[data-feature-row]') ?? [])];
    const indexAt = (y: number) => {
      let n = 0;
      for (const r of rows) {
        const b = r.getBoundingClientRect();
        if (y > b.top + b.height / 2) n++;
      }
      return n;
    };
    const move = (ev: PointerEvent) => setDragIndex(indexAt(ev.clientY));
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setDragIndex(null);
      setRollback(indexAt(ev.clientY));
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    setDragIndex(doc.rollback);
  };

  const bar = dragIndex ?? doc.rollback;
  const rollbackBar = (
    <div key="rollback" className={`rollback${dragIndex !== null ? ' dragging' : ''}`} onPointerDown={startDrag} title="Drag to roll the history back or forward">
      <span />
    </div>
  );

  return (
    <Section title="History" count={doc.features.length} grow>
      <div className="tree" ref={listRef}>
        <div className="row origin">
          <IconTarget size={15} stroke={1.6} />
          <span className="row-name">Origin</span>
        </div>
        {doc.features.length === 0 && <div className="empty-note">Shapes and features you add show up here, in order.</div>}
        {doc.features.flatMap((f, i) => {
          const Icon = featureIcon(f);
          const st = statuses[f.id];
          const rolledBack = i >= doc.rollback;
          const editing = draft && !draft.isNew && draft.feature.id === f.id;
          const row = (
            <ContextMenu.Root key={f.id}>
              <ContextMenu.Trigger asChild>
                <div
                  data-feature-row
                  className={`row${editing ? ' on' : ''}${rolledBack ? ' rolled' : ''}${f.suppressed ? ' suppressed' : ''}${st?.state === 'error' && !rolledBack ? ' error' : ''}`}
                  onDoubleClick={() => editFeature(f.id)}
                  title={statusText(st, { doc, parts }) ?? (rolledBack ? 'Rolled back: drag the bar below this to rebuild it' : 'Double-click to edit')}
                >
                  <Icon size={15} stroke={1.6} />
                  {renaming === f.id ? (
                    <RenameInput
                      initial={f.name}
                      onDone={(v) => {
                        setRenaming(null);
                        if (v !== null) useStore.getState().renameFeature(f.id, v);
                      }}
                    />
                  ) : (
                    <span className="row-name">{f.name}</span>
                  )}
                  {st?.state === 'error' && !rolledBack && <IconAlertTriangle size={14} className="row-warn" />}
                  {st?.warning && !rolledBack && <IconAlertTriangle size={14} className="row-caution" />}
                </div>
              </ContextMenu.Trigger>
              <ContextMenu.Portal>
                <ContextMenu.Content className="menu">
                  <ContextMenu.Item className="menu-item" disabled={rolledBack} onSelect={() => editFeature(f.id)}>
                    Edit
                  </ContextMenu.Item>
                  <ContextMenu.Item className="menu-item" onSelect={() => setRenaming(f.id)}>
                    Rename
                  </ContextMenu.Item>
                  <ContextMenu.Item className="menu-item" onSelect={() => useStore.getState().toggleSuppress(f.id)}>
                    {f.suppressed ? 'Unsuppress' : 'Suppress'}
                  </ContextMenu.Item>
                  <ContextMenu.Item className="menu-item" onSelect={() => setRollback(i)}>
                    Roll back to before this
                  </ContextMenu.Item>
                  <ContextMenu.Item className="menu-item" onSelect={() => setRollback(doc.features.length)}>
                    Roll to end
                  </ContextMenu.Item>
                  <ContextMenu.Separator className="menu-sep" />
                  <ContextMenu.Item className="menu-item danger" onSelect={() => useStore.getState().deleteFeature(f.id)}>
                    Delete
                  </ContextMenu.Item>
                </ContextMenu.Content>
              </ContextMenu.Portal>
            </ContextMenu.Root>
          );
          return i === bar ? [rollbackBar, row] : [row];
        })}
        {bar >= doc.features.length && doc.features.length > 0 && rollbackBar}
      </div>
    </Section>
  );
}

function RenameInput({ initial, onDone }: { initial: string; onDone: (v: string | null) => void }) {
  const [v, setV] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.select();
  }, []);
  return (
    <input
      ref={ref}
      className="row-input"
      value={v}
      autoFocus
      onChange={(e) => setV(e.target.value)}
      onBlur={() => onDone(v)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') onDone(v);
        if (e.key === 'Escape') onDone(null);
      }}
    />
  );
}

function PartsList() {
  const parts = useStore((s) => s.parts);
  const doc = useStore((s) => s.doc);
  const sel = useStore((s) => s.sel);
  const draft = useStore((s) => s.draft);
  const select = useStore((s) => s.select);
  const pick = useStore((s) => s.pick);
  const setHover = useStore((s) => s.setHover);
  const setProps = useStore((s) => s.setPartProps);
  return (
    <Section title="Parts" count={parts.length}>
      <div className="tree">
        {parts.length === 0 && <div className="empty-note">No parts yet. Add a shape from the ribbon.</div>}
        {parts.map((p) => {
          const hidden = !!doc.parts[p.id]?.hidden;
          const selected = sel.some((x) => x.part === p.id && x.kind === 'part');
          return (
            <ContextMenu.Root key={p.id}>
              <ContextMenu.Trigger asChild>
                <div
                  className={`row part-row${selected ? ' on' : ''}${hidden ? ' rolled' : ''}`}
                  onClick={(e) => {
                    const item = { kind: 'part' as const, part: p.id, index: -1 };
                    if (draft) pick(item);
                    else select(item, e.shiftKey || e.ctrlKey || e.metaKey);
                  }}
                  onMouseEnter={() => setHover({ kind: 'part', part: p.id, index: -1 })}
                  onMouseLeave={() => setHover(null)}
                >
                  <span className="dot" style={{ background: partColor(p.id, { doc, parts }) }} />
                  <span className="row-name">{partName(p.id, { doc, parts })}</span>
                  {doc.parts[p.id]?.hole && <span className="tag">hole</span>}
                  {p.kind === 'mesh' && <span className="tag">mesh</span>}
                  <button
                    className="row-action"
                    title={hidden ? 'Show' : 'Hide'}
                    aria-label={hidden ? 'Show part' : 'Hide part'}
                    onClick={(e) => {
                      e.stopPropagation();
                      setProps(p.id, { hidden: !hidden });
                    }}
                  >
                    {hidden ? <IconEyeOff size={14} /> : <IconEye size={14} />}
                  </button>
                </div>
              </ContextMenu.Trigger>
              <ContextMenu.Portal>
                <ContextMenu.Content className="menu">
                  <ContextMenu.Item className="menu-item" onSelect={() => setProps(p.id, { hidden: !hidden })}>
                    {hidden ? 'Show' : 'Hide'}
                  </ContextMenu.Item>
                  <ContextMenu.Item
                    className="menu-item"
                    onSelect={() => {
                      const s = useStore.getState();
                      s.commit((d) => ({ ...d, parts: Object.fromEntries(s.parts.map((x) => [x.id, { ...d.parts[x.id], hidden: x.id !== p.id }])) }));
                    }}
                  >
                    Isolate
                  </ContextMenu.Item>
                  <ContextMenu.Separator className="menu-sep" />
                  <ContextMenu.Item
                    className="menu-item"
                    onSelect={() => {
                      select({ kind: 'part', part: p.id, index: -1 });
                      void exportAs('stl', true);
                    }}
                  >
                    Export as STL
                  </ContextMenu.Item>
                  <ContextMenu.Item
                    className="menu-item"
                    onSelect={() => {
                      select({ kind: 'part', part: p.id, index: -1 });
                      void exportAs('step', true);
                    }}
                  >
                    Export as STEP
                  </ContextMenu.Item>
                  <ContextMenu.Separator className="menu-sep" />
                  <ContextMenu.Item className="menu-item danger" onSelect={() => useStore.getState().deleteParts([p.id])}>
                    Delete part
                  </ContextMenu.Item>
                </ContextMenu.Content>
              </ContextMenu.Portal>
            </ContextMenu.Root>
          );
        })}
      </div>
    </Section>
  );
}

function Variables() {
  const vars = useStore((s) => s.doc.variables);
  const values = useStore((s) => s.varValues);
  const errors = useStore((s) => s.varErrors);
  const commit = useStore((s) => s.commit);
  const update = (i: number, v: Variable | null) =>
    commit((d) => ({ ...d, variables: v ? d.variables.map((x, k) => (k === i ? v : x)) : d.variables.filter((_, k) => k !== i) }));
  const add = () =>
    commit((d) => {
      let n = d.variables.length + 1;
      while (d.variables.some((v) => v.name === `v${n}`)) n++;
      return { ...d, variables: [...d.variables, { name: `v${n}`, expr: '10 mm' }] };
    });
  return (
    <Section
      title="Variables"
      count={vars.length}
      defaultOpen={vars.length > 0}
      actions={
        <button className="icon-btn sm" title="Add a variable" aria-label="Add variable" onClick={add}>
          <IconPlus size={14} />
        </button>
      }
    >
      <div className="vars">
        {vars.length === 0 && (
          <div className="empty-note">
            <IconVariable size={14} /> Name a value (like width = 40 mm) and use it in any field.
          </div>
        )}
        {vars.map((v, i) => (
          <div key={i} className={`var-row${errors[v.name] ? ' error' : ''}`} title={errors[v.name]}>
            <BlurInput className="var-name" value={v.name} onCommit={(name) => update(i, { ...v, name })} />
            <span className="var-eq">=</span>
            <BlurInput className="var-expr" value={v.expr} onCommit={(expr) => update(i, { ...v, expr })} />
            <span className="var-val">{v.name in values ? formatNum(values[v.name]) : '!'}</span>
            <button className="row-action" aria-label={`Delete ${v.name}`} onClick={() => update(i, null)}>
              {errors[v.name] ? <IconX size={13} /> : <IconTrash size={13} />}
            </button>
          </div>
        ))}
      </div>
    </Section>
  );
}

function BlurInput({ value, onCommit, className }: { value: string; onCommit: (v: string) => void; className?: string }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <input
      className={className}
      value={v}
      spellCheck={false}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v.trim() && v !== value && onCommit(v.trim())}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
    />
  );
}
