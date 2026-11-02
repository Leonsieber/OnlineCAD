import { useEffect, useState, type ReactNode } from 'react';
import { IconX } from '@tabler/icons-react';
import { evalNum, formatNum, parseNumInput } from '../model/expr';
import type { NumExpr } from '../model/types';
import { useStore } from '../store/store';

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="field" title={hint}>
      <span className="field-label">{label}</span>
      <span className="field-control">{children}</span>
    </label>
  );
}

/** Numeric input that also accepts expressions ("width / 2", "1 in") and arrow-key nudging. */
export function NumInput({
  value,
  onChange,
  unit = 'mm',
  step = 1,
  min,
  integer,
  autoFocus,
  ariaLabel,
}: {
  value: NumExpr;
  onChange: (v: NumExpr) => void;
  unit?: string;
  step?: number;
  min?: number;
  integer?: boolean;
  autoFocus?: boolean;
  ariaLabel?: string;
}) {
  const scope = useStore((s) => s.varValues);
  const [text, setText] = useState(String(value));
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setText(String(value));
    setError(null);
  }, [value]);

  const evaluate = (v: NumExpr): number | string => {
    try {
      const n = evalNum(v, scope);
      if (min !== undefined && n < min) return `Must be at least ${min}`;
      return n;
    } catch (e) {
      return (e as Error).message;
    }
  };

  const commit = (t: string) => {
    const v = parseNumInput(t);
    const r = evaluate(v);
    if (typeof r === 'string') {
      setError(r);
      return;
    }
    setError(null);
    const out = integer && typeof v === 'number' ? Math.round(v) : v;
    if (out !== value) onChange(out);
  };

  const evaluated = typeof value === 'string' ? evaluate(value) : null;
  return (
    <span className={`num-input${error ? ' has-error' : ''}`} title={error ?? (typeof evaluated === 'number' ? `= ${formatNum(evaluated)} ${unit}` : undefined)}>
      <input
        value={text}
        aria-label={ariaLabel}
        autoFocus={autoFocus}
        spellCheck={false}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => commit(text)}
        onFocus={(e) => e.target.select()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            commit(text);
            (e.target as HTMLInputElement).blur();
            e.stopPropagation();
          } else if (e.key === 'Escape') {
            setText(String(value));
            setError(null);
            (e.target as HTMLInputElement).blur();
            e.stopPropagation();
          } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const cur = evaluate(parseNumInput(text));
            if (typeof cur !== 'number') return;
            const k = (e.shiftKey ? 10 : e.altKey ? 0.1 : 1) * step * (e.key === 'ArrowUp' ? 1 : -1);
            let n = Math.round((cur + k) * 1e6) / 1e6;
            if (min !== undefined) n = Math.max(min, n);
            setText(String(n));
            onChange(n);
          }
        }}
      />
      {typeof evaluated === 'number' && <span className="num-eval">{formatNum(evaluated)}</span>}
      {unit && <span className="num-unit">{unit}</span>}
    </span>
  );
}

export function Vec3Input({ value, onChange, unit = 'mm', step = 1 }: { value: NumExpr[]; onChange: (v: [NumExpr, NumExpr, NumExpr]) => void; unit?: string; step?: number }) {
  return (
    <span className="vec3">
      {(['X', 'Y', 'Z'] as const).map((axis, i) => (
        <span key={axis} className={`vec3-item axis-${axis.toLowerCase()}`}>
          <span className="vec3-axis">{axis}</span>
          <NumInput
            value={value[i]}
            unit={i === 2 ? unit : ''}
            step={step}
            ariaLabel={axis}
            onChange={(v) => {
              const next = [...value] as [NumExpr, NumExpr, NumExpr];
              next[i] = v;
              onChange(next);
            }}
          />
        </span>
      ))}
    </span>
  );
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string; icon?: ReactNode }[]; onChange: (v: T) => void }) {
  return (
    <span className="segmented" role="radiogroup">
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={o.value === value} className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.icon}
          {o.label}
        </button>
      ))}
    </span>
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} className={`switch${checked ? ' on' : ''}`} onClick={() => onChange(!checked)}>
      <span className="switch-track">
        <span className="switch-thumb" />
      </span>
      <span>{label}</span>
    </button>
  );
}

export interface Chip {
  key: string;
  label: string;
  color?: string;
}

/** Selection list fed by viewport clicks while it is the active field. */
export function RefField({
  label,
  chips,
  active,
  placeholder,
  onActivate,
  onRemove,
  onClear,
}: {
  label: string;
  chips: Chip[];
  active: boolean;
  placeholder: string;
  onActivate: () => void;
  onRemove: (key: string) => void;
  onClear: () => void;
}) {
  return (
    <div className={`ref-field${active ? ' active' : ''}`} onClick={onActivate} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onActivate()}>
      <div className="ref-head">
        <span>{label}</span>
        {chips.length > 0 && (
          <button
            type="button"
            className="link"
            onClick={(e) => {
              e.stopPropagation();
              onClear();
            }}
          >
            Clear
          </button>
        )}
      </div>
      {chips.length === 0 ? (
        <div className="ref-empty">{active ? placeholder : 'Click to choose'}</div>
      ) : (
        <div className="chips">
          {chips.map((c) => (
            <span key={c.key} className="chip">
              {c.color && <span className="chip-dot" style={{ background: c.color }} />}
              {c.label}
              <button
                type="button"
                aria-label={`Remove ${c.label}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove(c.key);
                }}
              >
                <IconX size={11} />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
