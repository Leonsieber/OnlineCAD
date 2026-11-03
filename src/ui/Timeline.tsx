import { useRef } from 'react';
import { IconAlertTriangle, IconLoader2, IconPlayerPlay, IconPlayerSkipBack, IconPlayerSkipForward, IconPlayerStop, IconCircleCheck, IconMagnet } from '@tabler/icons-react';
import { statusText, useStore } from '../store/store';
import { featureIcon } from './icons';

const SNAPS = [0, 0.1, 0.5, 1, 2, 5, 10];

export function Timeline() {
  const doc = useStore((s) => s.doc);
  const statuses = useStore((s) => s.statuses);
  const draft = useStore((s) => s.draft);
  const playing = useStore((s) => s.playing);
  const setRollback = useStore((s) => s.setRollback);
  const editFeature = useStore((s) => s.editFeature);
  const timer = useRef<number | null>(null);
  const n = doc.features.length;

  const stop = () => {
    if (timer.current) window.clearInterval(timer.current);
    timer.current = null;
    useStore.setState({ playing: false });
  };

  // Replays the history step by step without adding undo entries.
  const play = () => {
    if (playing) return stop();
    if (!n || draft) return;
    const end = doc.rollback || n;
    let k = 0;
    useStore.setState({ playing: true, doc: { ...doc, rollback: 0 } });
    timer.current = window.setInterval(() => {
      k++;
      const d = useStore.getState().doc;
      useStore.setState({ doc: { ...d, rollback: k } });
      if (k >= end) stop();
    }, 450);
  };

  const marker = <span key="marker" className="tl-marker" title="Rollback position" />;
  return (
    <footer className="timeline">
      <div className="tl-controls">
        <button className="icon-btn sm" title="Roll back to the start" aria-label="Roll to start" onClick={() => setRollback(0)}>
          <IconPlayerSkipBack size={14} />
        </button>
        <button className="icon-btn sm" title={playing ? 'Stop replay' : 'Replay the history'} aria-label="Replay history" onClick={play}>
          {playing ? <IconPlayerStop size={14} /> : <IconPlayerPlay size={14} />}
        </button>
        <button className="icon-btn sm" title="Roll forward to the end" aria-label="Roll to end" onClick={() => setRollback(n)}>
          <IconPlayerSkipForward size={14} />
        </button>
      </div>
      <div className="tl-track">
        {n === 0 && <span className="tl-empty">Timeline</span>}
        {doc.features.flatMap((f, i) => {
          const Icon = featureIcon(f);
          const st = statuses[f.id];
          const chip = (
            <button
              key={f.id}
              className={`tl-chip${i >= doc.rollback ? ' rolled' : ''}${st?.state === 'error' && i < doc.rollback ? ' error' : ''}${f.suppressed ? ' suppressed' : ''}`}
              title={`${f.name}${st?.message ? ` — ${statusText(st)}` : ''}\nClick: roll here · Double-click: edit`}
              onClick={() => setRollback(i + 1)}
              onDoubleClick={() => editFeature(f.id)}
            >
              <Icon size={14} stroke={1.6} />
            </button>
          );
          return i === doc.rollback ? [marker, chip] : [chip];
        })}
        {doc.rollback >= n && n > 0 && marker}
      </div>
      <StatusBar />
    </footer>
  );
}

function StatusBar() {
  const kernel = useStore((s) => s.kernel);
  const kernelError = useStore((s) => s.kernelError);
  const busy = useStore((s) => s.busy);
  const evalMs = useStore((s) => s.evalMs);
  const sel = useStore((s) => s.sel);
  const snap = useStore((s) => s.prefs.snap);
  const setPref = useStore((s) => s.setPref);
  return (
    <div className="status">
      {kernel === 'loading' && (
        <span className="st">
          <IconLoader2 size={13} className="spin" /> Starting geometry engine
        </span>
      )}
      {kernel === 'error' && (
        <span className="st error" title={kernelError ?? ''}>
          <IconAlertTriangle size={13} /> Engine error
        </span>
      )}
      {kernel === 'ready' && (
        <span className="st">
          {busy ? <IconLoader2 size={13} className="spin" /> : <IconCircleCheck size={13} className="ok" />}
          {busy ? 'Rebuilding' : `Rebuilt in ${Math.max(1, Math.round(evalMs))} ms`}
        </span>
      )}
      {sel.length > 0 && <span className="st">{sel.length} selected</span>}
      <label className="st snap" title="Snap distance for the move arrows">
        <IconMagnet size={13} />
        <select value={snap} onChange={(e) => setPref('snap', Number(e.target.value))} aria-label="Snap">
          {SNAPS.map((v) => (
            <option key={v} value={v}>
              {v === 0 ? 'Snap off' : `${v} mm`}
            </option>
          ))}
        </select>
      </label>
      <span className="st">mm</span>
    </div>
  );
}
