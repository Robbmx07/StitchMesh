# StitchMesh — Tutorial Video Script

**For**: an AI video-generation tool producing a feature-tour tutorial.
**Companion files**: `docs/MANUAL.md` (full written reference), `docs/manual-assets/` (18 screenshots referenced by filename below), `dist-standalone/index.html` (the actual app — open it directly to record live screen capture).

**Target runtime**: ~9 minutes (19 scenes). Cut any "OPTIONAL TRIM" scene to land closer to 6–7 minutes.

**Tone**: calm, practical, competent-friend energy — not hype-narrator. StitchMesh's own tagline is "Modify, don't model," and the whole pitch is *this is the fast, un-intimidating alternative to opening a full CAD package for a five-minute fix*. Every scene should reinforce "this is easy," never "look how powerful this is."

**Audience**: hobbyist 3D-printer owners who can slice and print but have never touched CAD. Assume zero prior knowledge of terms like "boolean," "CSG," or "manifold" — define anything technical in plain language the moment it's first used, once, briefly, then move on.

**Visual language**:
- Static screenshots (listed below) can be used directly as full-frame or inset visuals.
- Anything marked **[LIVE CAPTURE]** needs an actual screen recording of the app in action (cursor movement, clicks, typing) — the static screenshots don't show motion/before-after transitions on their own. Use `dist-standalone/index.html` in a real browser at a 1440×900-ish window to match the screenshots' framing.
- On-screen text = a lower-third caption or callout label, shown concurrently with the voiceover unless noted otherwise.
- Background music: light, upbeat-but-unobtrusive instrumental under narration throughout; no music during any silent demonstration beat.

---

## Asset reference

| File | Shows |
|---|---|
| `01-empty-state.png` | App freshly loaded, no model, full toolbar visible |
| `02-imported-model.png` | A cube just imported, bounding box readout populated |
| `03-view-top.png` | Top orthographic view preset |
| `04-wireframe.png` | Wireframe display toggle on, Iso view |
| `05a-before-undo.png` | A model with a hole already applied |
| `05b-after-undo.png` | Same model immediately after Ctrl+Z — hole gone |
| `06-transform-panel.png` | Full Transform tab: scale, rotate (±90° + free angle), position, mirror |
| `07-hole-threaded.png` | A 3/8-16 UNC threaded hole, applied, visible spiral in the bore |
| `08a-primitive-panel.png` | Primitive tab: shape/operation selectors |
| `08b-primitive-threaded-boss.png` | An M8×1.25 threaded boss protruding from a cube |
| `09a-planecut-panel.png` | Plane Cut tab: axis/height controls |
| `09b-move-panel-before-separate.png` | Right after a Plane Cut — two parts exist but still overlap |
| `09c-move-panel-separated.png` | Same two parts after using Move to pull them apart |
| `10-measure-tool.png` | Measure tool: green datum marker, orange point, distance readout |
| `11-multi-object.png` | Two independent cubes in one scene, each drilled separately |
| `12-mesh-issue-banner.png` | The dismissible amber "N open edge(s)" warning banner |
| `13a-printer-generic.png` | Printer dropdown on default Generic, warning icon showing |
| `13b-printer-selected.png` | Same dropdown after picking a real printer — warning gone |

---

## Scene-by-scene script

### Scene 1 — Cold open (0:00–0:12)

**Visual**: **[LIVE CAPTURE]** Fast montage, no narration yet: a hole being drilled, a threaded boss appearing, two cut pieces sliding apart. 3–4 quick cuts, each ~2–3 seconds, music up, no voiceover.

**On-screen text**: `StitchMesh` (title card fades in over the last cut)

---

### Scene 2 — The hook (0:12–0:28)

**Visual**: `01-empty-state.png`, then a slow push-in on the empty viewport.

**Voiceover**:
> "Got a bracket that's *almost* right — except that one hole's too small, or you need a threaded post where there isn't one? You don't need to learn CAD for that. You need StitchMesh."

**On-screen text**: `Modify, don't model.`

---

### Scene 3 — What it is (0:28–0:55)

**Visual**: `01-empty-state.png` full-frame, camera slowly orbiting the empty grid.

**Voiceover**:
> "StitchMesh is an offline tool that opens an STL file you already have, and lets you make the *one change* you actually need — resize a hole, add a mounting boss, split a part in two — then export it, ready to slice. No modeling from scratch. No subscription. It even runs as a single HTML file you can double-click, fully offline."

**On-screen text**: `Works offline · No install required`

---

### Scene 4 — Getting it open (0:55–1:15)

**Visual**: **[LIVE CAPTURE]** Double-clicking `dist-standalone/index.html`, the app opening in a browser tab.

**Voiceover**:
> "There are three ways to run it — a desktop app, a web build, or this: one self-contained HTML file. Double-click it, and you're in. Nothing to install."

**On-screen text**: `dist-standalone/index.html`

*(OPTIONAL TRIM: this scene can be cut if the video is meant for users who already have the app running.)*

---

### Scene 5 — Loading a model (1:15–1:40)

**Visual**: **[LIVE CAPTURE]** Drag an `.stl` file from a desktop folder onto the viewport; watch it appear and the sidebar populate. Cut to `02-imported-model.png` as a held beat.

**Voiceover**:
> "Drag your STL onto the viewport — or use Open STL in the top left. The moment it loads, you'll see its exact size on the right: width, depth, height, in millimeters. That number updates live, every time you change something."

**On-screen text**: `Drag & drop, or Open STL`

---

### Scene 6 — Moving around (1:40–2:15)

**Visual**: **[LIVE CAPTURE]** Left-drag to orbit; right-drag to pan; scroll to zoom. Then middle-click on a corner of the model and drag, showing the view pivoting around that specific corner rather than the center. Cut to `03-view-top.png` and `04-wireframe.png` briefly.

**Voiceover**:
> "Left-click and drag to orbit, right-click to pan, scroll to zoom — the usual. But here's a nice touch: middle-click and drag orbits around *whatever's under your cursor*, not some fixed center point. Click near a corner, and that corner becomes the pivot. And if you'd rather use the keyboard, 1 through 4 jump you to Top, Front, Side, and Iso views."

**On-screen text**: `Middle-click = orbit around cursor` / `1–4 = view presets`

---

### Scene 7 — Undo, so you can just try things (2:15–2:35)

**Visual**: `05a-before-undo.png` → `05b-after-undo.png` as a quick before/after cut. **[LIVE CAPTURE]** if possible: show pressing Ctrl+Z and the hole visibly disappearing.

**Voiceover**:
> "And because mistakes happen — everything here is undoable. Ctrl+Z, or the arrow buttons up top. Make the cut, don't like it, undo it. That's the whole safety net — feel free to experiment."

**On-screen text**: `Ctrl+Z / Ctrl+Y`

---

### Scene 8 — Transform: scale, rotate, mirror (2:35–3:20)

**Visual**: `06-transform-panel.png` held while narrating the panel, then **[LIVE CAPTURE]**: typing a new width value and watching the model resize; clicking a +90° rotate button; clicking a Mirror button.

**Voiceover**:
> "The Transform tab handles the whole-part stuff. Type an exact size into Width, Depth, or Height, and — if Uniform is checked — the whole model scales together. Rotate in clean 90-degree steps, or dial in any angle you want with the free-angle field. Center it, drop it flat onto the build plate, or mirror it across any axis if you need a left-and-right pair."

**On-screen text**: `Scale · Rotate · Mirror · Position`

---

### Scene 9 — The Hole Modifier (3:20–4:15)

**Visual**: **[LIVE CAPTURE]**: click the Hole tab, click a point on the model's face, watch the translucent blue cutter appear. Type a new diameter. Then hold on `07-hole-threaded.png` for the applied result.

**Voiceover**:
> "This is probably why you're here. Click Hole, then click anywhere on the model — that's where the cutter goes, automatically aimed straight into the surface. Type a diameter and depth, and hit Apply. Done — that hole is now exactly the size you need.

> But here's the part that sets StitchMesh apart: that Thread dropdown. Pick a real hardware size — a quarter-twenty, an M6, whatever your bolt actually is — and instead of a plain round hole, StitchMesh cuts an actual helical thread. Not a smooth hole you'll need a tap for. A real, printable, standards-accurate thread."

**On-screen text**: `Standard thread sizes: M2–M20 · UNC · UNF`

---

### Scene 10 — Primitives: add or subtract shapes (4:15–5:10)

**Visual**: `08a-primitive-panel.png` while narrating the shape/operation choices. **[LIVE CAPTURE]**: switch to Cylinder + Add (Union), click a point, type a height, Apply. Hold on `08b-primitive-threaded-boss.png`.

**Voiceover**:
> "Sometimes you don't want to remove material — you want to add it. That's the Primitive tab: blocks, cylinders, or washers, and you choose whether it's Added onto the model or Subtracted out of it. Same click-to-place as before.

> And the cylinder shares that same Thread dropdown. Set it to Add, pick a thread size, and you've just grown a real threaded mounting post straight out of the surface — perfect for a boss that needs to screw into something."

**On-screen text**: `Block · Cylinder · Washer  —  Add or Subtract`

---

### Scene 11 — Plane Cut (5:10–5:35)

**Visual**: `09a-planecut-panel.png`. **[LIVE CAPTURE]**: pick an axis, click Apply Cut.

**Voiceover**:
> "Need to split a part in two — say, to fit it on a smaller print bed? Plane Cut slices clean through on any axis, at any height. One click, and you've got two separate, printable pieces."

**On-screen text**: `Splits into two independent parts`

---

### Scene 12 — Move: actually separating the pieces (5:35–6:15)

**Visual**: `09b-move-panel-before-separate.png` → `09c-move-panel-separated.png`, ideally as a **[LIVE CAPTURE]** showing the position field being typed and the pieces sliding apart in real time.

**Voiceover**:
> "Right after a cut, both halves are sitting exactly where the original model was — so switch to the Move tab. Pick a part from the dropdown, type a new position, or nudge it with the plus and minus buttons. Watch — that's the same two pieces from the cut, now clearly separated. And if you want everything to land on clean numbers, flip on Snap to Grid."

**On-screen text**: `Move tab · Snap to grid (1mm)`

---

### Scene 13 — Measure before you commit (6:15–6:45)

**Visual**: `10-measure-tool.png`. **[LIVE CAPTURE]** if possible: clicking two points and watching the distance readout populate live.

**Voiceover**:
> "Not sure what size that hole actually needs to be? Measure tool. Click one point to set a reference — that's your green marker — then click a second point, and you get the exact distance between them, plus how far apart they are on each axis. Check your clearance *before* you cut, not after."

**On-screen text**: `Click datum → click point → read distance`

---

### Scene 14 — Working with more than one part (6:45–7:20)

**Visual**: `11-multi-object.png`. **[LIVE CAPTURE]** if possible: clicking "Add Part," a second model appearing beside the first, then drilling into just one of them.

**Voiceover**:
> "You're not limited to one object either. Add Part brings in a second STL — it lands right next to your first model, ready to work on. Click a point on either one, and StitchMesh automatically knows which part you mean — drill into this cube, and the other one stays completely untouched."

**On-screen text**: `Add Part → independent objects`

---

### Scene 15 — It checks your file for you (7:20–7:50)

**Visual**: `12-mesh-issue-banner.png`.

**Voiceover**:
> "One more thing happens automatically, in the background, every time you import: StitchMesh checks the mesh for common problems. If a few faces are flipped the wrong way — a surprisingly common export glitch — it fixes that silently, before you even notice. If there's something bigger, like an actual hole in the mesh, it can't fix that safely on its own, so it just tells you, right here in the toolbar."

**On-screen text**: `Auto-repairs flipped faces · Flags real holes`

---

### Scene 16 — Tell it what printer you're using (7:50–8:25)

**Visual**: `13a-printer-generic.png` → `13b-printer-selected.png`.

**Voiceover**:
> "Last thing — up in the toolbar, there's a printer dropdown. Pick your actual machine, and StitchMesh tunes every thread it generates to match: how finely it's meshed, and a bit of extra clearance so a printed hole actually accepts a real bolt. Leave it on Generic, and you'll see a little warning — StitchMesh will still work, just without that fine-tuning."

**On-screen text**: `Threads tuned to your printer`

---

### Scene 17 — Export and print (8:25–8:45)

**Visual**: **[LIVE CAPTURE]**: click Export STL, show the resulting file appearing (download or save dialog).

**Voiceover**:
> "When it's exactly right, click Export STL. That's a brand-new file — your original is never touched. Straight into your slicer from there."

**On-screen text**: `Export STL → ready to slice`

---

### Scene 18 — Recap montage (8:45–9:00)

**Visual**: **[LIVE CAPTURE or stills]** Rapid-fire, ~1.5 seconds each: `02-imported-model.png` → `07-hole-threaded.png` → `08b-primitive-threaded-boss.png` → `09c-move-panel-separated.png` → `10-measure-tool.png`.

**Voiceover**:
> "Resize a hole. Add a thread. Split a part. Measure a fit. All without ever opening a CAD package."

**On-screen text**: (none — let the montage speak)

---

### Scene 19 — Close (9:00–9:10)

**Visual**: `01-empty-state.png`, title card returns.

**Voiceover**:
> "StitchMesh. Modify, don't model."

**On-screen text**: `StitchMesh — Modify, don't model.` (+ link/location to get it, if applicable — leave blank if none provided)

---

## Notes for the video-generation AI

- **Pacing check**: the voiceover word counts above average ~2.3 words/second when read at a natural pace, which is what the scene durations assume. If your TTS voice reads faster or slower, adjust scene durations rather than the script text.
- **Screenshots vs. live capture**: every scene marked **[LIVE CAPTURE]** genuinely needs motion (something appearing, moving, or changing) — a static screenshot won't sell the point (e.g., Scene 12's whole value is *watching* two pieces separate). If live capture isn't feasible, fall back to a before/after cross-dissolve between the two referenced screenshots rather than a hard cut.
- **Terms defined on first use, once**: "thread" (Scene 9), "boolean subtract/add" is deliberately never named as jargon — described only as "cut out" / "add on." Don't reintroduce CAD terminology the script avoided.
- **Consistency with the written manual**: every claim in this script (thread accuracy, printer-tuning behavior, undo behavior, multi-object targeting) is drawn directly from `docs/MANUAL.md`, which itself was verified against the running app — if you need a detail this script doesn't cover, check the manual before improvising new claims about what the software does.
