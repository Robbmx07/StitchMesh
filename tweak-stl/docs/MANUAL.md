# StitchMesh — Complete User Manual

*"Modify, don't model."* StitchMesh is an offline tool for making localized
edits to an existing `.stl` file — resize a hole, add a threaded boss, cut
a model in two and move the pieces apart, measure a clearance — without
learning a full CAD package.

This manual walks through every feature with screenshots so you can find
what you need quickly.

---

## 1. What StitchMesh is

A three-panel app: a **toolbar** across the top (file, undo/redo, view,
printer, display toggles), a **3D viewport** filling the center, and a
**context sidebar** on the right with seven tool tabs whose contents
change based on which is active: **Info, Transform, Hole, Primitive, Cut,
Move, Measure**.

![Empty state](manual-assets/01-empty-state.png)

*Empty state. Toolbar across the top (Open STL, Add Part, Export STL, New,
Undo/Redo, view presets, printer picker, display toggles). Empty dark
viewport with a grid and axes gizmo. Sidebar defaulted to Info, reporting
"No model loaded."*

StitchMesh is a single self-contained HTML file. Double-click it to open it
in your browser and it works fully offline — no install, no server, and
nothing is ever sent over the internet. Importing reads your `.stl` file
straight into memory, and exporting saves a new file through your
browser's normal download flow, so your source file is never modified.

---

## 2. Loading, adding, exporting, and resetting a model

- **Import**: drag an `.stl` onto the viewport, or click **Open STL** to
  pick a file. This *replaces* everything currently in the scene. Reading
  a file never modifies it on disk.
- **Add Part**: imports another `.stl` as a second, independent object
  next to the first, rather than replacing it — see §11 (Multiple Objects).
  If nothing is loaded yet, Add Part behaves exactly like Open STL.
- **New**: clears the current model (and its undo history). Asks for
  confirmation first if a model is loaded.
- **Export STL**: saves the current scene — every part in it — as a new
  file, downloaded as `<original-name>-modified.stl`. Your source file is
  never overwritten.

**Printer-not-selected export gate**: the first time you click Export STL
without having picked a printer profile (§14), a dialog interrupts:
*"No printer selected yet... Click OK to export anyway with Generic, or
Cancel to pick your printer first."* Accepting confirms Generic so it
won't ask again.

![Model imported](manual-assets/02-imported-model.png)

*After import: the model renders, and the Bounding Box readout (visible on
every tab) reports live X × Y × Z dimensions in millimeters.*

---

## 3. Viewport navigation

- **Orbit**: left-click-drag, or **middle-click-drag**.
- **Pan**: right-click-drag.
- **Zoom**: scroll wheel.
- **Middle-click-drag re-centers on whatever's under the cursor** the
  moment you press the button, rather than orbiting around a fixed point
  — click near a corner and drag, and the view pivots around that corner.
  Left-drag orbits around the same shared pivot.
- **View presets** (toolbar): **Top / Front / Side / Iso**, or press
  **1 / 2 / 3 / 4** on the keyboard.

![Top view](manual-assets/03-view-top.png)

*Top preset. Presets re-frame and re-target the camera to the model's
**current** bounding box, so they stay useful after scaling, moving parts
apart, or cutting.*

**Display toggles** (toolbar icons, or keyboard **W** / **B**):

| Icon / key | Toggle | Effect |
|---|---|---|
| Grid icon / `W` | Wireframe | Renders the model as an edge mesh |
| Cube icon | Flat shading | Faceted instead of smooth shading — shows actual triangle density |
| Layers icon / `B` | Bounding box | Shows/hides the blue outline (on by default) |

![Wireframe](manual-assets/04-wireframe.png)

*Wireframe on, from the Iso preset.*

### Keyboard shortcuts reference

| Key | Action |
|---|---|
| `Ctrl`/`Cmd` + `Z` | Undo |
| `Ctrl`/`Cmd` + `Y`, or `Ctrl`/`Cmd` + `Shift` + `Z` | Redo |
| `1` `2` `3` `4` | Top / Front / Side / Iso |
| `W` | Toggle wireframe |
| `B` | Toggle bounding box |

Shortcuts are suppressed while typing in any text field or dropdown.

---

## 4. Undo / Redo

Toolbar: the two curved-arrow icons next to New, or `Ctrl+Z` / `Ctrl+Y`.
Every committed change is undoable: Hole/Primitive/Plane Cut apply,
Transform actions (scale, rotate, center, drop, mirror), Move, adding a
part, and mesh repair. Continuous edits (typing digits into a Scale or
Move field) are coalesced into a single undo step per edit session rather
than one step per keystroke; discrete actions (a button click) are always
their own step.

![Before undo](manual-assets/05a-before-undo.png) ![After undo](manual-assets/05b-after-undo.png)

*Left: a hole applied. Right: immediately after `Ctrl+Z` — back to the
unmodified cube. Redo (button or `Ctrl+Y`) reapplies it.*

---

## 5. Transform tool

Tab: **Transform**. Affects the whole selected part.

![Transform panel](manual-assets/06-transform-panel.png)

- **Scale** — X/Y/Z fields show the current size in mm; typing a new value
  rescales to that exact size. **Uniform** (on by default) keeps all three
  axes proportional when editing one field.
- **Rotate** — ±90° snap buttons per axis, plus a **free-angle** row:
  pick an axis, type any number of degrees, click **Rotate**. Both use the
  same underlying rotation — the snap buttons are just a fast path for the
  most common angle.
- **Center to Origin** — recenters the bounding box at world (0,0,0) on
  all three axes.
- **Drop to Build Plate** — Z-only: shifts so the lowest point sits at
  Z=0. Runs automatically once on import too.
- **Mirror** — flips the part across X, Y, or Z through its own center.
  Unlike a naive negative-scale mirror (which leaves every face pointing
  the wrong way), StitchMesh bakes the mirror into the geometry with
  corrected winding, so raycasting and further edits keep working
  correctly afterward.

---

## 6. Hole Modifier

Tab: **Hole**. Cuts a cylindrical (or threaded) hole at a point you click.

**Workflow**: click **Hole** → click a point on any part's surface → the
sidebar shows Diameter, Depth, Thread, and **Apply Boolean Subtract** /
**Cancel**. The part you clicked becomes the target automatically — no
extra selection step, even with multiple objects in the scene.

- **Diameter** / **Depth** (mm) — free-typed when Thread is "Smooth (no
  thread)". **Depth means depth**: the full stated value is removed from
  the material, drilling *into* the surface from the clicked point (not
  split half in/half out).
- **Thread** — a dropdown of standard hardware sizes (§13). Picking one
  locks Diameter to that thread's exact major diameter and cuts a real
  helical thread instead of a smooth cylinder.

![Threaded hole applied](manual-assets/07-hole-threaded.png)

*3/8-16 UNC hole applied: a visible internal thread spiraling down the
bore, generated from the same geometry a real tap would cut.*

---

## 7. Primitive Add/Subtract

Tab: **Primitive**. Places a block, cylinder, or washer and unions (adds)
or subtracts it from a part at a clicked point — same click-to-place,
auto-targeting flow as Hole.

![Primitive panel](manual-assets/08a-primitive-panel.png)

- **Shape**: Block / Cylinder / Washer.
- **Operation**: **Add (Union)** fuses it onto the model as a new
  protrusion; **Cut (Subtract)** carves it out as a cavity.
- **Dimensions**: Block gets Width/Depth/Height; Cylinder gets
  Diameter/Height; Washer gets Outer/Inner Diameter/Height.
- **Thread** (Cylinder only): same dropdown as Hole. With **Add** it
  becomes an external thread (a boss/stud); with **Cut** an internal
  thread (a tapped hole) — the caption updates to say which.

![Threaded boss applied](manual-assets/08b-primitive-threaded-boss.png)

*M8×1.25, Add (Union), 12mm tall, placed on the top face. Bounding-box Z
grew from 20.0 to 31.5mm — the full 12mm (minus a deliberate ~0.5mm embed
fused into the surface for a clean, non-degenerate boolean).*

---

## 8. Plane Cut

Tab: **Cut**. Splits the target part into **two independent, separately
selectable parts** along an axis-aligned plane.

![Plane cut panel](manual-assets/09a-planecut-panel.png)

- **Part** selector — only shown once more than one part exists.
- **Axis** — X / Y / Z, the cutting plane's normal.
- **Height** — the plane's position on that axis. Auto-defaults to the
  target's actual center whenever you open the tool or change axis (a
  model sits on the build plate, so a fixed 0 default would cut at the
  very bottom edge and remove nothing).
- **Apply Cut** — both resulting pieces are kept, labeled `(upper)` and
  `(lower)`, and exported together. They start out sitting exactly where
  the original was — see the Move tool to actually pull them apart.

---

## 9. Move tool

Tab: **Move**. Selects a part and repositions it — this is what actually
separates Plane Cut's two halves (or arranges an added part).

![Move panel before separating](manual-assets/09b-move-panel-before-separate.png)

*Right after a Plane Cut: two selectable parts exist (`cube.stl (upper)` /
`(lower)`), but they still occupy the same space.*

- **Part** dropdown — pick which object to move (hidden with only one part).
- **Position X / Y / Z** — absolute world position in mm; typing a value
  moves the part there directly.
- **Snap to grid** — checkbox; when on, typed positions round to the
  nearest 1mm.
- **Nudge buttons** (−/+ per axis) — step by the grid size (1mm, or the
  snap size if enabled).

![Move panel after separating](manual-assets/09c-move-panel-separated.png)

*The `(upper)` piece moved to Z=35: the two halves are now visibly
separate, independently selectable, and still export together.*

---

## 10. Measurement tool

Tab: **Measure**. Click a **datum** (reference point), then click a second
point to read the distance and per-axis offset — useful for checking
clearances before committing to a hole or thread size.

**Workflow**: click **Measure** → click a point on the model (sets the
green datum marker) → click another point (orange marker + a white
connecting line) → the panel shows straight-line **Distance** and
**ΔX / ΔY / ΔZ**. Click again anywhere to re-measure from the same datum
without resetting it. **Reset Datum** clears both points.

![Measure tool](manual-assets/10-measure-tool.png)

*Datum (green) and measured point (orange) on the same cube, with the
distance and per-axis deltas shown in the panel.*

---

## 11. Multiple objects

**Add Part** (toolbar) imports another `.stl` as an independent object,
auto-positioned beside the existing one (offset along X with a 10mm gap,
dropped to the build plate) so it doesn't start out overlapping.

![Two independent parts](manual-assets/11-multi-object.png)

*Two cubes in one scene, each drilled independently — clicking a point on
either cube automatically targets that part; the other is untouched.*

Hole and Primitive always auto-target whichever part you actually click.
Plane Cut, Move, and Mirror act on an explicitly selected part (the **Part**
dropdown, shown once more than one part exists). Export always includes
every part in the scene.

---

## 12. Mesh validation & auto-repair

Every import — the first model or an added part — is checked for two
kinds of defect and handled differently:

- **Inconsistent or inverted face winding** (a common real-world defect —
  a few faces flipped, or occasionally an entire mesh reading inside-out)
  is detected and **automatically repaired**, silently, before you ever
  see the model. This matters because StitchMesh's click-to-place tools
  read the *actual* face winding to know which way is "outward" — an
  unrepaired flipped face would drill in the wrong direction. Repair runs
  in two passes: a local pass that unifies winding within each connected
  patch of geometry (by majority vote against its neighbors), then a
  global pass that flips the whole mesh if it still reads inside-out
  overall.
- **Open boundary edges** (holes) or **non-manifold edges** (edges shared
  by three or more triangles — not a valid solid) are **not** auto-fixed,
  since closing a hole means guessing a shape. Instead, a dismissible
  banner appears in the toolbar.

![Mesh issue banner](manual-assets/12-mesh-issue-banner.png)

*A model with one triangle deliberately removed: "cube-with-hole.stl: 4
open edge(s)" with a dismiss (✕) button. The banner is informational only
— StitchMesh doesn't attempt to fill the hole automatically.*

---

## 13. Thread generator & standard sizes

Both the Hole and Primitive (cylinder) tools share one **Thread** dropdown
with three groups:

- **Metric (ISO)**: M2, M2.5, M3, M4, M5, M6, M8, M10, M12, M14, M16, M18, M20 (coarse pitch)
- **Unified Coarse (UNC)**: #4-40, #6-32, #8-32, #10-24, 1/4-20, 5/16-18, 3/8-16, 7/16-14, 1/2-13, 5/8-11, 3/4-10
- **Unified Fine (UNF)**: #4-48, #6-40, #8-36, #10-32, 1/4-28, 5/16-24, 3/8-24, 7/16-20, 1/2-20, 5/8-18, 3/4-16

Picking a size generates an actual helical 60° V-thread mesh, from the
fundamental-triangle geometry both standards share (ISO 68-1 for metric,
ASME B1.1 for Unified):

```
H (fundamental triangle height) = 0.866025 × pitch
pitch diameter                  = major diameter − 0.649519 × pitch
minor diameter                  = major diameter − 1.082532 × pitch
crest truncated by H/8, root truncated by H/4
```

These constants were cross-checked against known published table values
(M6×1.0 → minor diameter 4.917mm; M10×1.5 → pitch diameter 9.026mm) — both
matched exactly. An internal (tapped) thread and an external (screw)
thread are the *same* nominal profile — the generator is reused as a
subtraction cutter for one and a union addition for the other, exactly
like a real tap cuts the mating shape of the bolt it's sized for. See
`src/utils/threadGeometry.ts` for the profile math and
`src/utils/threadStandards.ts` for the size table.

---

## 14. Printer profiles

The toolbar's **Printer** dropdown tunes every threaded feature to a
specific machine:

![Generic printer warning](manual-assets/13a-printer-generic.png)

*Default: "Generic FDM (0.4mm nozzle)" with a warning triangle — shown
whenever Generic is active, confirmed or not, since the underlying concern
(no machine-specific tuning) is still true either way.*

![Printer selected](manual-assets/13b-printer-selected.png)

*After picking "Prusa MK4": the warning icon clears.*

What the profile changes:

- **Mesh resolution** — radial facets and helical height-rings sized to
  the printer's nozzle/spot diameter and typical layer height.
- **Internal-thread clearance** — a small diametral clearance added to
  tapped holes (0.25–0.35mm for FDM depending on machine, 0.1mm for resin)
  so a print accepts a real bolt despite typical over-extrusion.
- **Printability warning** — in the Thread panel, when a pitch is finer
  than the nozzle can resolve, or the size is small enough (below roughly
  M4/#8) that a threaded insert would print more reliably.

Included: Generic FDM, Bambu Lab X1 Carbon, Bambu Lab P1S, Prusa MK4,
Creality Ender 3 V2, Creality K1C, Voron 2.4 (350mm), Ultimaker S5, Elegoo
Saturn 3 (resin), Formlabs Form 4 (resin).

---

## 15. Every control, at a glance

| Location | Control | Does |
|---|---|---|
| Toolbar | Open STL | Import an `.stl`, replacing the scene (drag-and-drop works too) |
| Toolbar | Add Part | Import an `.stl` as a new independent object |
| Toolbar | Export STL | Save the current scene as a new `.stl` |
| Toolbar | New | Clear the model (confirms first) |
| Toolbar | Undo / Redo | Step back/forward through edit history (`Ctrl+Z` / `Ctrl+Y`) |
| Toolbar | Top / Front / Side / Iso | Jump to a preset camera framing (`1`–`4`) |
| Toolbar | Printer dropdown | Select target printer; tunes thread resolution/clearance |
| Toolbar | Wireframe / Flat shading / Bounding box | Display toggles (`W` / — / `B`) |
| Sidebar → Info | (read-only) | File name, bounding box |
| Sidebar → Transform | Scale X/Y/Z, Uniform | Resize the part |
| Sidebar → Transform | Rotate ±90° (×3 axes), Free angle | Rotate the part |
| Sidebar → Transform | Center to Origin, Drop to Build Plate | Reposition the part |
| Sidebar → Transform | Mirror X/Y/Z | Flip the part |
| Sidebar → Hole | Diameter, Depth, Thread | Configure a hole cutter after clicking a point |
| Sidebar → Hole | Apply Boolean Subtract / Cancel | Commit or discard |
| Sidebar → Primitive | Shape, Operation, dimensions, Thread | Configure a primitive after clicking a point |
| Sidebar → Primitive | Apply / Cancel | Commit or discard |
| Sidebar → Cut | Part, Axis, Height, Apply Cut | Split the target part in two |
| Sidebar → Move | Part, Position X/Y/Z, Snap, nudge | Reposition a part |
| Sidebar → Measure | (click viewport) | Set datum, measure distance/deltas |
| Viewport | Left/middle-drag, right-drag, scroll | Orbit, pan, zoom |

---

## 16. Accuracy & validity review

A full-codebase review (an automated correctness pass, plus manual
re-derivation of the placement math for every new tool) was run twice this
project — once after the initial CSG/thread work, and again after this
round's ten new features. All findings below are **already fixed**.

**From the first pass:**
1. **Hole/Primitive depth was silently halved** — the cutter was centered
   on the clicked point instead of driven into the surface. Fixed
   (`positionCutterAtSurface`); confirmed by drilling a hole deeper than
   the material and verifying it broke through the far face.
2. **Plane Cut's default height (0) was a silent no-op** on any
   build-plate-dropped model. Fixed to auto-default to the target's
   actual center.
3. A coordinate-space bug (using each mesh's local transform instead of
   its world transform in the CSG boolean) that could silently miss
   entirely after a prior scale/rotate. Fixed; still holds under this
   round's testing.

**From this pass (the ten new features):**
- Mesh repair was verified against three synthetic defects: a mesh with
  two faces deliberately flipped, a fully inside-out mesh, and a mesh with
  a real open hole. The first two are silently and correctly repaired
  (confirmed via a through-hole test producing byte-identical triangle
  counts to a known-good baseline); the third is correctly left alone and
  reported.
- Mirror was verified to preserve correct winding by drilling a hole
  immediately afterward and confirming the raycast/CSG pipeline still
  works — a naive negative-scale mirror would have broken this silently.
- Multi-object targeting was verified by drilling two independent cubes
  separately and confirming via exported triangle counts that only the
  clicked part changed each time.
- Undo/redo was verified via both the keyboard shortcut and toolbar
  buttons, confirming an exact round-trip (12 → 348 → 12 → 348 triangles
  across apply → undo → redo).
- Snap-to-grid was verified by typing a fractional position (12.6) and
  confirming it rounded to the nearest 1mm grid line (13).
- Free-angle rotation was verified with a 45° rotation, confirming the
  resulting bounding box grew to the expected 28.3mm diagonal
  (20 × √2 ≈ 28.28).

**Everything was re-verified end-to-end** in a real browser, offline, with
**zero console errors** across every test.

**Known limitations** (not bugs, but worth knowing):

- **No hole-filling.** Mesh repair fixes winding but doesn't attempt to
  triangulate and close actual holes/non-manifold topology — those are
  reported, not fixed.
- **Thread mesh triangle counts scale up fast.** A fine-pitch thread over
  a long depth can generate 10,000+ triangles.
- **Move and Transform are independent.** Transform (scale/rotate/
  center/drop) acts on the whole target part as a group operation; Move
  repositions one part relative to others. They don't currently share a
  combined "part-local transform" model — moving a part and then scaling
  the *whole scene* via Transform will scale every part together, not just
  the moved one.
- **Snap-to-grid applies to the Move tool only**, not to Hole/Primitive
  click placement (snapping a raycast hit point to a grid could shift it
  off the actual surface).
- **Single-level undo/redo stack**, capped at 25 steps.

---

## 17. Possible future features

Most of what was on this list in the previous revision of this manual is
now built. What's still genuinely missing, for a future pass:

1. **Hole-filling / non-manifold repair** — closing actual holes, not just
   fixing winding.
2. **A true 3D transform gizmo** (drag arrows/rings in the viewport)
   instead of numeric fields for Move and free rotation.
3. **Text/label embossing** onto a surface.
4. **Per-vertex or sculpting-level editing** — StitchMesh is deliberately
   scoped to primitive-based modification, not freeform mesh editing.
5. **Saved/named printer profiles** beyond the built-in list (custom
   nozzle diameter, layer height).

---

Thanks for using StitchMesh. *Modify, don't model.*
