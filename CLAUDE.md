# OnlineCAD

Context for Claude sessions working on this repo: the goal, the decisions made so far, and how the code fits together. `README.md` has the user-facing feature list.

## Goal

The user wants "the ultimate" 3D CAD modeller, in the browser and as a desktop app, one that everybody would choose:

- Tinkercad: drag in ready-made shapes and change them
- Onshape: sketch on planes, extrude and cut, fillet and chamfer edges, a feature history
- Blender: mesh editing
- "As crazy as possible but also very intuitive", with a nice UI and dark mode
- Sign-in (Google or our own accounts), completely free hosting, as many 3D file formats as possible

## Decisions already made

- **Layout A, the pro ribbon** (Onshape/Fusion style). The user picked it over Claude's recommendation (B), so build on it.
- **Stack:** React 19, TypeScript 7, Vite 8, three.js 0.187 through @react-three/fiber and drei, zustand for state, and OpenCascade compiled to WASM (replicad) in a web worker, called through comlink.
- **Hosting:** Cloudflare Pages for the app plus Supabase for sign-in and storage. Both are $0 with no card. The user has to create those accounts; Claude can't.
- **Desktop:** a PWA first, then Electron. Electron rather than Tauri because the first PC had no Rust toolchain.

## Status

- Milestone 1 (core modelling) is done, plus Tinkercad-style editing: resize handles, dragging shapes from the ribbon, Hole/Solid, Group/Ungroup, and drag arrows for fillet, chamfer, and shell. All of it was checked in the browser with real mouse drags.
- Next is milestone 2: sketches with constraints; extrude, revolve, sweep, loft; a measure tool. Start it when the user asks.
- After that: 3 mesh editing, subdivision, sculpting, materials, rendering; 4 sign-in, cloud saves, sharing, deployment, desktop installer; 5 2D drawings, 3D-print checks, assemblies, a parts library, scripting, live collaboration.

## Working with the user

- Post short progress updates in chat (done, problem, next) after each finished step, and straight away when something isn't going to plan. They prefer updates in chat over a document or website.
- Check features in the running app (browser preview) with real clicks and drags, not just with the type checker.
- Commit and push only when asked.

## Run and check

- `npm install`, then `npm run dev` (http://localhost:5173; the port is fixed). `npm run typecheck` and `npm run build` should both pass before you call something done. Developed on Node 24.
- `.claude/launch.json` has the `onlinecad-dev` config for the browser preview.
- Dev builds put `window.__oc` on the page: the store's state and functions, plus `actions`, `exporters`, `importers`, `kernel`, `THREE`, `viewApi`, and `viewRefs`. Use it for scripted checks. Don't `import()` modules from the page: with hot reload that loads a second copy of the module.
- If hot reload breaks mid-edit (for example "X is not defined"), do a full page reload.
- The OpenCascade WASM is about 22 MB (7 MB gzipped), so the first load takes a few seconds.

## Code map

| Path | What's there |
| --- | --- |
| `src/model` | Document types, formulas, shape defaults and sizes, the example bracket |
| `src/kernel` | The geometry worker: shapes, features, fingerprints, meshing, export |
| `src/store` | App state, undo, selection, committing moves and resizes |
| `src/viewport` | three.js scene, picking, handles, drag arrows, gizmo, view cube |
| `src/ui` | Menu bar, ribbon, history and parts panel, properties, timeline, dialogs |
| `src/app` | Actions, keyboard shortcuts, dragging shapes from the ribbon |
| `src/io` | Import, export, browser storage |

Files you'll touch most: `src/kernel/geometry.ts` (shapes, fingerprints, fillet direction), `src/kernel/evaluate.ts` (rebuild and cache), `src/store/store.ts` (`commitMove`, `commitResize`), `src/store/resize.ts` (how a stretch reaches the shapes), `src/viewport/handles.tsx`, `src/viewport/ResizeHandles.tsx`, and `src/viewport/ValueArrows.tsx`.

## How the model works

- A document is a list of features (primitive, boolean, fillet, chamfer, shell, transform, mirror, linear and circular pattern, import, delete) plus parts, variables, and a rollback index. See `src/model/types.ts`.
- The worker rebuilds the features in order and caches each one by a hash of everything before it, so an edit only rebuilds from that feature on.
- Every number field takes a formula: variables, units (mm, cm, m, in, ft, deg, rad), and trig in degrees (`src/model/expr.ts`).
- Z is up. A placement's rotation is ZYX Euler angles in degrees (R = Rz·Ry·Rx). `placement.scale` is an optional stretch along the shape's own axes.
- Edges and faces are referenced by geometric fingerprints, not by topology IDs:
  - Edge (14 numbers): midpoint, start, end, length, curve type code, fillet direction.
  - Face (8 numbers): center, normal, area, surface type code.
  - Matching adds a 1e6 penalty when the type differs and skips seam edges. This is the weak spot: a big change in topology can move a reference to the wrong edge.
- `UserError` shows as an error. `IncompleteError` (input still missing, such as no edges picked yet) shows as an info banner. Warnings keep a feature working but flag it, for example a subtract that cuts nothing.

## Resizing and handles

- A single shape gets handles along its own axes. Groups and other parts use the world bounding box.
- This OpenCascade build can't stretch an arbitrary solid, so a stretch is passed down to the shapes that built the part, through booleans, fillets, chamfers, and shells (`src/store/resize.ts`). That only works when each shape's axes line up with the frame's axes, in any order or sign.
  - Cylinders become elliptical, spheres become ellipsoids, and a torus ring stays round in X and Y.
  - Meshes stretch through the transform's `stretch` field.
  - STEP imports, copies, mirrors, and patterns only scale evenly, and a toast says why.
- Fillet direction: a face's material lies to the left of its oriented edges, so `cross(n1, t1) · n2 < 0` means a convex edge. The arrow points into the material on convex edges and into the open air on concave ones (`filletDirection` in `src/kernel/geometry.ts`).
- Handles catch pointer presses before the camera controls do (`src/viewport/handles.tsx`), so dragging a handle never orbits the view. Handles are sized in screen pixels. During a drag, `src/viewport/liveMove.ts` shows a preview transform and holds it until the rebuild for that edit arrives.

## OpenCascade (replicad) gotchas

- translate, rotate, scale, and mirror delete the shape they're called on, so clone it first. fuse, cut, and intersect don't.
- Failures throw a `WebAssembly.Exception` you can catch; `describeError` turns it into a message.
- `faceGroups[].faceId` is the face's hashCode. In meshed edges, `edgeGroups` start and count are in vertices.
- `sketchOnPlane('XZ')` extrudes toward −Y.
- The torus is built with `new oc.BRepPrimAPI_MakeTorus(R, r)`.
- Missing from this build: MakeCone, MakeWedge, IGES, BRepBuilderAPI_GTransform, NurbsConvert, the BRepTools modifiers, and BRepClass3d_SolidClassifier. Cones are revolved or lofted instead, and a wedge is a drawn profile, extruded.

## Known limits

- Drag arrows act on the first selected edge only.
- The subtract warning names parts by their internal label (such as "Base"), not the name in the Parts list.
- Handles hide during move, lift, and rotate drags.
