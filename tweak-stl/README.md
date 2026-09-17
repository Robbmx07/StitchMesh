# TweakSTL

Offline desktop tool for making localized modifications to existing `.stl`
files — resize a hole, punch a slot, bolt on a boss, or split a model in
two — without opening a full CAD package.

**Modify, don't model.**

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

## Features (MVP)

- Drag-and-drop or file-picker STL import, binary STL export
- Orbit/pan/zoom viewport with Top/Front/Side/Iso presets, wireframe, flat
  shading, and a live bounding-box (X × Y × Z) readout
- Uniform/non-uniform scaling, 90° rotation snaps, center-to-origin, and
  drop-to-build-plate
- **Hole Modifier**: click a point on the model, size a cutting cylinder,
  and boolean-subtract it
- **Primitive Add/Subtract**: place a block, cylinder, or washer and union
  or subtract it from the model
- **Plane Cut**: slice the model into two pieces along an axis-aligned
  plane
