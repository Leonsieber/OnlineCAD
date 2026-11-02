import { useEffect, useState, type ReactNode } from 'react';
import { IconFilePlus, IconTrash, IconX, IconRocket, IconCube } from '@tabler/icons-react';
import { deleteDoc, listDocs, type DocMeta } from '../io/storage';
import { IMPORT_LABEL } from '../io/importers';
import { useStore } from '../store/store';
import { newDocument, openDocument, openExample } from '../app/actions';
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
  ['W / E', 'Move arrows / rotate rings'],
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

export function Modals() {
  const modal = useStore((s) => s.modal);
  const setModal = useStore((s) => s.setModal);
  const close = () => setModal(null);
  if (modal === 'documents') return <Documents onClose={close} />;
  if (modal === 'shortcuts') return <Shortcuts onClose={close} />;
  if (modal === 'about') return <About onClose={close} />;
  return null;
}
