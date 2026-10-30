# Roadmap

Milestones are ordered by dependency. Each one must leave the application runnable, with tests passing.

## Milestone 1: Drafting vertical slice (done in this repository)

- Canvas viewport with adaptive grid, pan (middle button or Space + drag), zoom at pointer, and high-DPI rendering.
- Line, polyline, rectangle (closed polyline), circle, three-point arc.
- Select, Shift-toggle, window and crossing selection, move, copy, rotate, delete, Escape and Enter behaviour.
- Object snap (endpoint, midpoint, centre, intersection), grid snap, ortho, typed absolute, relative and polar input.
- Undo and redo through mutations, with batch rollback and a dirty flag.
- Layers: create, rename, delete (entities move to layer 0), visibility, lock, colour, active layer.
- Entity properties: layer and colour.
- Native JSON save and open with validation, and a file-based unsaved-change prompt.
- DXF import and export for LINE, CIRCLE, ARC, LWPOLYLINE, layers, colours and units, with an import and export report.
- Unit, integration, DXF round-trip and browser end-to-end tests. Benchmark baseline in `docs/BENCHMARKS.md`.

**Exit criteria met:** see the README "Status" section.

## Milestone 2: Usability and precision (done in this repository, with open items)

Plan, measurements and root-cause analyses: [M2-PLAN.md](M2-PLAN.md). Status per item: [CHECKLIST.md](CHECKLIST.md).

1. **Spatial index** (R-tree inside `Drawing`, ADR 0007). Done. At 100,000 entities pick, snap and window select take microseconds instead of 13 to 21 ms.
2. **Remove the entity copy in hot paths.** Done: `forEachEntity`, cached bounds, `entitiesIn`, and one-pass bulk delete and undo.
3. **Command history recall** with Up and Down arrows, and tab completion for command names. Done.
4. **Editable properties** for line endpoints, circle radius and centre, and arc angles, with validation and undo. Done.
5. **Layer colour from the ACI table**. Done as: indices 1 to 255 imported, and every layer written with its exact colour as true colour plus the nearest index. Not checked against a third-party reader.
6. **Save and open with the File System Access API** where available, with a download fallback. Done; the real browser dialogs have not been checked by hand.
7. Browser coverage: Firefox and WebKit projects in Playwright. Done locally; the CI matrix is written but has not run on GitHub.

Open after M2, from what was measured:

- **Rendering is the next bottleneck.** With 50,000 entities fitted to the screen, a pointer-move frame costs about 215 to 575 ms (Firefox, Chromium, WebKit in Playwright), because every frame redraws every entity. Zoomed in, the index makes it as cheap as an empty drawing. Batching strokes did not help at 5,000 entities. The likely fix is to cache the drawing in an off-screen bitmap and redraw only the cursor and previews on pointer move.
- **Snapping with many entities genuinely overlapping at the cursor is still quadratic** (200 overlapping circles under the cursor: about 11 ms; 500: about 65 ms).
- Second-reader validation of exported DXF, and AutoCAD files, are milestone 4.

## Milestone 3: Editing operations

- Trim, extend, offset, fillet and chamfer.
- Scale and mirror. These need arc orientation and ellipse support in the model (see ADR 0006).
- Polyline vertex editing and bulge arcs as first-class geometry (today they are flattened on import).
- Rectangle as an editable entity if users need it.
- Evaluate Maker.js for offset and boolean operations behind a `core/geometry` interface. Decision recorded in an ADR first.

## Milestone 4: DXF coverage

- Reading TEXT and MTEXT (with style fallback), DIMENSION (as geometry), HATCH (boundary only), SPLINE and ELLIPSE.
- BLOCKS and INSERT (flattened or as blocks).
- Layer linetypes and lineweights.
- Exports validated against a second reader in CI, so the claim of AutoCAD compatibility is tested, not assumed. Scope claims in the README must follow what is tested.

## Milestone 5: Desktop packaging

- Evaluate Tauri 2 (Apache-2.0 / MIT). Measure installer size and startup time on Windows, macOS and Linux.
- Native file dialogs and recent-files list through the desktop shell.
- Code signing and auto-update are out of scope until there is a release process.

## Milestone 6: 3D (investigation only)

- Confirm an Open CASCADE Technology WASM build exists and measure its download size and load time. Compare against a native sidecar for the desktop build.
- Decide the 3D document model in an ADR before any UI work.
- Licensing review of LGPL-2.1 OCCT for distribution (see ADR 0005).

## Ongoing quality work

- Optional bound on history size (FreeCAD defaults to 20 undo steps and also supports a memory limit). OpenDraft history is currently unbounded.
- ESLint or a stricter oxlint configuration once the rule set is agreed.
- Coverage reporting in CI.
- A rendering benchmark in a real browser (frame time at 1k, 10k and 50k entities).
- Accessibility pass on the panels and command line.
