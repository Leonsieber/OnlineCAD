import { useEffect, useRef } from 'react';
import { Canvas } from '@react-three/fiber';
import {
  IconAlertTriangle,
  IconArrowsMove,
  IconBox,
  IconCopy,
  IconCube,
  IconCylinder,
  IconEyeOff,
  IconFileImport,
  IconFocusCentered,
  IconLine,
  IconLoader2,
  IconRotate,
  IconSphere,
  IconSquare,
  IconTrash,
} from '@tabler/icons-react';
import { partName, useStore, type SelKind } from '../store/store';
import { addPrimitive, deleteSelection, duplicateSelection, hideSelection, importFile, openExample, startPartFeature } from '../app/actions';
import { Scene } from './Scene';
import { ViewCube } from './ViewCube';
import { viewApi } from './viewApi';

export function Viewport() {
  return (
    <div className="viewport">
      <Canvas className="viewport-canvas" frameloop="demand" flat dpr={[1, 2]} gl={{ antialias: true, alpha: true, preserveDrawingBuffer: true }}>
        <Scene />
      </Canvas>
      <ViewCube />
      <Hud />
      <EmptyState />
      <KernelOverlay />
      <ViewportMenu />
      <DropZone />
    </div>
  );
}

const FILTERS: { id: SelKind; label: string; icon: typeof IconBox; key: string }[] = [
  { id: 'part', label: 'Parts', icon: IconBox, key: '1' },
  { id: 'face', label: 'Faces', icon: IconSquare, key: '2' },
  { id: 'edge', label: 'Edges', icon: IconLine, key: '3' },
];

function Hud() {
  const filter = useStore((s) => s.filter);
  const setFilter = useStore((s) => s.setFilter);
  const draft = useStore((s) => s.draft);
  const gizmo = useStore((s) => s.gizmo);
  const setGizmo = useStore((s) => s.setGizmo);
  const sel = useStore((s) => s.sel);
  const showGizmoModes = (!draft && sel.some((x) => x.kind === 'part')) || draft?.feature.type === 'primitive';
  return (
    <div className="hud">
      {!draft && (
        <div className="hud-group" role="radiogroup" aria-label="Selection filter">
          {FILTERS.map((f) => (
            <button key={f.id} className={filter === f.id ? 'on' : ''} title={`Select ${f.label.toLowerCase()} (${f.key})`} onClick={() => setFilter(f.id)}>
              <f.icon size={15} stroke={1.7} />
              <span>{f.label}</span>
            </button>
          ))}
        </div>
      )}
      {draft?.field && <div className="hud-note">Click {draft.field === 'edges' ? 'edges' : draft.field === 'faces' ? 'faces' : 'parts'} to add or remove them</div>}
      {showGizmoModes && (
        <div className="hud-group">
          <button className={gizmo === 'translate' ? 'on' : ''} title="Move (W)" onClick={() => setGizmo('translate')}>
            <IconArrowsMove size={15} stroke={1.7} />
          </button>
          <button className={gizmo === 'rotate' ? 'on' : ''} title="Rotate (E)" onClick={() => setGizmo('rotate')}>
            <IconRotate size={15} stroke={1.7} />
          </button>
        </div>
      )}
      <div className="hud-group">
        <button title="Fit all (F)" onClick={() => viewApi.fitAll()}>
          <IconFocusCentered size={15} stroke={1.7} />
        </button>
      </div>
    </div>
  );
}

function EmptyState() {
  const parts = useStore((s) => s.parts);
  const features = useStore((s) => s.doc.features.length);
  const draft = useStore((s) => s.draft);
  const kernel = useStore((s) => s.kernel);
  if (parts.length || features || draft || kernel !== 'ready') return null;
  return (
    <div className="empty-state">
      <div className="empty-card">
        <h2>Start modelling</h2>
        <p>Add a shape, open the example, or drop a file here.</p>
        <div className="empty-actions">
          <button className="btn" onClick={() => addPrimitive('box')}>
            <IconCube size={16} /> Box
          </button>
          <button className="btn" onClick={() => addPrimitive('cylinder')}>
            <IconCylinder size={16} /> Cylinder
          </button>
          <button className="btn" onClick={() => addPrimitive('sphere')}>
            <IconSphere size={16} /> Sphere
          </button>
        </div>
        <div className="empty-actions">
          <button className="btn primary" onClick={() => void openExample()}>
            Open the example bracket
          </button>
          <button className="btn" onClick={() => void importFile()}>
            <IconFileImport size={16} /> Import a file
          </button>
        </div>
      </div>
    </div>
  );
}

function KernelOverlay() {
  const kernel = useStore((s) => s.kernel);
  const error = useStore((s) => s.kernelError);
  if (kernel === 'ready') return null;
  return (
    <div className="kernel-overlay">
      {kernel === 'loading' ? (
        <div className="kernel-card">
          <IconLoader2 size={22} className="spin" />
          <div>
            <strong>Starting the geometry engine</strong>
            <span>Loading OpenCascade (about 7 MB, cached after the first visit)</span>
          </div>
        </div>
      ) : (
        <div className="kernel-card error">
          <IconAlertTriangle size={22} />
          <div>
            <strong>The geometry engine couldn't start</strong>
            <span>{error ?? 'Reload the page to try again.'}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function ViewportMenu() {
  const menu = useStore((s) => s.ctxMenu);
  const setMenu = useStore((s) => s.setCtxMenu);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setMenu(null);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setMenu(null);
    window.addEventListener('pointerdown', close, true);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('pointerdown', close, true);
      window.removeEventListener('keydown', esc);
    };
  }, [menu, setMenu]);
  if (!menu) return null;
  const run = (fn: () => void) => () => {
    setMenu(null);
    fn();
  };
  const style = { left: Math.min(menu.x, window.innerWidth - 220), top: Math.min(menu.y, window.innerHeight - 260) };
  return (
    <div ref={ref} className="menu floating" style={style} role="menu">
      {menu.part ? (
        <>
          <div className="menu-label">{partName(menu.part)}</div>
          <button className="menu-item" onClick={run(() => startPartFeature('transform'))}>
            <IconArrowsMove size={15} /> Move precisely…
          </button>
          <button className="menu-item" onClick={run(duplicateSelection)}>
            <IconCopy size={15} /> Duplicate
          </button>
          <button className="menu-item" onClick={run(() => hideSelection(true))}>
            <IconEyeOff size={15} /> Hide
          </button>
          <div className="menu-sep" />
          <button className="menu-item danger" onClick={run(deleteSelection)}>
            <IconTrash size={15} /> Delete
          </button>
        </>
      ) : (
        <>
          <button className="menu-item" onClick={run(() => viewApi.fitAll())}>
            <IconFocusCentered size={15} /> Fit all
          </button>
          <button className="menu-item" onClick={run(() => viewApi.setView('iso'))}>
            Isometric view
          </button>
          <button className="menu-item" onClick={run(() => viewApi.setView('top'))}>
            Top view
          </button>
          <button className="menu-item" onClick={run(() => viewApi.setView('front'))}>
            Front view
          </button>
          <div className="menu-sep" />
          <button className="menu-item" onClick={run(() => addPrimitive('box'))}>
            <IconCube size={15} /> Add box
          </button>
          <button className="menu-item" onClick={run(() => void importFile())}>
            <IconFileImport size={15} /> Import…
          </button>
        </>
      )}
    </div>
  );
}

function DropZone() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current?.parentElement;
    if (!el) return;
    let depth = 0;
    const show = (v: boolean) => ref.current?.classList.toggle('show', v);
    const enter = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes('Files')) return;
      e.preventDefault();
      depth++;
      show(true);
    };
    const leave = () => {
      depth = Math.max(0, depth - 1);
      if (!depth) show(false);
    };
    const over = (e: DragEvent) => e.preventDefault();
    const drop = (e: DragEvent) => {
      e.preventDefault();
      depth = 0;
      show(false);
      const f = e.dataTransfer?.files?.[0];
      if (f) void importFile(f);
    };
    el.addEventListener('dragenter', enter);
    el.addEventListener('dragleave', leave);
    el.addEventListener('dragover', over);
    el.addEventListener('drop', drop);
    return () => {
      el.removeEventListener('dragenter', enter);
      el.removeEventListener('dragleave', leave);
      el.removeEventListener('dragover', over);
      el.removeEventListener('drop', drop);
    };
  }, []);
  return (
    <div ref={ref} className="dropzone">
      <IconFileImport size={30} stroke={1.4} />
      <span>Drop to import</span>
    </div>
  );
}
