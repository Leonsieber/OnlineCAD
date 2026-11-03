// The Realistic display mode: filmic tone mapping, a key light that casts shadows, and soft contact
// shadows under the parts. The other modes keep the flat, even lighting that suits modelling.
import { useEffect } from 'react';
import { ContactShadows } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { ACESFilmicToneMapping, NoToneMapping } from 'three';
import { useStore } from '../store/store';
import { viewRefs } from './registry';
import { partsBox } from './viewApi';

export function RealisticStage() {
  const display = useStore((s) => s.prefs.display);
  // Subscribing to parts re-renders this when they change, so the shadow follows them.
  useStore((s) => s.parts);
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const invalidate = useThree((s) => s.invalidate);
  const real = display === 'realistic';

  // Image export renders synchronously from here.
  useEffect(() => {
    viewRefs.renderer = gl;
    viewRefs.renderNow = () => gl.render(scene, camera);
  }, [gl, scene, camera]);

  useEffect(() => {
    gl.toneMapping = real ? ACESFilmicToneMapping : NoToneMapping;
    gl.toneMappingExposure = real ? 0.8 : 1;
    gl.shadowMap.enabled = real;
    scene.environmentIntensity = real ? 1.0 : 0.8;
    scene.traverse((o) => {
      const m = (o as { material?: { needsUpdate: boolean } }).material;
      if (m) m.needsUpdate = true;
    });
    invalidate();
  }, [real, gl, scene, invalidate]);

  if (!real) return null;
  const box = partsBox();
  if (box.isEmpty()) return null;
  const size = Math.max(box.max.x - box.min.x, box.max.y - box.min.y, 40);
  const cx = (box.min.x + box.max.x) / 2;
  const cy = (box.min.y + box.max.y) / 2;
  return (
    // ContactShadows lies in the XZ plane (Y up); turn it onto our Z-up ground, just under the parts.
    <group position={[cx, cy, Math.min(box.min.z, 0) - 0.02]} rotation={[Math.PI / 2, 0, 0]}>
      <ContactShadows scale={size * 2.2} resolution={1024} blur={2.4} far={size} opacity={0.55} color="#000000" />
    </group>
  );
}
