import { useEffect, useMemo, useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { CanvasTexture, Euler, Mesh, MeshBasicMaterial, PlaneGeometry, Quaternion, SRGBColorSpace, Vector3 } from 'three';
import { IconHome } from '@tabler/icons-react';
import { useStore } from '../store/store';
import { cameraEvents, viewRefs } from './registry';
import { viewApi, type ViewName } from './viewApi';

const HALF = 27;

// Face placement for a Z-up world: the label's "up" points to +Z on side faces and +Y on top.
const FACES: { name: ViewName; label: string; pos: [number, number, number]; rot: [number, number, number] }[] = [
  { name: 'top', label: 'Top', pos: [0, 0, HALF], rot: [0, 0, 0] },
  { name: 'bottom', label: 'Bottom', pos: [0, 0, -HALF], rot: [Math.PI, 0, 0] },
  { name: 'front', label: 'Front', pos: [0, -HALF, 0], rot: [Math.PI / 2, 0, 0] },
  { name: 'back', label: 'Back', pos: [0, HALF, 0], rot: [Math.PI / 2, 0, Math.PI] },
  { name: 'right', label: 'Right', pos: [HALF, 0, 0], rot: [Math.PI / 2, 0, Math.PI / 2] },
  { name: 'left', label: 'Left', pos: [-HALF, 0, 0], rot: [Math.PI / 2, 0, -Math.PI / 2] },
];

function faceTexture(label: string, bg: string, fg: string, border: string) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = bg;
  g.fillRect(0, 0, 128, 128);
  g.strokeStyle = border;
  g.lineWidth = 6;
  g.strokeRect(3, 3, 122, 122);
  g.fillStyle = fg;
  g.font = '600 26px Inter, system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(label, 64, 66);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function CubeScene() {
  const theme = useStore((s) => s.resolvedTheme);
  const camera = useThree((s) => s.camera);
  const invalidate = useThree((s) => s.invalidate);
  const [hovered, setHovered] = useState<ViewName | null>(null);

  const meshes = useMemo(() => {
    const cs = getComputedStyle(document.documentElement);
    const v = (n: string) => cs.getPropertyValue(n).trim();
    const geo = new PlaneGeometry(HALF * 2, HALF * 2);
    return FACES.map((f) => {
      const mat = new MeshBasicMaterial({ map: faceTexture(f.label, v('--panel-2'), v('--text-2'), v('--border-strong')) });
      const m = new Mesh(geo, mat);
      m.position.set(...f.pos);
      m.quaternion.setFromEuler(new Euler(f.rot[0], f.rot[1], f.rot[2], 'ZXY'));
      m.userData.view = f.name;
      return m;
    });
  }, [theme]);

  useEffect(
    () => () => {
      for (const m of meshes) {
        (m.material as MeshBasicMaterial).map?.dispose();
        (m.material as MeshBasicMaterial).dispose();
      }
      meshes[0]?.geometry.dispose();
    },
    [meshes],
  );

  useEffect(() => {
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
    for (const m of meshes) (m.material as MeshBasicMaterial).color.set(m.userData.view === hovered ? accent : '#ffffff');
    invalidate();
  }, [hovered, meshes, invalidate]);

  // Mirror the main camera's orientation.
  useEffect(() => {
    const sync = () => {
      const main = viewRefs.camera;
      if (!main) return;
      const q = new Quaternion();
      main.getWorldQuaternion(q);
      camera.quaternion.copy(q);
      camera.position.copy(new Vector3(0, 0, 100).applyQuaternion(q));
      camera.updateMatrixWorld();
      invalidate();
    };
    cameraEvents.addEventListener('change', sync);
    sync();
    return () => cameraEvents.removeEventListener('change', sync);
  }, [camera, invalidate]);

  return (
    <group>
      {meshes.map((m) => (
        <primitive
          key={m.userData.view as string}
          object={m}
          onPointerOver={(e: { stopPropagation(): void }) => {
            e.stopPropagation();
            setHovered(m.userData.view as ViewName);
          }}
          onPointerOut={() => setHovered((h) => (h === m.userData.view ? null : h))}
          onClick={(e: { stopPropagation(): void }) => {
            e.stopPropagation();
            viewApi.setView(m.userData.view as ViewName);
          }}
        />
      ))}
    </group>
  );
}

export function ViewCube() {
  return (
    <div className="viewcube">
      <Canvas orthographic flat frameloop="demand" dpr={[1, 2]} camera={{ position: [0, 0, 100], zoom: 1, near: 1, far: 300 }} gl={{ alpha: true, antialias: true }}>
        <CubeScene />
      </Canvas>
      <button className="viewcube-home" title="Home view (isometric)" aria-label="Home view" onClick={() => viewApi.setView('iso')}>
        <IconHome size={14} stroke={1.8} />
      </button>
    </div>
  );
}
