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
  IconStack2,
  IconStackPop,
  type Icon,
} from '@tabler/icons-react';
import { consumeDragClick, startShapeDrag } from '../app/dragCreate';
import { PRIMITIVES, PRIMITIVE_ORDER } from '../model/defaults';
import type { PrimitiveKind } from '../model/types';
import { useStore, type DisplayMode, type RibbonTab } from '../store/store';
import { viewApi, type ViewName } from '../viewport/viewApi';
import {
  addPrimitive,
  groupSelection,
  hideSelection,
  importFile,
  ungroupSelection,
  showAllParts,
  startBoolean,
  startEdgeFeature,
  startPartFeature,
  startShell,
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
  const draft = useStore((s) => s.draft);
  const toast = useStore((s) => s.toast);
  const t = draft?.feature;
  const isPrim = (k: PrimitiveKind) => t?.type === 'primitive' && t.kind === k;
  const more = PRIMITIVE_ORDER.filter((k) => !MAIN_SHAPES.includes(k));
  return (
    <>
      <Group label="Sketch">
        <Tool icon={IconPencil} label="Sketch" onClick={() => toast('Sketches with constraints, extrude, and revolve arrive in milestone 2.')} />
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
        <Tool icon={IconRulerMeasure} label="Measure" onClick={() => toast('Select a part, face, or edge to see its size, area, and volume on the right. Point-to-point measuring arrives in milestone 2.')} />
      </Group>
    </>
  );
}

const DISPLAY: { id: DisplayMode; label: string; icon: Icon }[] = [
  { id: 'shadedEdges', label: 'Shaded + edges', icon: IconCube },
  { id: 'shaded', label: 'Shaded', icon: IconBox },
  { id: 'wireframe', label: 'Wireframe', icon: IconCircleDashed },
  { id: 'xray', label: 'X-ray', icon: IconBoxModel },
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

function ViewTab() {
  const prefs = useStore((s) => s.prefs);
  const setPref = useStore((s) => s.setPref);
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
      </Group>
      <Group label="Theme">
        <Tool icon={IconMoon} label="Dark" active={prefs.theme === 'dark'} onClick={() => setPref('theme', 'dark')} />
        <Tool icon={IconSun} label="Light" active={prefs.theme === 'light'} onClick={() => setPref('theme', 'light')} />
        <Tool icon={IconDeviceDesktop} label="System" active={prefs.theme === 'system'} onClick={() => setPref('theme', 'system')} />
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
        {tab === 'sketch' && (
          <Placeholder title="Sketching is next (milestone 2)" text="Draw on planes and faces with lines, arcs, and splines, add constraints and dimensions, then extrude, revolve, sweep, or loft.">
            <button className="btn" onClick={() => setTab('solid')}>
              Back to solid tools
            </button>
          </Placeholder>
        )}
        {tab === 'mesh' && (
          <Placeholder title="Mesh editing arrives in milestone 3" text="Vertex, edge, and face editing, subdivision, and sculpting. Until then, you can import STL, OBJ, GLB, 3MF, PLY, and OFF meshes.">
            <button className="btn" onClick={() => void importFile()}>
              <IconFileImport size={15} /> Import a mesh
            </button>
          </Placeholder>
        )}
        {tab === 'inspect' && <InspectTab />}
        {tab === 'view' && <ViewTab />}
      </div>
    </div>
  );
}
