# OnlineCAD

Parametric 3D modelling in the browser, with a pro ribbon layout. Solids are built by OpenCascade (FreeCAD's geometry kernel), compiled to WebAssembly and running in a web worker on your computer.

## Run it

```bash
npm install
npm run dev
```

Then open http://localhost:5173. `npm run build` makes a static site in `dist/` that any static host can serve.

## What works (milestone 1)

- 10 shapes: box, cylinder, sphere, cone, torus, tube, wedge, pyramid, prism, ellipsoid
- Union, subtract, intersect; fillet and chamfer on picked edges; shell (hollow) from picked faces
- Move and rotate with a gizmo (snapping), precise transform, mirror, linear and circular patterns, duplicate
- Feature history with edit, rename, suppress, delete, and a draggable rollback bar; timeline replay
- Variables and formulas in every number field (`width / 2`, `1 in`, `sin(30)`)
- Picking parts, faces, or edges with hover highlights; size, volume, area, and weight readouts
- Dark, light, and system themes; perspective and orthographic views; four display modes; view cube
- Import: STEP (as solids), STL, OBJ, PLY, GLB/glTF, 3MF, OFF (as meshes)
- Export: STEP, STL, 3MF, OBJ, PLY, GLB
- Undo/redo, autosave to the browser (IndexedDB), documents list, `.ocad` file download and open

## Layout

| Folder | Contents |
| --- | --- |
| `src/model` | Document types, expressions, feature defaults, example |
| `src/kernel` | Geometry worker (OpenCascade), rebuild cache, protocol |
| `src/store` | App state, undo, selection, drag-to-move logic |
| `src/viewport` | three.js scene, picking, gizmo, view cube |
| `src/ui` | Menu bar, ribbon, history tree, properties, timeline |
| `src/io` | Import, export, local storage |

## Roadmap

1. Core modelling (done)
2. Sketches with constraints; extrude, revolve, sweep, loft; measure tool
3. Mesh editing, subdivision, sculpting, materials, rendering
4. Sign-in (Google, GitHub, email), cloud saves, sharing, hosting on Cloudflare Pages + Supabase, desktop app
5. 2D drawings, 3D-print checks, assemblies, parts library, scripting, live collaboration
