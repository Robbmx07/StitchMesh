# StitchMesh

Offline desktop tool for making localized modifications to existing `.stl`
files — resize a hole, punch a slot, bolt on a boss, or split a model in
two — without opening a full CAD package.

**Modify, don't model.**

See [`docs/MANUAL.md`](docs/MANUAL.md) (or the PDF edition,
[`docs/StitchMesh-User-Manual.pdf`](docs/StitchMesh-User-Manual.pdf)) for a
full walkthrough of every feature with screenshots, plus a validation
review and a list of candidate features not yet built. See
[`docs/VIDEO_SCRIPT.md`](docs/VIDEO_SCRIPT.md) for a scene-by-scene
tutorial video script built from that manual.

Regenerate the PDF after editing the manual or its screenshots with:

```bash
pip install markdown reportlab pillow
python3 scripts/build-manual-pdf.py
```

## Stack

- Electron + Vite + TypeScript
- React + Tailwind CSS + Lucide icons
- Three.js for the viewport (`STLLoader` / `STLExporter`, `OrbitControls`)
- `three-bvh-csg` for boolean (union / subtract) mesh operations
- Zustand for app state

## Getting started

```bash
npm install
npm run dev
```

`npm run dev` starts Vite and launches the Electron shell with hot reload.

## Building

```bash
npm run build
```

Produces a packaged desktop app via `electron-builder` in `release/`. Use
`npm run build:web` to build only the renderer bundle without packaging.

## Standalone offline HTML build

```bash
npm run build:standalone
```

Produces a single self-contained file at `dist-standalone/index.html` — all
JS and CSS inlined, no external requests, nothing to install. Open it
directly by double-clicking (`file://`) in any modern browser and it works
fully offline, including STL import (drag-and-drop) and STL export (a
regular browser download).

This works without a local server because the script is inlined directly
into the page rather than loaded from a separate file — Chromium only
blocks ES module *imports* over `file://`, not an inline module with
nothing left to fetch. The one difference from the desktop app: there's no
native Save/Open dialog, since the browser sandbox doesn't allow a page to
write anywhere on disk. Import never touches the original file (it's read
into memory via the File API), and export always saves a *new* file
through the browser's normal download flow — your source `.stl` is never
modified or overwritten.

## Features

- Drag-and-drop or file-picker STL import, binary STL export
- Orbit/pan/zoom viewport with Top/Front/Side/Iso presets, wireframe, flat
  shading, and a live bounding-box (X × Y × Z) readout — middle-drag orbits
  (and re-centers on whatever's under the cursor at the moment you click,
  not a fixed pivot), right-drag pans, and left-drag is reserved for tool
  clicks and dragging Lock to Plate parts across the bed
- Uniform/non-uniform scaling, 90° rotation snaps, free-angle rotation, center-to-origin, drop-to-build-plate, and mirror
- **Parts-first scene management**: per-part visibility, Lock to Plate, full part lock, rename, duplicate, isolate/show-all, delete, and a context menu for direct operation shortcuts
- **Feature history controls**: per-feature visibility, locking, rename, focus/edit, and delete
- **Hole Modifier**: click a point on the model, size a cutting cylinder,
  and boolean-subtract it — optionally as a standard internal (tapped)
  thread instead of a smooth hole
- **Primitive Add/Subtract**: place a block, cylinder, or washer and union
  or subtract it from the model — a cylinder can also be a standard
  external thread (a threaded boss/stud when added, a tapped hole when
  subtracted)
- **Plane Cut**: slice the model into two pieces along an axis-aligned
  plane
- **Unified Transform workspace**: positioning/move controls now live with scale, rotate, mirror, and plate placement instead of a separate Move tab

## Standard thread sizes

The Hole and Primitive (cylinder) tools have a **Thread** dropdown with
common hardware sizes — ISO metric (M2–M20) and Unified inch coarse/fine
(UNC/UNF, #4-40 through 3/4"). Picking a size generates a real helical
60° V-thread, not just a smooth cylinder at the nominal diameter: the
crest/root truncation and pitch/minor-diameter relationship follow the
same fundamental geometry both standards use (ISO 68-1 for metric, ASME
B1.1 for Unified) —
H = 0.866025·P, pitch diameter = D − 0.649519·P, minor diameter =
D − 1.082532·P. See `src/utils/threadGeometry.ts` for the profile math and
`src/utils/threadStandards.ts` for the size table. An internal (tapped)
thread and an external (screw) thread are the same nominal profile — the
same generator is used as a union for a boss/stud or a subtraction for a
tapped hole, exactly like a real tap cuts the mating shape of the bolt
it's sized for.

## Printer profiles

A **Printer** dropdown in the toolbar (`src/utils/printerProfiles.ts`) holds
specs for common desktop 3D printers — nozzle/spot diameter, layer-height
range, and build volume — for Bambu Lab, Prusa, Creality, Voron, Ultimaker
(FDM) and Elegoo/Formlabs (resin). Picking one tunes every threaded feature
to that machine:

- **Mesh resolution** — radial facets sized to what the nozzle (or resin
  pixel/laser spot) can actually resolve, and helical height rings sized
  to the printer's typical layer height, so the thread mesh isn't finer
  (wasted triangles) or coarser (visibly faceted) than the printer can
  reproduce.
- **Internal-thread clearance** — a small diametral clearance added to
  tapped holes so a print actually accepts a real bolt despite typical FDM
  over-extrusion; resin gets a tighter clearance since it's far more
  dimensionally accurate.
- **Printability warnings** — a note in the Thread panel when a pitch is
  finer than the nozzle can resolve, or a size is small enough that a
  threaded insert would be more reliable than printing the thread directly.

The toolbar defaults to "Generic FDM (0.4mm nozzle)" and flags it with a
warning icon whenever Generic is the active profile — including if you
deliberately pick it, since the underlying concern (no machine-specific
tuning) is still true. Exporting before you've made *any* active choice
(Generic or otherwise) prompts you to either pick a printer first or
continue anyway; once you've picked something once, it won't ask again.
