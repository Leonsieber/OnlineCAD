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

- Done and checked in the browser: core modelling; Tinkercad and Pro interaction styles (Preferences); seven themes; the projects dashboard; sketches with constraints and dimensions; extrude, revolve, sweep, loft; measure; materials and the Realistic view; convert/subdivide/smooth/sculpt; scripting and the parts library; 3D-print check; 2D drawings; AI part generation (Claude by default, plus OpenAI-compatible providers); PWA; Electron app and Windows installer; Supabase sign-in, cloud saves, and share links (code done, not tested against a live Supabase project).
- Not done yet: assemblies with joints, live collaboration, direct vertex/face editing of meshes, sketch splines, sketches that follow the face they were drawn on.
- The user hosts it themselves: see HOSTING.md. The landing page is in `website/`.

## Working with the user

- Post short progress updates in chat (done, problem, next) after each finished step, and straight away when something isn't going to plan. They prefer updates in chat over a document or website.
- Check features in the running app (browser preview) with real clicks and drags, not just with the type checker.
- Commit and push only when asked.
- Build substantial features end to end, then report what was verified and what wasn't.

## Run and check

- `npm install`, then `npm run dev` (http://localhost:5173; the port is fixed). `npm run typecheck` and `npm run build` should both pass before you call something done. Developed on Node 24.
- `.claude/launch.json` has the `onlinecad-dev` config for the browser preview.
- Dev builds put `window.__oc` on the page: the store's state and functions, plus `actions`, `exporters`, `importers`, `kernel`, `THREE`, `viewApi`, and `viewRefs`. Use it for scripted checks. Don't `import()` modules from the page: with hot reload that loads a second copy of the module.
- If hot reload breaks mid-edit (for example "X is not defined"), do a full page reload.
- The OpenCascade WASM is about 22 MB (7 MB gzipped), so the first load takes a few seconds.
- `npm test` runs the unit tests (Vitest). `ONLINECAD_SMOKE=1 npx electron .` checks the desktop app boots and the geometry engine starts.
- The Vite dev server can cache a half-written file. Edit each file in one write; if the page shows "X is not defined" or a missing export that the file on disk does have, `touch` the file and reload.
- Vite 8 dropped an `import { value, type T }` line once when the same type was also re-exported; split value and type imports if an import goes missing.
- Don't name scratch Python scripts after standard modules (`types.py` shadowed the real one and re-ran an old edit). Run them with `python -I`.

## Code map

| Path | What's there |
| --- | --- |
| `src/model` | Document types, formulas, defaults, materials, parts library (`library.ts`), the example bracket |
| `src/kernel` | The geometry worker: shapes, features, fingerprints, meshing, export, `sketchSolids.ts`, `meshOps.ts`, `scriptApi.ts` |
| `src/sketch` | Constraint solver (`solver.ts`), profile detection (`profiles.ts`), sketch editing state (`sketchUi.ts`) |
| `src/store` | App state, undo, selection, committing moves and resizes |
| `src/viewport` | three.js scene, picking, handles, drag arrows, gizmo, view cube, `SketchEditor`, `Measure`, `Sculpt`, `PrintCheck`, `RealisticStage` |
| `src/ui` | Menu bar, ribbon, dashboard (`Home`), panels, dialogs, `SketchPanel`, `AiPanel`, `DrawingSheet`, themes |
| `src/app` | Actions, keyboard shortcuts, dragging shapes from the ribbon |
| `src/io` | Import, export, browser storage |
| `src/ai`, `src/cloud` | Text-to-CAD providers; Supabase sign-in and cloud projects |
| `electron`, `website`, `supabase` | Desktop app, landing page, database schema |

Files you'll touch most: `src/kernel/geometry.ts` (shapes, fingerprints, fillet direction), `src/kernel/evaluate.ts` (rebuild and cache), `src/store/store.ts` (`commitMove`, `commitResize`), `src/store/resize.ts` (how a stretch reaches the shapes), `src/viewport/handles.tsx`, `src/viewport/ResizeHandles.tsx`, and `src/viewport/ValueArrows.tsx`.

## How the model works

- A document is a list of features (primitive, boolean, fillet, chamfer, shell, transform, mirror, linear and circular pattern, import, delete, sketch, extrude, revolve, sweep, loft, meshEdit, sculpt, script) plus parts, variables, and a rollback index. See `src/model/types.ts`.
- Sketches add no parts. Later features find their sketch in the feature list and solve it again in the worker with the current variables. A sketch stores its frame; on a face, it does not follow the face afterwards.
- Sculpt strokes are stored in world coordinates on a `sculpt` feature and replayed in the worker. Scripts run in the worker with `cad` (replicad plus helpers) and `p` (parameters).
- The worker rebuilds the features in order and caches each one by a hash of everything before it, so an edit only rebuilds from that feature on.
- Every number field takes a formula: variables, units (mm, cm, m, in, ft, deg, rad), and trig in degrees (`src/model/expr.ts`).
- Z is up. A placement's rotation is ZYX Euler angles in degrees (R = Rz·Ry·Rx). `placement.scale` is an optional stretch along the shape's own axes.
- Edges and faces are referenced by geometric fingerprints, not by topology IDs:
  - Edge (14 numbers): midpoint, start, end, length, curve type code, fillet direction.
  - Face (8 numbers): center, normal, area, surface type code.
  - References also store the part's bounding box when picked. Matching tries "where it was picked" and "moved and stretched with the box", and keeps whichever fits all references best, so fillets and shells follow a part that is moved or resized (`matchRefs` in `src/kernel/geometry.ts`).
  - Matching adds a 1e6 penalty when the type differs and skips seam edges. A reference that only matches loosely (score over 0.2 × the part size) gives a warning. A big change in topology can still move a reference to the wrong edge, but it no longer happens silently.
- Status messages name parts with `partRef(id, label)` markers; the UI shows them through `statusText`, so they use the names from the Parts list.
- `UserError` shows as an error. `IncompleteError` (input still missing, such as no edges picked yet) shows as an info banner. Warnings keep a feature working but flag it, for example a subtract that cuts nothing.

## Resizing and handles

- A single shape gets handles along its own axes. Groups and other parts use the world bounding box.
- This OpenCascade build can't stretch an arbitrary solid, so a stretch is passed down to the shapes that built the part, through booleans, fillets, chamfers, and shells (`src/store/resize.ts`). That only works when each shape's axes line up with the frame's axes, in any order or sign.
  - Cylinders become elliptical, spheres become ellipsoids, and a torus ring stays round in X and Y.
  - Meshes stretch through the transform's `stretch` field.
  - STEP imports, copies, mirrors, and patterns only scale evenly, and a toast says why.
- Drag arrows show on every picked edge or face (up to 16). They all drive the feature's one shared value.
- Fillet direction: a face's material lies to the left of its oriented edges, so `cross(n1, t1) · n2 < 0` means a convex edge. The arrow points into the material on convex edges and into the open air on concave ones (`filletDirection` in `src/kernel/geometry.ts`).
- Handles catch pointer presses before the camera controls do (`src/viewport/handles.tsx`), so dragging a handle never orbits the view. Handles are sized in screen pixels. During a drag, `src/viewport/liveMove.ts` shows a preview transform and holds it until the rebuild for that edit arrives. The resize handles ride along with that preview during move, lift, and rotate drags.

## OpenCascade (replicad) gotchas

- translate, rotate, scale, and mirror delete the shape they're called on, so clone it first. fuse, cut, and intersect don't.
- Failures throw a `WebAssembly.Exception` you can catch; `describeError` turns it into a message.
- `faceGroups[].faceId` is the face's hashCode. In meshed edges, `edgeGroups` start and count are in vertices.
- `sketchOnPlane('XZ')` extrudes toward −Y.
- The torus is built with `new oc.BRepPrimAPI_MakeTorus(R, r)`.
- Missing from this build: MakeCone, MakeWedge, IGES, BRepBuilderAPI_GTransform, NurbsConvert, the BRepTools modifiers, and BRepClass3d_SolidClassifier. Cones are revolved or lofted instead, and a wedge is a drawn profile, extruded.

## Known limits

- References don't follow rotations of a part, only moves and stretches along its bounding box.
- After a rotate drag of a part with later features, the handles switch to the world bounding box (the part now has a Move feature).
- The desktop installers are unsigned, so Windows SmartScreen and macOS Gatekeeper warn on first run.
