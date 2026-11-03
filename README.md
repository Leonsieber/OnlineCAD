# OnlineCAD

Free parametric 3D CAD in the browser and on the desktop. Drag in shapes like Tinkercad, sketch and
extrude like Onshape, sculpt meshes, generate parts with AI, and export for 3D printing. Solids are
built by OpenCascade (FreeCAD's geometry kernel), compiled to WebAssembly and running on your own
computer.

## Run it

```bash
npm install
npm run dev
```

Then open http://localhost:5173.

| Command | What it does |
| --- | --- |
| `npm run build` | Typecheck and build the web app into `dist/` (installable, works offline) |
| `npm test` | Unit tests (solver, profiles, formulas, mesh tools) |
| `npm run desktop` | Build and open the desktop app (Electron) |
| `npm run dist:desktop` | Build the Windows installer into `release/` |

To host it for free (Cloudflare Pages + Supabase) and publish desktop installers, see
[HOSTING.md](HOSTING.md).

## Features

**Start and organise**
- Projects dashboard with thumbnails, search, sort, rename, duplicate, templates, and drag-and-drop import
- Sign in with Google, GitHub, or an email link to sync projects to the cloud and share read-only links
  (when the host has connected Supabase); everything also works offline in the browser

**Model**
- Two interaction styles: **Tinkercad** (drag parts, resize handles, three rotate arcs with a
  protractor, arrow-key nudging, D to drop) and **Pro** (move arrows and rotate rings, like Onshape)
- 10 shapes, union / subtract / intersect, Hole and Group, fillet, chamfer, shell, mirror, patterns
- **Sketches** on planes or faces: lines, rectangles, circles, arcs, construction geometry,
  15 constraints, dimensions that take formulas, and a "fully defined" indicator
- **Extrude** (new, add, cut, intersect; one way, symmetric, or two ways), **revolve**, **sweep**, **loft**
- Feature history with edit, suppress, rollback, and timeline; variables and formulas in every field
- **Parts library**: bolts, nuts, washers, standoffs, gears, springs, bearings, project boxes, lids
- **Scripting**: build parts in JavaScript with the replicad API and named parameters
- **AI**: describe a part and Claude (or OpenAI, Gemini through OpenRouter, or a local Ollama model)
  writes a parametric script; failed scripts are sent back to the model to fix

**Mesh and look**
- Convert to mesh, Loop subdivision, smoothing, and sculpt brushes (inflate, deflate, smooth,
  flatten, grab), all recorded in the history
- 18 materials (plastics, metals, wood, glass…) with realistic shading and mass by density
- Realistic view with filmic lighting and contact shadows; save the view as a PNG
- Seven themes (Midnight, Carbon, Graphite, Ocean, Light, Paper, High contrast) or follow the system

**Check and share**
- Measure tool with snapping to corners, edge midpoints, and face centers
- 3D-print check: overhangs, build volume, plate contact, and a filament estimate
- 2D technical drawings (front, top, right, iso, hidden lines, dimensions) as SVG or PDF
- Import STEP, STL, OBJ, PLY, GLB/glTF, 3MF, OFF; export STEP, STL, 3MF, OBJ, PLY, GLB, and `.ocad`

## Layout

| Folder | Contents |
| --- | --- |
| `src/model` | Document types, formulas, defaults, materials, parts library |
| `src/kernel` | Geometry worker (OpenCascade): features, sketches to solids, mesh tools, scripts |
| `src/sketch` | Constraint solver, profile detection, sketch editing state |
| `src/store` | App state, undo, selection, moves and resizes |
| `src/viewport` | three.js scene, handles, sketch editor, measure, sculpt, print check |
| `src/ui` | Dashboard, ribbon, panels, dialogs, AI panel, drawings |
| `src/ai` | Text-to-CAD for Claude and OpenAI-compatible providers |
| `src/cloud` | Supabase sign-in and cloud projects |
| `electron` | Desktop app |
| `website` | The landing page |
| `supabase` | Database schema with row-level security |
