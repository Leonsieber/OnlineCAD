import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BufferGeometry, Mesh, Object3D } from 'three';
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from 'three-mesh-bvh';
import '@fontsource-variable/inter';
import './styles/app.css';
import { App } from './App';

// CAD convention: Z points up. Set before any camera or object is created.
Object3D.DEFAULT_UP.set(0, 0, 1);

// Fast raycasting for picking on large meshes. (Cast: drei ships older three-mesh-bvh typings.)
const proto = BufferGeometry.prototype as unknown as Record<string, unknown>;
proto.computeBoundsTree = computeBoundsTree;
proto.disposeBoundsTree = disposeBoundsTree;
Mesh.prototype.raycast = acceleratedRaycast;

// Dev-only handle for debugging and automated checks from the console.
if (import.meta.env.DEV) {
  void Promise.all([
    import('./store/store'),
    import('./app/actions'),
    import('./io/exporters'),
    import('./io/importers'),
    import('./kernel/client'),
    import('three'),
    import('./viewport/viewApi'),
    import('./viewport/registry'),
  ]).then(([store, actions, exporters, importers, client, three, view, registry]) => {
    (window as unknown as Record<string, unknown>).__oc = {
      ...store,
      actions,
      exporters,
      importers,
      kernel: client.kernel,
      THREE: three,
      viewApi: view.viewApi,
      viewRefs: registry.viewRefs,
    };
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
