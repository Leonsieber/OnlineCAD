// The projects dashboard: the first screen, listing documents saved in this browser.
// It sits over the editor, which stays mounted so opening a project is instant.
import { useEffect, useMemo, useRef, useState } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import {
  IconArrowsSort,
  IconBook,
  IconBox,
  IconCopy,
  IconCloud,
  IconCube,
  IconDots,
  IconDownload,
  IconFileImport,
  IconLayoutGrid,
  IconMoon,
  IconPencil,
  IconPlus,
  IconSearch,
  IconSettings,
  IconSparkles,
  IconSun,
  IconTemplate,
  IconTrash,
  IconUser,
  IconX,
} from '@tabler/icons-react';
import { deleteDoc, duplicateStoredDoc, listDocs, loadDoc, renameStoredDoc, type DocMeta } from '../io/storage';
import { download, safeFileName } from '../io/files';
import { freshId, useStore } from '../store/store';
import { importAsNewProject, newProject, openCloudProject, openExample, openProject, openDocumentFile } from '../app/actions';
import { deleteFromCloud, listCloud, useCloud, type CloudMeta } from '../cloud/cloud';
import { PRIMITIVE_ICONS } from './icons';
import type { PrimitiveKind } from '../model/types';
import { themeDef } from './themes';

type Section = 'projects' | 'templates' | 'learn';
type Sort = 'modified' | 'created' | 'name';

const SORTS: { id: Sort; label: string }[] = [
  { id: 'modified', label: 'Last modified' },
  { id: 'created', label: 'Date created' },
  { id: 'name', label: 'Name' },
];

function timeAgo(t: number) {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 86400 * 7) return `${Math.round(s / 86400)} d ago`;
  return new Date(t).toLocaleDateString();
}

/** A project in the list: saved in this browser, in the cloud, or both. */
type ProjectMeta = DocMeta & { cloud?: 'synced' | 'only' };

/** Browser projects first-class; cloud projects saved elsewhere join the list. */
async function listProjects(): Promise<ProjectMeta[]> {
  const local = await listDocs();
  const cloud = await listCloud().catch(() => [] as CloudMeta[]);
  const inCloud = new Set(cloud.map((c) => c.id));
  const localIds = new Set(local.map((d) => d.id));
  return [
    ...local.map((d) => ({ ...d, ...(inCloud.has(d.id) && { cloud: 'synced' as const }) })),
    ...cloud.filter((c) => !localIds.has(c.id)).map((c) => ({ id: c.id, name: c.name, thumb: c.thumb, features: c.features, created: c.created, modified: c.modified, cloud: 'only' as const })),
  ];
}

const STARTER_SHAPES: PrimitiveKind[] = ['box', 'cylinder', 'sphere', 'torus', 'cone', 'tube'];

export function Home() {
  const screen = useStore((s) => s.screen);
  const [section, setSection] = useState<Section>('projects');
  const [docs, setDocs] = useState<ProjectMeta[] | null>(null);
  const user = useCloud((c) => c.user);
  const refresh = () => void listProjects().then(setDocs);
  // Reload the list each time the dashboard is shown (or the user signs in), so it reflects what was just saved.
  useEffect(() => {
    if (screen === 'home') refresh();
  }, [screen, user]);
  if (screen !== 'home') return null;
  return (
    <div className="home" role="main">
      <HomeSidebar section={section} setSection={setSection} />
      <div className="home-main">
        {section === 'projects' && <Projects docs={docs} refresh={refresh} onTemplates={() => setSection('templates')} />}
        {section === 'templates' && <Templates />}
        {section === 'learn' && <Learn />}
      </div>
    </div>
  );
}

function HomeSidebar({ section, setSection }: { section: Section; setSection: (s: Section) => void }) {
  const setModal = useStore((s) => s.setModal);
  const theme = useStore((s) => s.resolvedTheme);
  const setPref = useStore((s) => s.setPref);
  const user = useCloud((c) => c.user);
  const dark = themeDef(theme).scheme === 'dark';
  const nav: { id: Section; label: string; icon: typeof IconBox }[] = [
    { id: 'projects', label: 'Projects', icon: IconLayoutGrid },
    { id: 'templates', label: 'Templates', icon: IconTemplate },
    { id: 'learn', label: 'Learn', icon: IconBook },
  ];
  return (
    <aside className="home-side">
      <div className="home-brand">
        <img src="/favicon.svg" alt="" width={22} height={22} />
        <span>OnlineCAD</span>
      </div>
      <nav className="home-nav">
        {nav.map((n) => (
          <button key={n.id} className={section === n.id ? 'on' : ''} onClick={() => setSection(n.id)}>
            <n.icon size={17} stroke={1.6} />
            {n.label}
          </button>
        ))}
      </nav>
      <div className="home-side-label">Storage</div>
      <div className="home-storage">
        <span className="dot" /> This browser
      </div>
      {user && (
        <div className="home-storage">
          <span className="dot cloud" /> Cloud ({user.email})
        </div>
      )}
      <div className="home-side-foot">
        <button className="home-account" onClick={() => setModal('account')}>
          <IconUser size={15} /> {user ? (user.email ?? 'Account').split('@')[0] : 'Sign in'}
        </button>
        <button className="icon-btn" title={dark ? 'Light theme' : 'Dark theme'} onClick={() => setPref('theme', dark ? 'light' : 'dark')}>
          {dark ? <IconSun size={16} /> : <IconMoon size={16} />}
        </button>
        <button className="icon-btn" title="Preferences" aria-label="Preferences" onClick={() => setModal('settings')}>
          <IconSettings size={16} />
        </button>
      </div>
    </aside>
  );
}

function Projects({ docs, refresh, onTemplates }: { docs: ProjectMeta[] | null; refresh: () => void; onTemplates: () => void }) {
  const [sort, setSort] = useState<Sort>(() => (localStorage.getItem('onlinecad.homeSort') as Sort) || 'modified');
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = (docs ?? []).filter((d) => !q || d.name.toLowerCase().includes(q));
    return [...list].sort((a, b) => (sort === 'name' ? a.name.localeCompare(b.name) : sort === 'created' ? b.created - a.created : b.modified - a.modified));
  }, [docs, sort, query]);
  const pickSort = (s: Sort) => {
    setSort(s);
    try {
      localStorage.setItem('onlinecad.homeSort', s);
    } catch {
      // storage unavailable: the choice just isn't remembered
    }
  };
  return (
    <>
      <header className="home-head">
        <h1>Projects</h1>
        <div className="home-actions">
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button className="home-btn ghost">
                <IconArrowsSort size={15} /> {SORTS.find((s) => s.id === sort)?.label}
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content className="menu" align="end" sideOffset={4}>
                {SORTS.map((s) => (
                  <DropdownMenu.Item key={s.id} className="menu-item" onSelect={() => pickSort(s.id)}>
                    <span>
                      {sort === s.id ? '✓ ' : ''}
                      {s.label}
                    </span>
                  </DropdownMenu.Item>
                ))}
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
          {searching ? (
            <div className="home-search">
              <IconSearch size={15} />
              <input
                ref={searchRef}
                autoFocus
                value={query}
                placeholder="Search projects"
                aria-label="Search projects"
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Escape' && (setQuery(''), setSearching(false))}
              />
              <button className="icon-btn sm" aria-label="Close search" onClick={() => (setQuery(''), setSearching(false))}>
                <IconX size={14} />
              </button>
            </div>
          ) : (
            <button className="home-btn ghost square" title="Search" aria-label="Search projects" onClick={() => setSearching(true)}>
              <IconSearch size={15} />
            </button>
          )}
          <button className="home-btn ghost" onClick={() => void openDocumentFile()} title="Open an .ocad file, or import STEP, STL, OBJ, and more as a new project">
            <IconFileImport size={15} /> Open file
          </button>
          <button className="home-btn primary" onClick={() => void newProject()}>
            <IconPlus size={16} /> New
          </button>
        </div>
      </header>

      {docs !== null && docs.length === 0 ? (
        <div className="home-empty">
          <IconCube size={44} stroke={1.1} />
          <h2>No projects here yet</h2>
          <p>Start a new project, open a template, or drop a STEP or STL file here. Everything you make is saved in this browser.</p>
          <div className="home-empty-actions">
            <button className="home-btn primary" onClick={() => void newProject()}>
              New project
            </button>
            <button className="home-btn ghost" onClick={onTemplates}>
              Browse templates
            </button>
          </div>
        </div>
      ) : (
        <div className="project-grid">
          {docs === null && <div className="muted">Loading…</div>}
          {shown.map((d) => (
            <ProjectCard key={d.id} d={d} refresh={refresh} />
          ))}
          {docs !== null && !shown.length && <div className="muted">No projects match "{query}".</div>}
        </div>
      )}
      <DropZone />
    </>
  );
}

function ProjectCard({ d, refresh }: { d: ProjectMeta; refresh: () => void }) {
  const open = () => void (d.cloud === 'only' ? openCloudProject(d.id) : openProject(d.id));
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(d.name);
  const toast = useStore((s) => s.toast);
  const finishRename = async () => {
    setRenaming(false);
    const n = name.trim();
    if (n && n !== d.name) {
      await renameStoredDoc(d.id, n);
      refresh();
    } else setName(d.name);
  };
  return (
    <div className="project-card">
      <button className="project-open" onClick={() => !renaming && open()} aria-label={`Open ${d.name}`}>
        <div className="project-thumb">{d.thumb ? <img src={d.thumb} alt="" /> : <IconCube size={34} stroke={1.1} />}</div>
      </button>
      <div className="project-info">
        {renaming ? (
          <input
            className="project-rename"
            autoFocus
            value={name}
            aria-label="Project name"
            onChange={(e) => setName(e.target.value)}
            onFocus={(e) => e.target.select()}
            onBlur={() => void finishRename()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void finishRename();
              if (e.key === 'Escape') {
                setName(d.name);
                setRenaming(false);
              }
            }}
          />
        ) : (
          <div className="project-name" title={d.name}>
            {d.name}
          </div>
        )}
        <div className="project-meta">
          {d.cloud && <IconCloud size={12} className="cloud-badge" aria-label={d.cloud === 'only' ? 'In the cloud' : 'Synced'} />}
          {d.features} feature{d.features === 1 ? '' : 's'} · {timeAgo(d.modified)}
        </div>
      </div>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button className="icon-btn project-menu" aria-label={`Actions for ${d.name}`}>
            <IconDots size={16} />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content className="menu" align="end" sideOffset={4}>
            <DropdownMenu.Item className="menu-item" onSelect={open}>
              <span>Open</span>
            </DropdownMenu.Item>
            <DropdownMenu.Item className="menu-item" onSelect={() => setRenaming(true)}>
              <span>
                <IconPencil size={14} /> Rename
              </span>
            </DropdownMenu.Item>
            <DropdownMenu.Item
              className="menu-item"
              onSelect={async () => {
                await duplicateStoredDoc(d.id, freshId());
                refresh();
              }}
            >
              <span>
                <IconCopy size={14} /> Duplicate
              </span>
            </DropdownMenu.Item>
            <DropdownMenu.Item
              className="menu-item"
              onSelect={async () => {
                const doc = await loadDoc(d.id);
                if (doc) download(new Blob([JSON.stringify(doc)], { type: 'application/json' }), `${safeFileName(doc.name)}.ocad`);
              }}
            >
              <span>
                <IconDownload size={14} /> Download .ocad
              </span>
            </DropdownMenu.Item>
            <DropdownMenu.Separator className="menu-sep" />
            <DropdownMenu.Item
              className="menu-item danger"
              onSelect={async () => {
                if (!confirm(`Delete "${d.name}"? This can't be undone.`)) return;
                if (useStore.getState().doc.id === d.id) useStore.getState().newDoc();
                await deleteDoc(d.id);
                await deleteFromCloud(d.id).catch(() => undefined);
                toast(`Deleted "${d.name}"`);
                refresh();
              }}
            >
              <span>
                <IconTrash size={14} /> Delete
              </span>
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  );
}

/** Dropping a model file anywhere on the dashboard imports it as a new project. */
function DropZone() {
  const [over, setOver] = useState(false);
  useEffect(() => {
    const onOver = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes('Files')) return;
      e.preventDefault();
      setOver(true);
    };
    const onLeave = (e: DragEvent) => {
      if (!e.relatedTarget) setOver(false);
    };
    const onDrop = (e: DragEvent) => {
      const f = e.dataTransfer?.files[0];
      setOver(false);
      if (!f) return;
      e.preventDefault();
      void importAsNewProject(f);
    };
    window.addEventListener('dragover', onOver);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, []);
  return over ? (
    <div className="home-drop">
      <IconFileImport size={36} stroke={1.3} />
      Drop to import as a new project
    </div>
  ) : null;
}

function Templates() {
  return (
    <>
      <header className="home-head">
        <h1>Templates</h1>
      </header>
      <div className="section-label home-section">Start from</div>
      <div className="template-grid">
        <button className="template-card" onClick={() => void newProject()}>
          <IconPlus size={26} stroke={1.4} />
          <strong>Empty project</strong>
          <span>A blank plate</span>
        </button>
        <button className="template-card" onClick={() => void openExample()}>
          <IconCube size={26} stroke={1.4} />
          <strong>Mounting bracket</strong>
          <span>Fillets, holes, a pattern, and variables</span>
        </button>
        <button className="template-card ai" onClick={() => void newProject({ ai: true })}>
          <IconSparkles size={26} stroke={1.4} />
          <strong>Generate with AI</strong>
          <span>Describe a part and let Claude model it</span>
        </button>
      </div>
      <div className="section-label home-section">Start with a shape</div>
      <div className="template-grid small">
        {STARTER_SHAPES.map((k) => {
          const I = PRIMITIVE_ICONS[k];
          return (
            <button key={k} className="template-card" onClick={() => void newProject({ shape: k })}>
              <I size={24} stroke={1.4} />
              <strong>{k[0].toUpperCase() + k.slice(1)}</strong>
            </button>
          );
        })}
      </div>
    </>
  );
}

const LEARN: [string, string][] = [
  ['Place shapes', 'Drag a shape from the ribbon onto the plate or onto a face of another part.'],
  ['Move, resize, rotate', 'In the Tinkercad style, drag a part to move it, drag the white squares to resize, the cone to lift, and the colored arcs to rotate.'],
  ['Holes and groups', 'Mark a part as a Hole, select it with a solid, and press Ctrl+G to cut it out.'],
  ['Sketch and extrude', 'Open the Sketch tab, pick a plane or a flat face, draw a closed profile, then extrude or revolve it.'],
  ['Round and bevel edges', 'Pick Fillet or Chamfer, click edges, and drag the arrow to set the size.'],
  ['History', 'Every step is a feature in the history. Double-click one to change it, or drag the bar to roll back.'],
  ['Exact values', 'Every number field takes formulas and units: width / 2, 1 in, 30 deg.'],
  ['Export', 'File → Export saves STEP for other CAD tools, or STL and 3MF for 3D printing.'],
];

function Learn() {
  const setModal = useStore((s) => s.setModal);
  return (
    <>
      <header className="home-head">
        <h1>Learn</h1>
        <div className="home-actions">
          <button className="home-btn ghost" onClick={() => setModal('shortcuts')}>
            Keyboard shortcuts
          </button>
        </div>
      </header>
      <div className="learn-grid">
        {LEARN.map(([t, d], i) => (
          <div key={t} className="learn-card">
            <span className="learn-num">{i + 1}</span>
            <strong>{t}</strong>
            <p>{d}</p>
          </div>
        ))}
      </div>
    </>
  );
}
