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

### Mutations and undo

Every change is a `Mutation`: `insert`, `remove`, `replace`, `put-layer`, `delete-layer`, `set-units`, or `batch`. `Drawing.apply(m)` performs the change and returns its inverse. `History` stores pairs of `(forward, backward)` mutations.

- Memory cost is proportional to the change, not the drawing size. A move of 1,000 entities stores 1,000 replacements, not a copy of the drawing.
- A `batch` is one undo step. If any step fails, the drawing is rolled back to its state before the batch.
- The history tracks a save point, so `isDirty` returns to false after undoing back to the saved state.

## Tools

A tool is a per-activation state machine (`src/core/tools`). It receives snapped points through `pick`, optional typed numbers through `submitNumber`, drag gestures through `drag`, and Enter/Escape through `confirm`/`cancel`. It exposes `preview()` for transient geometry and sets `finished` when it has nothing left to do. The session then returns to Select.

Tools never touch React or the canvas. They commit through `ToolContext.history` and report problems through `ToolContext.notify`.

## Snapping and selection

- **Object snap** candidates come from `snapCandidatesOf` (endpoints, midpoints, centres). **Intersection** snap uses `intersectEntities` on entities whose bounds reach the cursor. Priority: endpoint, intersection, midpoint, centre, then grid. Ties are broken by distance.
- **Grid snap** rounds to the nearest grid point when no object snap applies.
- **Ortho** constrains the rubber band to the dominant axis from the base point. It applies only when no object snap or grid point was chosen.
- **Selection** uses pick (topmost pickable entity within tolerance) and rectangles. A window (left to right) takes entities fully inside. A crossing (right to left) takes entities that are inside or whose outline touches the rectangle.
- Hidden and locked entities are never picked, snapped to, or selected.

## Session state and rendering

`EditorSession` exposes two subscription channels:

- **View channel** (`subscribeView`) fires on pointer movement, pans, zooms and every change that needs a redraw. The canvas schedules a `requestAnimationFrame` redraw from it. The status bar writes coordinates straight to the DOM from it.
- **UI channel** (`subscribeUi`) fires on state the panels display. React reads a version number through `useSyncExternalStore`.

Pointer movement therefore never re-renders React. `Renderer.draw` takes a `RenderState` snapshot built by the session, so drawing code never reads mutable state while it runs.

## File formats

- **Native format** (`opendraft-drawing`, version 1): JSON with `format`, `version`, `units`, `idSequence`, `layers` and `entities`. `parseDrawing` validates every field before loading anything. Unknown or future versions are rejected with a message. See `src/io/serialization/native.ts`.
- **DXF export** uses `@tarikjabiri/dxf`. Layer colours are mapped to the seven primary AutoCAD palette colours. Other colours are approximated and reported. Entity colours are written as true colour and are exact.
- **DXF import** is implemented in `src/io/dxf/read.ts`. It reads `$INSUNITS`, the LAYER table, and LINE, CIRCLE, ARC, and LWPOLYLINE entities. LWPOLYLINE bulge arcs are flattened into straight segments within 5 degrees. Everything else is counted by type and reported in the import report. Nothing is dropped silently.

## Testing

| Layer | Location | Tooling |
|---|---|---|
| Geometry primitives | `tests/unit/geometry.test.ts` | Vitest |
| Entities and document mutations | `tests/unit/document.test.ts` | Vitest |
| Snapping and selection | `tests/unit/snap-select.test.ts` | Vitest |
| Camera and command parsing | `tests/unit/camera-input.test.ts` | Vitest |
| Tools and editing flows through the session | `tests/integration/session.test.ts` | Vitest |
| DXF and native format round trips | `tests/integration/dxf-native.test.ts` | Vitest + fixture |
| Browser workflows | `tests/e2e/drafting.spec.ts` | Playwright |
| Performance baselines | `tests/bench/geometry.bench.ts` → `docs/BENCHMARKS.md` | Vitest run |

## Known structural limits

- `Drawing.entities()` copies the entity list. Picking, snapping and drawing call it per operation. Fine at 10,000 entities (see benchmarks), but a spatial index is the next step before large drawings.
- The `order` array makes removal O(n). Acceptable for now, and recorded in the roadmap.
- The DXF reader is not a general DXF parser. Blocks, text, hatches, dimensions and splines are skipped and reported.
