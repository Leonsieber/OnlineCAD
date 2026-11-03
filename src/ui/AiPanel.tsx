// "Generate with AI": describe a part, a language model writes a parametric script, and the part
// appears in the history like any other step. Failed scripts go back to the model to fix.
import { useEffect, useRef, useState } from 'react';
import { IconLoader2, IconSettings, IconSparkles, IconX } from '@tabler/icons-react';
import { AiError, generatePart, loadAiSettings, PROVIDERS, saveAiSettings, type AiSettings, type GeneratedPart } from '../ai/ai';
import { createScript } from '../model/defaults';
import type { ScriptFeature } from '../model/types';
import { statusText, useStore } from '../store/store';
import { viewApi } from '../viewport/viewApi';

const EXAMPLES = ['Phone stand with a cable slot', 'Wall hook for a 6 mm screw', 'Gear with 24 teeth, module 1.5', 'Round planter with drainage holes', 'Cable clip for a desk edge'];
const MAX_REPAIRS = 2;

const S = () => useStore.getState();

/** Resolves once the rebuild for the current draft is done, with that feature's error (if any). */
function rebuildResult(id: string): Promise<string | null> {
  return new Promise((resolve) => {
    let seen = false;
    const check = () => {
      const s = S();
      if (s.busy) seen = true;
      const st = s.statuses[id];
      if ((seen || st) && !s.busy && st) {
        unsub();
        resolve(st.state === 'error' ? (statusText(st) ?? 'Unknown error') : null);
      }
    };
    const unsub = useStore.subscribe(check);
    setTimeout(check, 50);
  });
}

/** The script feature behind the selected part, if it came from one. */
function selectedScript(): ScriptFeature | null {
  const s = S();
  const part = s.sel.find((x) => x.kind === 'part')?.part;
  const p = part ? s.parts.find((x) => x.id === part) : undefined;
  const f = p ? s.doc.features.find((x) => x.id === p.source) : undefined;
  return f?.type === 'script' ? f : null;
}

export function AiPanel() {
  const open = useStore((s) => s.panel === 'ai');
  const sel = useStore((s) => s.sel);
  const [settings, setSettings] = useState<AiSettings>(loadAiSettings);
  const [showSettings, setShowSettings] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [status, setStatus] = useState<{ kind: 'idle' | 'busy' | 'done' | 'error'; text: string }>({ kind: 'idle', text: '' });
  const [refine, setRefine] = useState(true);
  const abort = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const def = PROVIDERS.find((p) => p.id === settings.provider) ?? PROVIDERS[0];
  const existing = open ? selectedScript() : null;
  void sel;

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
    else abort.current?.abort();
  }, [open]);

  // First visit without a key: open the settings straight away.
  useEffect(() => {
    if (open && def.needsKey && !settings.keys[def.id]) setShowSettings(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const update = (patch: Partial<AiSettings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    saveAiSettings(next);
  };

  const run = async () => {
    const text = prompt.trim();
    if (!text || status.kind === 'busy') return;
    const ctrl = new AbortController();
    abort.current = ctrl;
    const target = refine ? existing : null;
    try {
      setStatus({ kind: 'busy', text: `Asking ${def.label.split(' (')[0]}…` });
      let part: GeneratedPart = await generatePart(settings, {
        prompt: text,
        current: target ? { code: target.code, params: target.params } : undefined,
        signal: ctrl.signal,
      });
      // Put it in the history as a draft (or edit the existing script) and let the worker build it.
      const s = S();
      if (s.draft) s.cancelDraft();
      let id: string;
      if (target) {
        S().editFeature(target.id);
        S().patchDraft((f) => (f.type === 'script' ? { ...f, code: part.code, params: part.params } : f));
        id = target.id;
      } else {
        const f = { ...createScript(S().doc.features, undefined, viewApi.groundPointAtCenter()), name: part.name, code: part.code, params: part.params };
        S().startFeature(f);
        id = f.id;
      }
      setStatus({ kind: 'busy', text: 'Building the part…' });
      let error = await rebuildResult(id);
      for (let attempt = 1; error && attempt <= MAX_REPAIRS; attempt++) {
        if (ctrl.signal.aborted) return;
        setStatus({ kind: 'busy', text: `Fixing an error (try ${attempt} of ${MAX_REPAIRS})…` });
        part = await generatePart(settings, { prompt: text, current: { code: part.code, params: part.params }, error, signal: ctrl.signal });
        S().patchDraft((f) => (f.type === 'script' ? { ...f, code: part.code, params: part.params } : f));
        error = await rebuildResult(id);
      }
      if (error) {
        setStatus({ kind: 'error', text: `The script still fails: ${error} You can fix the code on the right, or try again.` });
        return;
      }
      S().confirmDraft();
      setTimeout(() => viewApi.fitAll(true, [id]), 300);
      setStatus({ kind: 'done', text: part.notes || `Made "${part.name}". Change its sizes on the right, or ask for changes.` });
      setPrompt('');
    } catch (e) {
      if ((e as Error).name === 'AbortError' || ctrl.signal.aborted) {
        setStatus({ kind: 'idle', text: '' });
        return;
      }
      setStatus({ kind: 'error', text: e instanceof AiError ? e.message : `Something went wrong: ${(e as Error).message}` });
    } finally {
      abort.current = null;
    }
  };

  const busy = status.kind === 'busy';
  return (
    <div className="ai-panel" role="dialog" aria-label="Generate with AI">
      <div className="ai-head">
        <IconSparkles size={16} />
        <strong>{existing && refine ? `Change "${existing.name}" with AI` : 'Generate a part with AI'}</strong>
        <span className="ai-model">{settings.model || def.model}</span>
        <button className={`icon-btn sm${showSettings ? ' on' : ''}`} title="AI settings" aria-label="AI settings" onClick={() => setShowSettings(!showSettings)}>
          <IconSettings size={15} />
        </button>
        <button className="icon-btn sm" title="Close (Esc)" aria-label="Close" onClick={() => S().setPanel(null)}>
          <IconX size={15} />
        </button>
      </div>

      {showSettings && (
        <div className="ai-settings">
          <label>
            Provider
            <select
              className="select"
              value={settings.provider}
              onChange={(e) => {
                const p = PROVIDERS.find((x) => x.id === e.target.value)!;
                update({ provider: p.id, model: p.model, baseUrl: p.baseUrl ?? '' });
              }}
            >
              {PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Model
            <input className="input" list="ai-models" value={settings.model} placeholder={def.model || 'model name'} onChange={(e) => update({ model: e.target.value })} />
            <datalist id="ai-models">
              {def.models.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </label>
          {(def.id === 'custom' || def.id === 'ollama') && (
            <label>
              Server address
              <input className="input" value={settings.baseUrl} placeholder={def.baseUrl || 'https://…/v1'} onChange={(e) => update({ baseUrl: e.target.value })} />
            </label>
          )}
          <label>
            API key {def.needsKey ? '' : '(optional)'}
            <input
              className="input"
              type="password"
              autoComplete="off"
              value={settings.keys[def.id] ?? ''}
              placeholder={def.keyHint}
              onChange={(e) => update({ keys: { ...settings.keys, [def.id]: e.target.value } })}
            />
          </label>
          <p className="ai-note">Your key is kept in this browser only and sent only to {def.label.split(' (')[0]}. Usage is billed to your own account.</p>
        </div>
      )}

      <textarea
        ref={inputRef}
        className="ai-input"
        rows={2}
        value={prompt}
        disabled={busy}
        placeholder={existing && refine ? 'What should change? e.g. "make it 20% taller and add a slot"' : 'Describe a part, e.g. "a 60 mm phone stand with a cable slot"'}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            void run();
          }
          if (e.key === 'Escape') S().setPanel(null);
        }}
      />
      <div className="ai-bar">
        {existing ? (
          <label className="ai-refine">
            <input type="checkbox" checked={refine} onChange={(e) => setRefine(e.target.checked)} /> Change the selected part
          </label>
        ) : (
          <div className="ai-examples">
            {EXAMPLES.slice(0, 3).map((x) => (
              <button key={x} className="chip" onClick={() => setPrompt(x)} disabled={busy}>
                {x}
              </button>
            ))}
          </div>
        )}
        {busy ? (
          <button className="btn" onClick={() => abort.current?.abort()}>
            Stop
          </button>
        ) : (
          <button className="btn primary" onClick={() => void run()} disabled={!prompt.trim()}>
            <IconSparkles size={14} /> Generate
          </button>
        )}
      </div>
      {status.kind !== 'idle' && (
        <div className={`ai-status ${status.kind}`}>
          {busy && <IconLoader2 size={14} className="spin" />}
          <span>{status.text}</span>
        </div>
      )}
    </div>
  );
}
