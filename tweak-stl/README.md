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
