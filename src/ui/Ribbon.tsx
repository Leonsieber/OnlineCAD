import type { ReactNode } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import {
  IconAngle,
  IconArrowsMove,
  IconBorderRadius,
  IconBoxModel,
  IconChevronDown,
  IconCube,
  IconDeviceDesktop,
  IconEye,
  IconEyeOff,
  IconFileImport,
  IconFlipVertical,
  IconFocusCentered,
  IconGrid4x4,
  IconGridDots,
  IconLayersIntersect,
  IconLayersSubtract,
  IconLayersUnion,
  IconLine,
  IconMoon,
  IconPencil,
  IconPerspective,
  IconPerspectiveOff,
  IconRotate360,
  IconRulerMeasure,
  IconSquare,
  IconSun,
  IconBox,
  IconBoxMultiple,
  IconCircleDashed,
  IconSparkles,
  IconPrinter,
  IconFileText,
  IconBooks,
  IconCode,
  IconGrain,
  IconGridPattern,
  IconWaveSine,
  IconCirclePlus,
  IconCircleMinus,
  IconMinus,
  IconHandGrab,
  IconPhoto,
  IconArrowBarUp,
  IconArrowBarDown,
  IconRotateClockwise2,
  IconRoute,
  IconStack3,
  IconPalette,
  IconHandMove,
  IconAxisX,
  IconSettings,
  IconStack2,
  IconStackPop,
  type Icon,
} from '@tabler/icons-react';
import { consumeDragClick, startShapeDrag } from '../app/dragCreate';
import { PRIMITIVES, PRIMITIVE_ORDER } from '../model/defaults';
import type { PrimitiveKind } from '../model/types';
import { THEMES, themeDef } from './themes';
import { setBrush, useSculpt } from '../viewport/Sculpt';
import { togglePrintCheck, usePrintCheck } from '../viewport/PrintCheck';
import type { SculptBrush } from '../model/types';
import { toggleMeasure, useMeasure } from '../viewport/Measure';
import { useStore, type DisplayMode, type RibbonTab } from '../store/store';
import { viewApi, type ViewName } from '../viewport/viewApi';
import {
  addPrimitive,
  addScript,
  groupSelection,
  hideSelection,
  importFile,
  showAllParts,
  startBoolean,
  startEdgeFeature,
  startMeshEdit,
  startPartFeature,
  startShell,
  startSketch,
  startSketchFeature,
  ungroupSelection,
} from '../app/actions';
import { PRIMITIVE_ICONS } from './icons';

const TABS: { id: RibbonTab; label: string }[] = [
  { id: 'solid', label: 'Solid' },
  { id: 'sketch', label: 'Sketch' },
  { id: 'mesh', label: 'Mesh' },
  { id: 'inspect', label: 'Inspect' },
  { id: 'view', label: 'View' },
];

function Tool({
  icon: I,
  label,
  onClick,
  active,
  title,
  small,
  onPointerDown,
}: {
  icon: Icon;
  label: string;
  onClick: () => void;
  active?: boolean;
  title?: string;
  small?: boolean;
  onPointerDown?: (e: React.PointerEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      type="button"
      className={`tool${active ? ' on' : ''}${small ? ' small' : ''}${onPointerDown ? ' draggable' : ''}`}
      onClick={onClick}
      onPointerDown={onPointerDown}
      title={title ?? label}
    >
      <I size={small ? 16 : 21} stroke={1.6} />
      <span>{label}</span>
    </button>
  );
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rgroup">
      <div className="rgroup-tools">{children}</div>
      <div className="rgroup-label">{label}</div>
    </div>
  );
}

function MenuTool({ icon: I, label, items }: { icon: Icon; label: string; items: { icon: Icon; label: string; onSelect: () => void; hint?: string }[] }) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button type="button" className="tool" title={label}>
          <I size={21} stroke={1.6} />
          <span>
            {label}
            <IconChevronDown size={10} className="tool-caret" />
          </span>
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="menu" sideOffset={4} align="start">
          {items.map((it) => (
            <DropdownMenu.Item key={it.label} className="menu-item" onSelect={it.onSelect}>
              <it.icon size={16} stroke={1.6} />
              <span>{it.label}</span>
              {it.hint && <span className="menu-hint">{it.hint}</span>}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

const MAIN_SHAPES: PrimitiveKind[] = ['box', 'cylinder', 'sphere', 'cone', 'torus'];

function SolidTab() {
  const panel = useStore((s) => s.panel);
  const setPanel = useStore((s) => s.setPanel);
  const setModal = useStore((s) => s.setModal);
  const draft = useStore((s) => s.draft);
  const toast = useStore((s) => s.toast);
  const t = draft?.feature;
  const isPrim = (k: PrimitiveKind) => t?.type === 'primitive' && t.kind === k;
  const more = PRIMITIVE_ORDER.filter((k) => !MAIN_SHAPES.includes(k));
  return (
    <>
      <Group label="AI">
        <Tool icon={IconSparkles} label="Generate" active={panel === 'ai'} onClick={() => setPanel(panel === 'ai' ? null : 'ai')} title="Describe a part and let AI model it (Ctrl+K)" />
      </Group>
      <Group label="Sketch">
        <Tool icon={IconPencil} label="Sketch" active={t?.type === 'sketch'} onClick={() => startSketch()} title="New sketch: pick a plane or a flat face" />
        <Tool icon={IconArrowBarUp} label="Extrude" active={t?.type === 'extrude'} onClick={() => startSketchFeature('extrude')} title="Extrude a sketch into a solid, or cut with it" />
        <Tool icon={IconRotateClockwise2} label="Revolve" active={t?.type === 'revolve'} onClick={() => startSketchFeature('revolve')} title="Spin a sketch around an axis" />
      </Group>
      <Group label="Create · drag onto the plate">
        {MAIN_SHAPES.map((k) => (
          <Tool
            key={k}
            icon={PRIMITIVE_ICONS[k]}
            label={PRIMITIVES[k].label}
            active={isPrim(k)}
            title={`${PRIMITIVES[k].label}: drag it into the view, or click to add it in the middle`}
            onPointerDown={(e) => startShapeDrag(k, e)}
            onClick={() => !consumeDragClick() && addPrimitive(k)}
          />
        ))}
        <MenuTool icon={IconBoxMultiple} label="More" items={more.map((k) => ({ icon: PRIMITIVE_ICONS[k], label: PRIMITIVES[k].label, onSelect: () => addPrimitive(k) }))} />
      </Group>
      <Group label="Combine">
        <Tool icon={IconStack2} label="Group" onClick={groupSelection} title="Group (Ctrl+G): merge the selected parts; parts marked as holes are cut out" />
        <Tool icon={IconStackPop} label="Ungroup" onClick={ungroupSelection} title="Ungroup (Ctrl+Shift+G): split a group back into its parts" />
        <Tool icon={IconLayersUnion} label="Union" active={t?.type === 'boolean' && t.op === 'union'} onClick={() => startBoolean('union')} title="Union: merge parts into one" />
        <Tool icon={IconLayersSubtract} label="Subtract" active={t?.type === 'boolean' && t.op === 'subtract'} onClick={() => startBoolean('subtract')} title="Subtract: cut parts away" />
        <Tool icon={IconLayersIntersect} label="Intersect" active={t?.type === 'boolean' && t.op === 'intersect'} onClick={() => startBoolean('intersect')} title="Intersect: keep only the overlap" />
      </Group>
      <Group label="Modify">
        <Tool icon={IconBorderRadius} label="Fillet" active={t?.type === 'fillet'} onClick={() => startEdgeFeature('fillet')} title="Fillet: round edges" />
        <Tool icon={IconAngle} label="Chamfer" active={t?.type === 'chamfer'} onClick={() => startEdgeFeature('chamfer')} title="Chamfer: bevel edges" />
        <Tool icon={IconBoxModel} label="Shell" active={t?.type === 'shell'} onClick={startShell} title="Shell: hollow out a part" />
      </Group>
      <Group label="Transform">
        <Tool icon={IconArrowsMove} label="Move" active={t?.type === 'transform'} onClick={() => startPartFeature('transform')} title="Move, rotate, or scale parts precisely" />
        <Tool icon={IconFlipVertical} label="Mirror" active={t?.type === 'mirror'} onClick={() => startPartFeature('mirror')} />
        <MenuTool
          icon={IconGridDots}
          label="Pattern"
          items={[
            { icon: IconGridDots, label: 'Linear pattern', onSelect: () => startPartFeature('linearPattern') },
            { icon: IconRotate360, label: 'Circular pattern', onSelect: () => startPartFeature('circularPattern') },
          ]}
        />
      </Group>
      <Group label="Insert">
        <Tool icon={IconBooks} label="Library" onClick={() => setModal('library')} title="Parts library: bolts, nuts, gears, springs, boxes" />
        <Tool icon={IconCode} label="Script" active={t?.type === 'script' && !t.library} onClick={() => addScript()} title="Build a part with JavaScript code" />
        <Tool icon={IconFileImport} label="Import" onClick={() => void importFile()} title="Import STEP, STL, OBJ, PLY, GLB, 3MF, or OFF" />
      </Group>
    </>
  );
}

function Placeholder({ title, text, children }: { title: string; text: string; children?: ReactNode }) {
  return (
    <div className="ribbon-placeholder">
      <IconSparkles size={22} stroke={1.5} />
      <div>
        <div className="ph-title">{title}</div>
        <div className="ph-text">{text}</div>
      </div>
      {children}
    </div>
  );
}

function InspectTab() {
  const measuring = useMeasure((m) => m.active);
  const printing = usePrintCheck((m) => m.active);
  const setModal = useStore((s) => s.setModal);
  const filter = useStore((s) => s.filter);
  const setFilter = useStore((s) => s.setFilter);
  const toast = useStore((s) => s.toast);
  return (
    <>
      <Group label="Select">
        <Tool icon={IconBox} label="Parts" active={filter === 'part'} onClick={() => setFilter('part')} />
        <Tool icon={IconSquare} label="Faces" active={filter === 'face'} onClick={() => setFilter('face')} />
        <Tool icon={IconLine} label="Edges" active={filter === 'edge'} onClick={() => setFilter('edge')} />
      </Group>
      <Group label="Visibility">
        <Tool icon={IconEyeOff} label="Hide" onClick={() => hideSelection(true)} title="Hide selected parts" />
        <Tool icon={IconEye} label="Show all" onClick={showAllParts} />
      </Group>
      <Group label="Measure">
        <Tool icon={IconRulerMeasure} label="Measure" active={measuring} onClick={() => toggleMeasure()} title="Measure: click two points (corners, edge middles, and face centers snap). Esc stops." />
      </Group>
      <Group label="Manufacture">
        <Tool icon={IconPrinter} label="Print check" active={printing} onClick={() => togglePrintCheck()} title="3D-print check: overhangs, build volume, filament estimate" />
        <Tool icon={IconFileText} label="2D drawing" onClick={() => setModal('drawing')} title="Technical drawing with front, top, right, and iso views (SVG or PDF)" />
      </Group>
    </>
  );
}

const DISPLAY: { id: DisplayMode; label: string; icon: Icon }[] = [
  { id: 'shadedEdges', label: 'Shaded + edges', icon: IconCube },
  { id: 'shaded', label: 'Shaded', icon: IconBox },
  { id: 'wireframe', label: 'Wireframe', icon: IconCircleDashed },
  { id: 'xray', label: 'X-ray', icon: IconBoxModel },
  { id: 'realistic', label: 'Realistic', icon: IconSparkles },
];

const VIEWS: { id: ViewName; label: string }[] = [
  { id: 'iso', label: 'Iso' },
  { id: 'front', label: 'Front' },
  { id: 'top', label: 'Top' },
  { id: 'right', label: 'Right' },
  { id: 'back', label: 'Back' },
  { id: 'left', label: 'Left' },
  { id: 'bottom', label: 'Bottom' },
];

const BRUSHES: { id: SculptBrush; label: string; icon: Icon; title: string }[] = [
  { id: 'inflate', label: 'Inflate', icon: IconCirclePlus, title: 'Push the surface outward' },
  { id: 'deflate', label: 'Deflate', icon: IconCircleMinus, title: 'Push the surface inward' },
  { id: 'smooth', label: 'Smooth', icon: IconWaveSine, title: 'Even out bumps' },
  { id: 'flatten', label: 'Flatten', icon: IconMinus, title: 'Flatten toward the first point of the stroke' },
  { id: 'grab', label: 'Grab', icon: IconHandGrab, title: 'Drag a region of the surface' },
];

function MeshTab() {
  const draft = useStore((s) => s.draft);
  const t = draft?.feature;
  const sculpt = useSculpt();
  return (
    <>
      <Group label="Prepare">
        <Tool icon={IconGrain} label="To mesh" active={t?.type === 'meshEdit' && t.op === 'toMesh'} onClick={() => startMeshEdit('toMesh')} title="Turn solids into triangle meshes" />
        <Tool icon={IconGridPattern} label="Subdivide" active={t?.type === 'meshEdit' && t.op === 'subdivide'} onClick={() => startMeshEdit('subdivide')} title="Split triangles and round the shape" />
        <Tool icon={IconWaveSine} label="Smooth" active={t?.type === 'meshEdit' && t.op === 'smooth'} onClick={() => startMeshEdit('smooth')} title="Smooth the whole part" />
      </Group>
      <Group label="Sculpt · drag over a part">
        {BRUSHES.map((b) => (
          <Tool key={b.id} icon={b.icon} label={b.label} active={sculpt.brush === b.id} onClick={() => setBrush(b.id)} title={`${b.title}. Esc stops, [ and ] change the size.`} />
        ))}
      </Group>
      <Group label="Brush">
        <div className="brush-sliders">
          <label>
            Size <input type="range" min={0.5} max={60} step={0.5} value={sculpt.radius} onChange={(e) => useSculpt.setState({ radius: Number(e.target.value) })} />
            <span>{sculpt.radius} mm</span>
          </label>
          <label>
            Strength <input type="range" min={0.05} max={1} step={0.05} value={sculpt.strength} onChange={(e) => useSculpt.setState({ strength: Number(e.target.value) })} />
            <span>{Math.round(sculpt.strength * 100)}%</span>
          </label>
        </div>
      </Group>
      <Group label="Insert">
        <Tool icon={IconFileImport} label="Import mesh" onClick={() => void importFile()} title="Import STL, OBJ, GLB, 3MF, PLY, or OFF" />
      </Group>
    </>
  );
}

function SketchTab() {
  const draft = useStore((s) => s.draft);
  const t = draft?.feature;
  return (
    <>
      <Group label="New sketch">
        <Tool icon={IconPencil} label="On a face" active={t?.type === 'sketch' && draft?.field === 'faces'} onClick={() => startSketch()} title="Pick a plane or click a flat face" />
        <Tool icon={IconSquare} label="Top" onClick={() => startSketch('XY')} title="Sketch on the top (XY) plane" />
        <Tool icon={IconSquare} label="Front" onClick={() => startSketch('XZ')} title="Sketch on the front (XZ) plane" />
        <Tool icon={IconSquare} label="Right" onClick={() => startSketch('YZ')} title="Sketch on the right (YZ) plane" />
      </Group>
      <Group label="Make solids">
        <Tool icon={IconArrowBarUp} label="Extrude" active={t?.type === 'extrude' && t.op !== 'cut'} onClick={() => startSketchFeature('extrude')} title="Pull a sketch into a solid" />
        <Tool icon={IconArrowBarDown} label="Cut" active={t?.type === 'extrude' && t.op === 'cut'} onClick={() => startSketchFeature('extrude', 'cut')} title="Cut a sketch's shape out of parts" />
        <Tool icon={IconRotateClockwise2} label="Revolve" active={t?.type === 'revolve'} onClick={() => startSketchFeature('revolve')} title="Spin a sketch around an axis" />
        <Tool icon={IconRoute} label="Sweep" active={t?.type === 'sweep'} onClick={() => startSketchFeature('sweep')} title="Move a profile along a path" />
        <Tool icon={IconStack3} label="Loft" active={t?.type === 'loft'} onClick={() => startSketchFeature('loft')} title="Blend between two or more profiles" />
      </Group>
    </>
  );
}

function ViewTab() {
  const prefs = useStore((s) => s.prefs);
  const setPref = useStore((s) => s.setPref);
  const setModal = useStore((s) => s.setModal);
  return (
    <>
      <Group label="Camera">
        <Tool icon={IconFocusCentered} label="Fit all" onClick={() => viewApi.fitAll()} title="Fit all (F)" />
        <Tool
          icon={prefs.projection === 'perspective' ? IconPerspective : IconPerspectiveOff}
          label={prefs.projection === 'perspective' ? 'Perspective' : 'Orthographic'}
          onClick={() => setPref('projection', prefs.projection === 'perspective' ? 'orthographic' : 'perspective')}
          title="Switch between perspective and orthographic"
        />
      </Group>
      <Group label="Standard views">
        <div className="view-grid">
          {VIEWS.map((v) => (
            <button key={v.id} type="button" className="mini" onClick={() => viewApi.setView(v.id)}>
              {v.label}
            </button>
          ))}
        </div>
      </Group>
      <Group label="Display">
        {DISPLAY.map((d) => (
          <Tool key={d.id} icon={d.icon} label={d.label} active={prefs.display === d.id} onClick={() => setPref('display', d.id)} />
        ))}
        <Tool icon={IconGrid4x4} label="Grid" active={prefs.grid} onClick={() => setPref('grid', !prefs.grid)} />
        <Tool icon={IconPhoto} label="Save image" onClick={() => viewApi.saveImage()} title="Save the view as a PNG image (twice the screen resolution)" />
      </Group>
      <Group label="Theme">
        <MenuTool
          icon={IconPalette}
          label={prefs.theme === 'system' ? 'System' : themeDef(prefs.theme).label}
          items={[
            ...THEMES.map((t) => ({ icon: t.scheme === 'light' ? IconSun : IconMoon, label: t.label, onSelect: () => setPref('theme', t.id) })),
            { icon: IconDeviceDesktop, label: 'Match system', onSelect: () => setPref('theme', 'system') },
          ]}
        />
      </Group>
      <Group label="Interaction">
        <Tool icon={IconHandMove} label="Tinkercad" active={prefs.interaction === 'tinkercad'} onClick={() => setPref('interaction', 'tinkercad')} title="Tinkercad style: drag parts, handles, rotate arcs" />
        <Tool icon={IconAxisX} label="Pro" active={prefs.interaction === 'pro'} onClick={() => setPref('interaction', 'pro')} title="Pro style (Onshape / Fusion): move arrows and rotate rings" />
        <Tool icon={IconSettings} label="Preferences" onClick={() => setModal('settings')} title="Preferences (Ctrl+,)" />
      </Group>
    </>
  );
}

export function Ribbon() {
  const tab = useStore((s) => s.tab);
  const setTab = useStore((s) => s.setTab);
  return (
    <div className="ribbon">
      <div className="ribbon-tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      <div
        className="ribbon-body"
        onWheel={(e) => {
          // In narrow windows the ribbon scrolls sideways; let a normal mouse wheel do that.
          if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) e.currentTarget.scrollLeft += e.deltaY;
        }}
      >
        {tab === 'solid' && <SolidTab />}
        {tab === 'sketch' && <SketchTab />}
        {tab === 'mesh' && <MeshTab />}
        {tab === 'inspect' && <InspectTab />}
        {tab === 'view' && <ViewTab />}
      </div>
    </div>
  );
}
