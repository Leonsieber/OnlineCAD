import { useEffect, useState, type ReactNode } from 'react';
import * as Menubar from '@radix-ui/react-menubar';
import { IconChevronRight, IconCloudCheck, IconDeviceFloppy, IconLoader2, IconMoon, IconSettings, IconSun, IconUser } from '@tabler/icons-react';
import { EXPORT_FORMATS } from '../io/exporters';
import { PRIMITIVES, PRIMITIVE_ORDER } from '../model/defaults';
import { useStore, type DisplayMode } from '../store/store';
import { THEMES, themeDef } from './themes';
import { useCloud } from '../cloud/cloud';
import { viewApi, type ViewName } from '../viewport/viewApi';
import {
  addPrimitive,
  deleteSelection,
  downloadDocument,
  duplicateSelection,
  exportAs,
  goHome,
  shareProject,
  hideSelection,
  importFile,
  newDocument,
  openDocumentFile,
  openExample,
  saveNow,
  selectAll,
  showAllParts,
  startBoolean,
  startEdgeFeature,
  startPartFeature,
  startShell,
} from '../app/actions';
import { PRIMITIVE_ICONS } from './icons';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
export const mod = isMac ? '⌘' : 'Ctrl+';

function Item({ children, shortcut, onSelect, danger }: { children: ReactNode; shortcut?: string; onSelect: () => void; danger?: boolean }) {
  return (
    <Menubar.Item className={`menu-item${danger ? ' danger' : ''}`} onSelect={onSelect}>
      <span>{children}</span>
      {shortcut && <span className="menu-hint">{shortcut}</span>}
    </Menubar.Item>
  );
}

function Sub({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Menubar.Sub>
      <Menubar.SubTrigger className="menu-item">
        <span>{label}</span>
        <IconChevronRight size={13} className="menu-hint" />
      </Menubar.SubTrigger>
      <Menubar.Portal>
        <Menubar.SubContent className="menu" sideOffset={2} alignOffset={-4}>
          {children}
        </Menubar.SubContent>
      </Menubar.Portal>
    </Menubar.Sub>
  );
}

function Menu({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Menubar.Menu>
      <Menubar.Trigger className="menubar-trigger">{label}</Menubar.Trigger>
      <Menubar.Portal>
        <Menubar.Content className="menu" align="start" sideOffset={4}>
          {children}
        </Menubar.Content>
      </Menubar.Portal>
    </Menubar.Menu>
  );
}

const Sep = () => <Menubar.Separator className="menu-sep" />;

const VIEWS: [ViewName, string][] = [
  ['iso', 'Isometric'],
  ['front', 'Front'],
  ['back', 'Back'],
  ['left', 'Left'],
  ['right', 'Right'],
  ['top', 'Top'],
  ['bottom', 'Bottom'],
];

const DISPLAYS: [DisplayMode, string][] = [
  ['shadedEdges', 'Shaded with edges'],
  ['shaded', 'Shaded'],
  ['wireframe', 'Wireframe'],
  ['xray', 'X-ray'],
  ['realistic', 'Realistic (materials and shadows)'],
];

function DocName() {
  const name = useStore((s) => s.doc.name);
  const rename = useStore((s) => s.renameDoc);
  const [text, setText] = useState(name);
  useEffect(() => setText(name), [name]);
  return (
    <input
      className="doc-name"
      value={text}
      aria-label="Document name"
      spellCheck={false}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => rename(text)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') {
          setText(name);
          (e.target as HTMLInputElement).blur();
        }
      }}
      style={{ width: `${Math.max(8, text.length + 2)}ch` }}
    />
  );
}

function SaveState() {
  const state = useStore((s) => s.saveState);
  if (state === 'saving')
    return (
      <span className="save-state">
        <IconLoader2 size={14} className="spin" /> Saving
      </span>
    );
  if (state === 'unsaved')
    return (
      <button className="save-state link" onClick={() => void saveNow()} title={`Save now (${mod}S)`}>
        <IconDeviceFloppy size={14} /> Unsaved
      </button>
    );
  return (
    <span className="save-state" title="Saved in this browser">
      <IconCloudCheck size={14} /> Saved locally
    </span>
  );
}


function AccountButton() {
  const user = useCloud((c) => c.user);
  const setModal = useStore((s) => s.setModal);
  return (
    <button className="account" title={user ? `Signed in as ${user.email ?? ''}` : 'Sign in to sync projects to the cloud'} onClick={() => setModal('account')}>
      <IconUser size={14} /> {user ? (user.email ?? 'Account').split('@')[0] : 'Sign in'}
    </button>
  );
}

export function MenuBar() {
  const s = useStore();
  const scheme = themeDef(s.resolvedTheme).scheme;
  return (
    <header className="menubar">
      <button className="brand" title="All projects" aria-label="All projects" onClick={() => void goHome()}>
        <img src="/favicon.svg" alt="" width={20} height={20} />
      </button>
      <Menubar.Root className="menubar-root">
        <Menu label="File">
          <Item onSelect={() => void goHome()}>All projects</Item>
          <Item onSelect={() => s.setModal('drawing')}>Create 2D drawing…</Item>
          <Item onSelect={() => void shareProject()}>Share link…</Item>
          <Item onSelect={() => viewApi.saveImage()}>Save image (PNG)</Item>
          <Item onSelect={() => void newDocument()}>New document</Item>
          <Item shortcut={`${mod}O`} onSelect={() => s.setModal('documents')}>
            Open…
          </Item>
          <Item onSelect={() => void openExample()}>Open example: bracket</Item>
          <Sep />
          <Item shortcut={`${mod}S`} onSelect={() => void saveNow()}>
            Save
          </Item>
          <Item onSelect={downloadDocument}>Download .ocad file</Item>
          <Item onSelect={() => void openDocumentFile()}>Open .ocad file…</Item>
          <Sep />
          <Item shortcut={`${mod}I`} onSelect={() => void importFile()}>
            Import…
          </Item>
          <Sub label="Export">
            {EXPORT_FORMATS.map((f) => (
              <Item key={f.id} onSelect={() => void exportAs(f.id)}>
                {f.label}
              </Item>
            ))}
          </Sub>
          <Sub label="Export selected">
            {EXPORT_FORMATS.map((f) => (
              <Item key={f.id} onSelect={() => void exportAs(f.id, true)}>
                {f.label}
              </Item>
            ))}
          </Sub>
        </Menu>
        <Menu label="Edit">
          <Item shortcut={`${mod}Z`} onSelect={s.undo}>
            Undo
          </Item>
          <Item shortcut={isMac ? '⇧⌘Z' : 'Ctrl+Y'} onSelect={s.redo}>
            Redo
          </Item>
          <Sep />
          <Item shortcut={`${mod}D`} onSelect={duplicateSelection}>
            Duplicate
          </Item>
          <Item shortcut="Del" onSelect={deleteSelection} danger>
            Delete
          </Item>
          <Sep />
          <Item shortcut={`${mod}A`} onSelect={selectAll}>
            Select all
          </Item>
          <Item shortcut="Esc" onSelect={() => s.select(null)}>
            Clear selection
          </Item>
          <Sep />
          <Item shortcut="H" onSelect={() => hideSelection(true)}>
            Hide selected
          </Item>
          <Item shortcut="Shift+H" onSelect={showAllParts}>
            Show all
          </Item>
          <Sep />
          <Sub label="Interaction style">
            <Item onSelect={() => s.setPref('interaction', 'tinkercad')}>{s.prefs.interaction === 'tinkercad' ? '✓ ' : ''}Tinkercad</Item>
            <Item onSelect={() => s.setPref('interaction', 'pro')}>{s.prefs.interaction === 'pro' ? '✓ ' : ''}Pro (Onshape / Fusion)</Item>
          </Sub>
          <Item shortcut={`${mod},`} onSelect={() => s.setModal('settings')}>
            Preferences…
          </Item>
        </Menu>
        <Menu label="View">
          <Item shortcut="F" onSelect={() => viewApi.fitAll()}>
            Fit all
          </Item>
          <Sub label="Standard views">
            {VIEWS.map(([id, label]) => (
              <Item key={id} onSelect={() => viewApi.setView(id)}>
                {label}
              </Item>
            ))}
          </Sub>
          <Sub label="Projection">
            <Item onSelect={() => s.setPref('projection', 'perspective')}>{s.prefs.projection === 'perspective' ? '✓ ' : ''}Perspective</Item>
            <Item onSelect={() => s.setPref('projection', 'orthographic')}>{s.prefs.projection === 'orthographic' ? '✓ ' : ''}Orthographic</Item>
          </Sub>
          <Sub label="Display">
            {DISPLAYS.map(([id, label]) => (
              <Item key={id} onSelect={() => s.setPref('display', id)}>
                {s.prefs.display === id ? '✓ ' : ''}
                {label}
              </Item>
            ))}
          </Sub>
          <Item shortcut="G" onSelect={() => s.setPref('grid', !s.prefs.grid)}>
            {s.prefs.grid ? 'Hide grid' : 'Show grid'}
          </Item>
          <Sub label="Theme">
            {THEMES.map((t) => (
              <Item key={t.id} onSelect={() => s.setPref('theme', t.id)}>
                {s.prefs.theme === t.id ? '✓ ' : ''}
                {t.label}
              </Item>
            ))}
            <Sep />
            <Item onSelect={() => s.setPref('theme', 'system')}>{s.prefs.theme === 'system' ? '✓ ' : ''}Match system</Item>
          </Sub>
        </Menu>
        <Menu label="Insert">
          <Sub label="Shape">
            {PRIMITIVE_ORDER.map((k) => {
              const I = PRIMITIVE_ICONS[k];
              return (
                <Item key={k} onSelect={() => addPrimitive(k)}>
                  <I size={15} stroke={1.6} className="menu-icon" />
                  {PRIMITIVES[k].label}
                </Item>
              );
            })}
          </Sub>
          <Sep />
          <Item onSelect={() => startBoolean('union')}>Union</Item>
          <Item onSelect={() => startBoolean('subtract')}>Subtract</Item>
          <Item onSelect={() => startBoolean('intersect')}>Intersect</Item>
          <Sep />
          <Item onSelect={() => startEdgeFeature('fillet')}>Fillet</Item>
          <Item onSelect={() => startEdgeFeature('chamfer')}>Chamfer</Item>
          <Item onSelect={startShell}>Shell</Item>
          <Sep />
          <Item onSelect={() => startPartFeature('transform')}>Move / rotate</Item>
          <Item onSelect={() => startPartFeature('mirror')}>Mirror</Item>
          <Item onSelect={() => startPartFeature('linearPattern')}>Linear pattern</Item>
          <Item onSelect={() => startPartFeature('circularPattern')}>Circular pattern</Item>
          <Sep />
          <Item onSelect={() => void importFile()}>Import file…</Item>
        </Menu>
        <Menu label="Help">
          <Item shortcut="?" onSelect={() => s.setModal('shortcuts')}>
            Keyboard shortcuts
          </Item>
          <Item onSelect={() => s.setModal('about')}>About and roadmap</Item>
        </Menu>
      </Menubar.Root>
      <div className="menubar-center">
        <DocName />
        <SaveState />
      </div>
      <div className="menubar-right">
        <button className="icon-btn" title={scheme === 'dark' ? 'Switch to the light theme' : 'Switch to the dark theme'} onClick={() => s.setPref('theme', scheme === 'dark' ? 'light' : 'dark')}>
          {scheme === 'dark' ? <IconSun size={16} /> : <IconMoon size={16} />}
        </button>
        <button className="icon-btn" title={`Preferences (${mod},)`} aria-label="Preferences" onClick={() => s.setModal('settings')}>
          <IconSettings size={16} />
        </button>
        <AccountButton />
      </div>
    </header>
  );
}
