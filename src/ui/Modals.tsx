import { useEffect, useState, type ReactNode } from 'react';
import { IconFilePlus, IconTrash, IconX, IconRocket, IconCube, IconHandMove, IconAxisX, IconDeviceDesktop } from '@tabler/icons-react';
import { THEMES } from './themes';
import { deleteDoc, listDocs, type DocMeta } from '../io/storage';
import { IMPORT_LABEL } from '../io/importers';
import { useStore } from '../store/store';
import { addScript, newDocument, openDocument, openExample } from '../app/actions';
import { LIBRARY } from '../model/library';
import { DrawingSheet } from './DrawingSheet';
import { AccountModal } from './AccountModal';
import { mod } from './MenuBar';

function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" aria-label="Close" onClick={onClose}>
            <IconX size={16} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

function timeAgo(t: number) {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(t).toLocaleDateString();
}

function Documents({ onClose }: { onClose: () => void }) {
  const current = useStore((s) => s.doc.id);
  const [docs, setDocs] = useState<DocMeta[] | null>(null);
  const refresh = () => void listDocs().then(setDocs);
  useEffect(refresh, []);
  return (
    <Modal title="Your documents" onClose={onClose} wide>
      <p className="muted">Saved in this browser. Cloud sync arrives in milestone 4.</p>
      <div className="doc-grid">
        <button
          className="doc-card new"
          onClick={() => {
            void newDocument();
            onClose();
          }}
        >
          <IconFilePlus size={28} stroke={1.4} />
          <span>New document</span>
        </button>
        <button
          className="doc-card new"
          onClick={() => {
            void openExample();
            onClose();
          }}
        >
          <IconCube size={28} stroke={1.4} />
          <span>Example: bracket</span>
        </button>
        {docs === null && <div className="muted">Loading…</div>}
        {docs?.map((d) => (
          <div key={d.id} className={`doc-card${d.id === current ? ' current' : ''}`}>
            <button className="doc-open" onClick={() => void openDocument(d.id)}>
              <div className="doc-thumb">{d.thumb ? <img src={d.thumb} alt="" /> : <IconCube size={30} stroke={1.2} />}</div>
              <div className="doc-name-row">{d.name}</div>
              <div className="doc-meta">
                {d.features} feature{d.features === 1 ? '' : 's'} · {timeAgo(d.modified)}
              </div>
            </button>
            {d.id !== current && (
              <button
                className="icon-btn doc-del"
                title="Delete document"
                aria-label={`Delete ${d.name}`}
                onClick={async () => {
                  if (!confirm(`Delete "${d.name}"? This can't be undone.`)) return;
                  await deleteDoc(d.id);
                  refresh();
                }}
              >
                <IconTrash size={15} />
              </button>
            )}
          </div>
        ))}
      </div>
    </Modal>
  );
}

const SHORTCUTS: [string, string][] = [
  ['Left drag', 'Orbit'],
  ['Right drag, middle drag, or Shift + left drag', 'Pan'],
  ['Scroll', 'Zoom toward the cursor'],
  ['Click / Shift + click', 'Select / add to selection'],
  ['Drag a part', 'Move it on the plate (Tinkercad style)'],
  ['Arrow keys (Shift: ×10)', 'Nudge the selection by the snap distance'],
  [`${mod}↑ / ${mod}↓ or Page Up / Down`, 'Lift / lower the selection'],
  ['D', 'Drop the selection onto the plate'],
  ['Shift / Alt while resizing', 'Keep proportions / resize from the center'],
  ['Q / W / E', 'Resize box / move arrows / rotate rings'],
  ['F', 'Fit all'],
  ['G', 'Toggle grid'],
  ['H / Shift + H', 'Hide selected / show all'],
  ['1 · 2 · 3', 'Select parts · faces · edges'],
  [`${mod}Z / ${mod}Y`, 'Undo / redo'],
  [`${mod}D`, 'Duplicate'],
  ['Delete', 'Delete selected parts'],
  [`${mod}S / ${mod}O`, 'Save / open documents'],
  [`${mod}I`, 'Import a file'],
  ['Enter / Esc', 'Confirm / cancel the open dialog'],
  [`${mod},`, 'Preferences: interaction style and theme'],
  ['?', 'This list'],
];

function Shortcuts({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Keyboard and mouse" onClose={onClose}>
      <table className="shortcuts">
        <tbody>
          {SHORTCUTS.map(([k, v]) => (
            <tr key={k}>
              <td>
                <kbd>{k}</kbd>
              </td>
              <td>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  );
}

const ROADMAP: [string, string, boolean][] = [
  ['1 · Core', 'Shapes, booleans, fillet, chamfer, shell, move, mirror, patterns, history, variables, undo, local saves, import and export', true],
  ['2 · Sketch and features', 'Sketch on planes and faces with constraints; extrude, revolve, sweep, loft; measure tool', false],
  ['3 · Mesh and render', 'Vertex, edge, and face editing, subdivision, sculpting, materials, realistic rendering', false],
  ['4 · Online and desktop', 'Google, GitHub, and email sign-in, cloud saves, share links, Windows installer', false],
  ['5 · Extras', '2D drawings, 3D-print checks, assemblies, parts library, scripting, live collaboration', false],
];

function About({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="About OnlineCAD" onClose={onClose}>
      <p>
        A parametric 3D modeller that runs in your browser. Solids are built by OpenCascade, the geometry kernel used by FreeCAD, compiled to WebAssembly and running on your computer.
      </p>
      <p className="muted">Imports {IMPORT_LABEL}. Exports STEP, STL, 3MF, OBJ, PLY, and GLB.</p>
      <div className="section-label">
        <IconRocket size={14} /> Roadmap
      </div>
      <ul className="roadmap">
        {ROADMAP.map(([t, d, done]) => (
          <li key={t} className={done ? 'done' : ''}>
            <strong>{t}</strong>
            <span>{d}</span>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

const SNAPS = [0, 0.1, 0.25, 0.5, 1, 2, 5, 10];

function Settings({ onClose }: { onClose: () => void }) {
  const prefs = useStore((s) => s.prefs);
  const setPref = useStore((s) => s.setPref);
  return (
    <Modal title="Preferences" onClose={onClose} wide>
      <div className="section-label">Interaction style</div>
      <div className="choice-cards">
        <button className={`choice-card${prefs.interaction === 'tinkercad' ? ' on' : ''}`} onClick={() => setPref('interaction', 'tinkercad')}>
          <IconHandMove size={22} stroke={1.5} />
          <strong>Tinkercad</strong>
          <span>Drag parts around the plate. Squares resize, the cone lifts, three arcs rotate with a protractor. Arrow keys nudge, D drops onto the plate.</span>
        </button>
        <button className={`choice-card${prefs.interaction === 'pro' ? ' on' : ''}`} onClick={() => setPref('interaction', 'pro')}>
          <IconAxisX size={22} stroke={1.5} />
          <strong>Pro</strong>
          <span>Like Onshape and Fusion: move arrows and rotate rings (W, E), resize box (Q), and exact values in the panel. Dragging a part orbits the view instead of moving it.</span>
        </button>
      </div>

      <div className="section-label">Theme</div>
      <div className="theme-grid">
        {THEMES.map((t) => (
          <button key={t.id} className={`theme-card${prefs.theme === t.id ? ' on' : ''}`} onClick={() => setPref('theme', t.id)} title={t.description}>
            <span className="theme-swatch" style={{ background: t.swatch[0] }}>
              <span style={{ background: t.swatch[1], borderColor: t.swatch[3] + '22' }}>
                <i style={{ background: t.swatch[2] }} />
                <b style={{ background: t.swatch[3] }} />
              </span>
            </span>
            <span className="theme-name">{t.label}</span>
          </button>
        ))}
        <button className={`theme-card${prefs.theme === 'system' ? ' on' : ''}`} onClick={() => setPref('theme', 'system')} title="Light or Midnight, following your system setting">
          <span className="theme-swatch system">
            <IconDeviceDesktop size={20} stroke={1.5} />
          </span>
          <span className="theme-name">Match system</span>
        </button>
      </div>

      <div className="section-label">Snapping</div>
      <div className="pref-row">
        <span>Grid snap for moving and resizing</span>
        <select className="input sm" value={prefs.snap} onChange={(e) => setPref('snap', Number(e.target.value))}>
          {SNAPS.map((v) => (
            <option key={v} value={v}>
              {v === 0 ? 'Off' : `${v} mm`}
            </option>
          ))}
        </select>
      </div>
    </Modal>
  );
}

function Library({ onClose }: { onClose: () => void }) {
  const cats = [...new Set(LIBRARY.map((l) => l.category))];
  return (
    <Modal title="Parts library" onClose={onClose} wide>
      <p className="muted">Every part has sizes you can change, and its code is open: edit it like any script.</p>
      {cats.map((c) => (
        <div key={c}>
          <div className="section-label">{c}</div>
          <div className="template-grid lib-grid">
            {LIBRARY.filter((l) => l.category === c).map((l) => (
              <button key={l.id} className="template-card" onClick={() => addScript(l.id)}>
                <strong>{l.label}</strong>
                <span>{l.description}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </Modal>
  );
}

export function Modals() {
  const modal = useStore((s) => s.modal);
  const setModal = useStore((s) => s.setModal);
  const close = () => setModal(null);
  if (modal === 'documents') return <Documents onClose={close} />;
  if (modal === 'shortcuts') return <Shortcuts onClose={close} />;
  if (modal === 'about') return <About onClose={close} />;
  if (modal === 'settings') return <Settings onClose={close} />;
  if (modal === 'library') return <Library onClose={close} />;
  if (modal === 'drawing') return <DrawingSheet onClose={close} />;
  if (modal === 'account') return <AccountModal onClose={close} />;
  return null;
}
