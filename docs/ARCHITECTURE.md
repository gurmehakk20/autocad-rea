# Architecture

OpenDraft is a browser-first 2D drafting application. This document describes the module boundaries, the data flow, and the rules that keep the geometry engine independent of the UI.

## Layers

```
React UI (src/components, src/app)
   │  reads UI version, calls session methods
   ▼
EditorSession (src/state/EditorSession.ts)      ← no React, no DOM
   │  owns: Drawing, History, Selection, Camera, active Tool, snap settings
   ├─► Tools (src/core/tools)                    ← state machines, pure logic
   ├─► Snapping / Selection (src/core/snapping, src/core/selection)
   ├─► History (src/core/history)                ← records mutations
   ▼
Drawing (src/core/document/Drawing.ts)          ← the only place that changes entities
   ▼
Entities + geometry (src/core/entities, src/core/geometry)   ← pure functions
Spatial index (src/core/spatial)                              ← R-tree owned by Drawing

I/O (src/io): native JSON format, DXF import/export — talk to Drawing only through loadParts / entities()

Viewport (src/viewport): Camera (pure transform), Renderer (Canvas 2D, reads RenderState), CanvasViewport (React shell that forwards DOM events)
```

### Dependency rules

1. `src/core` does not import React, the DOM, or `src/viewport`. It must run in Node (tests and benchmarks depend on this).
2. `src/io` depends on `src/core`, never on React.
3. Only `Drawing.apply` mutates entities or layers. Tools and the session produce `Mutation` values and pass them to `History.execute`.
4. The viewport is the only module that maps between world and screen coordinates. Everything else works in world units.
5. React components subscribe to the session and never own drawing state.

## Coordinates and units

- **World coordinates** are plain numbers in the drawing's declared units (`DrawingUnits`). The engine never converts units. Units are metadata for display and DXF `$INSUNITS`.
- **Screen coordinates** are CSS pixels relative to the canvas. `camera.ts` converts between the two. World Y points up, screen Y points down.
- **Pick and snap tolerances** are defined in pixels and converted to world units by dividing by zoom, so they feel the same at every zoom level.
- **Numerical tolerance** is `EPSILON = 1e-9`, applied relative to coordinate magnitude (`tolerance.ts`). See the README for user-facing limits.

## Document model

- An `Entity` is an immutable object with a stable `id` (`e1`, `e2`, …). Ids come from a monotonic counter in `Drawing`. They are never reused and they survive save and load.
- Entity types: `line`, `circle`, `arc`, `polyline`. A rectangle is a closed polyline with four vertices, matching DXF `LWPOLYLINE`.
- Transforms are **rigid only** (translation and rotation) at the entity level. Scale and mirror are not supported because they would change arc orientation and require special handling. This is enforced in `transformEntity`.
- A `Layer` has a name, colour, visibility and lock state. Layer 0 always exists and cannot be deleted or renamed.
- Entity colour is `#rrggbb` or `null` (ByLayer).

### Spatial index

`Drawing` owns an R-tree (`src/core/spatial/rtree.ts`, ADR 0007) and a cache of each entity's exact bounds. Both are updated only inside `apply` and `loadParts`, so a failed batch rolls them back with the entities. The tree stores each entity's *reach*: its bounds united with its snap points, because an arc's centre can lie outside the arc.

- `entitiesIn(area)` returns a superset of the entities touching `area`, in creation order. Callers still run their exact test. A search that covers the whole tree returns `entities()` and skips the tree.
- `forEachEntity` visits entities without copying. Do not mutate the drawing during the visit.
- `boundsOf(id)` returns the cached exact bounds.
- A `batch` of only removes, or only inserts at strictly ascending positions, is applied in one pass, so deleting or restoring many entities is not quadratic.

### Mutations and undo

Every change is a `Mutation`: `insert`, `remove`, `replace`, `put-layer`, `delete-layer`, `set-units`, or `batch`. `Drawing.apply(m)` performs the change and returns its inverse. `History` stores pairs of `(forward, backward)` mutations.

- Memory cost is proportional to the change, not the drawing size. A move of 1,000 entities stores 1,000 replacements, not a copy of the drawing.
- A `batch` is one undo step. If any step fails, the drawing is rolled back to its state before the batch.
- The history tracks a save point, so `isDirty` returns to false after undoing back to the saved state.

## Tools

A tool is a per-activation state machine (`src/core/tools`). It receives snapped points through `pick`, optional typed numbers through `submitNumber`, drag gestures through `drag`, and Enter/Escape through `confirm`/`cancel`. It exposes `preview()` for transient geometry and sets `finished` when it has nothing left to do. The session then returns to Select.

Tools never touch React or the canvas. They commit through `ToolContext.history` and report problems through `ToolContext.notify`.

## Snapping and selection

- **Object snap** candidates come from `snapCandidatesOf` (endpoints, midpoints, centres) for the entities the index returns near the cursor. **Intersection** snap uses `intersectEntities` on those entities whose bounds reach the cursor. Priority: endpoint, intersection, midpoint, centre, then grid. Ties are broken by distance.
- **Grid snap** rounds to the nearest grid point when no object snap applies.
- **Ortho** constrains the rubber band to the dominant axis from the base point. It applies only when no object snap or grid point was chosen.
- **Selection** uses pick (topmost pickable entity within tolerance) and rectangles. A window (left to right) takes entities fully inside. A crossing (right to left) takes entities that are inside or whose outline touches the rectangle.
- Hidden and locked entities are never picked, snapped to, or selected.

## Session state and rendering

`EditorSession` exposes two subscription channels:

- **View channel** (`subscribeView`) fires on pointer movement, pans, zooms and every change that needs a redraw. The canvas schedules a `requestAnimationFrame` redraw from it. The status bar writes coordinates straight to the DOM from it.
- **UI channel** (`subscribeUi`) fires on state the panels display. React reads a version number through `useSyncExternalStore`.

Pointer movement therefore never re-renders React. `Renderer.draw` takes a `RenderState` snapshot built by the session, so drawing code never reads mutable state while it runs.

## Saving and opening

`src/app/files.ts` is the only code that talks to the browser file APIs, and `src/app/actions.ts` holds the file handle of the open document. Neither `src/core` nor `src/state` sees a handle.

- With the File System Access API, Open keeps a handle and Save writes to it. Without it, opening uses an `<input type="file">` and saving downloads.
- The file on disk changes only when the writable stream closes, so a failed write leaves the old contents. The drawing is marked saved only after that, and only up to the state that was serialised (`snapshotForSave`), so edits made while a dialog or permission prompt was open keep it unsaved. A result that arrives after the document was replaced is ignored.
- The handle belongs to the document: New and DXF import clear it, a failed Open leaves it, and DXF export never touches it.

## File formats

- **Native format** (`opendraft-drawing`, version 1): JSON with `format`, `version`, `units`, `idSequence`, `layers` and `entities`. `parseDrawing` validates every field before loading anything. Unknown or future versions are rejected with a message. See `src/io/serialization/native.ts`.
- **DXF export** uses `@tarikjabiri/dxf`. Entity colours and layer colours are written as true colour (group 420) and are exact. A layer also gets the nearest of the 255 ACI indices from `src/io/dxf/aci.ts` as a fallback, and the export report counts layers outside the index.
- **DXF import** is implemented in `src/io/dxf/read.ts`. It reads `$INSUNITS`, the LAYER table, and LINE, CIRCLE, ARC, and LWPOLYLINE entities. LWPOLYLINE bulge arcs are flattened into straight segments within 5 degrees. Everything else is counted by type and reported in the import report. Nothing is dropped silently.

## Testing

| Layer | Location | Tooling |
|---|---|---|
| Geometry primitives | `tests/unit/geometry.test.ts` | Vitest |
| Entities and document mutations | `tests/unit/document.test.ts` | Vitest |
| Snapping and selection | `tests/unit/snap-select.test.ts` | Vitest |
| Camera and command parsing | `tests/unit/camera-input.test.ts` | Vitest |
| Spatial index against full scans (differential, seeded) | `tests/integration/spatial-index.test.ts` | Vitest |
| Command history and Tab completion | `tests/integration/command-history.test.ts`, `tests/e2e/command-line.spec.ts` | Vitest, Playwright |
| Tools and editing flows through the session | `tests/integration/session.test.ts` | Vitest |
| DXF and native format round trips | `tests/integration/dxf-native.test.ts` | Vitest + fixture |
| Browser workflows | `tests/e2e/drafting.spec.ts` | Playwright |
| Performance baselines | `tests/bench/geometry.bench.ts` → `docs/BENCHMARKS.md` | Vitest run |

## Known structural limits

- `Drawing.entities()` still copies the list. It is used for file I/O and fit-to-extents, where a snapshot is right. Picking, snapping, rectangle selection and rendering use the index.
- A single insert or remove splices the `order` array, which is O(n). Bulk deletes and their undo avoid this (see "Spatial index"). The index tree is not rebalanced after many removals, so it loosens until the next `loadParts`.
- After an insert or remove, the next ordered query rebuilds the creation-order rank map, which is O(n).
- The DXF reader is not a general DXF parser. Blocks, text, hatches, dimensions and splines are skipped and reported.
