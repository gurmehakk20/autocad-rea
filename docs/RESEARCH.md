# Research

This records what was checked before the first implementation, where each fact came from, and what was not checked. Facts are from primary sources (package registries, repository license files and READMEs) as of 2026-10-27. Where a check was shallow, the section says so.

## 1. Reference project: morluto/rea

The repository linked in the project brief (`https://github.com/morluto/rea`) is **not a CAD project**. Its README describes "One MCP for reverse engineering across binaries, applications, and runtime behavior". It is an MIT-licensed toolkit for AI agents doing reverse engineering. It covers native binaries, Electron apps, .NET, APKs, firmware and packet captures.

Nothing from REA was reused in OpenDraft. Its code is outside this domain. Its repository conventions (AGENTS.md, CONTRIBUTING.md, CI layout) may be useful references later. Confirm with the project owner whether REA was meant as an agent-tooling reference or by mistake.

## 2. LibreCAD

- **License:** GPL-2.0. Its README says it is free software redistributable under GPLv2.
- **Architecture (README):** Based on the community edition of QCAD, with a Qt 6 GUI. It uses `libdxfrw` for DXF/DWG reading and `shapelib` for Shapefile import. Top-level directories are `librecad`, `libraries`, `plugins`, `externals`, `tools`.
- **Engine layout (directory listings, `librecad/src/lib/engine`):** subdirectories `document/`, `undo/`, `overlays/`, `clipboard/`, `settings/`. Under `document/`: `entities/`, `layers/`, `blocks/`, `container/`, `selection/`, `ucs/`, `views/`, `dimstyles/`, `textstyles/`, `linetypes/`, `patterns/`, `fonts/`, plus `rs_document` and `rs_graphic`. The engine is a C++ library below the GUI. Pen, colour and line-type handling are separate classes (`rs_pen`, `rs_color`, `lc_linetypenames`).
- **Entity model (read from `rs_entity.h`):** `RS_Entity` derives from `RS_Undoable` and `LC_Drawable`. Geometry operations are pure virtual and mutate the entity in place: `move(offset)`, `rotate(center, angle)`, `scale(center, factor)`, `mirror(axisPoint1, axisPoint2)`. Snap and hit queries are non-virtual wrappers around `doGetNearestEndpoint` and `doGetDistanceToPoint`. The layer is held as a raw `RS_Layer*` with a `validatedLayer()` accessor that checks the layer is still registered.
- **Undo (read from `rs_undo.h` and `rs_undocycle.h`):** `RS_Undo` keeps a vector of `RS_UndoCycle` entries and a redo pointer into it. A cycle is "an action that was triggered and can be undone" and stores a `std::set` of pointers to the undoable entities the action affected. Cycles can nest through a reference counter, and `changeUndoState()` flips the undo state of every undoable in the cycle. The header shows the structure, not how deletion is implemented, so I make no claim about whether it stores deltas or relies on state flags.
- **What we took from it, as design contrast (no code reused):**
  - LibreCAD edits entities in place. OpenDraft keeps entities immutable and records `replace` mutations with their inverse, so a failed batch can be rolled back exactly (ADR 0004).
  - LibreCAD references layers by pointer. OpenDraft references layers by name and validates on every mutation, so a deleted layer cannot leave a dangling reference. Nested cycles map to our `batch` mutation.
  - Scale and mirror are pure virtual on every LibreCAD entity. We deliberately deferred them (ADR 0006), and LibreCAD's design shows the cost: every entity type must implement each transform.
- **Decision:** Study-only for conceptual reference (what a 2D drafting app exposes). No code, data tables or structure are copied. GPL-2.0 would force the whole application to GPL, which conflicts with the goal of a permissively reusable open-source core.
- **Still not checked:** the contents of `entities/`, `layers/` and `container/`, the snapping implementation, and `libdxfrw` internals.

## 3. FreeCAD

- **License:** LGPL-2.1 (verified from the repository page).
- **Architecture (README):** Parametric document model with a sketcher (2D sketches with constraints) feeding 3D features. Geometry kernel is OpenCASCADE. 3D scene uses Coin3D (Open Inventor compatible). Python scripting API. GUI is Qt.
- **Document model (read from `src/App/Document.h`):**
  - `App::Document` holds `DocumentObject` instances and exposes `addObject`, `removeObject`, `getObject`, `getObjectByID`. Names are ASCII identifiers, and display names live in a `Label` property.
  - **Recompute:** features are marked "touched" and `recompute(...)` re-evaluates them. A dependency graph supports this: `getInList`, `getDependencyList`, `topologicalSort` and `checkOnCycle`. Signals (`signalBeforeRecompute`, `signalRecomputed`) report progress.
  - **Transactions:** `openTransaction(name, tid)`, `commitTransaction()`, `abortTransaction()`, `undo(id)`, `redo(id)`. Transaction ids group related changes. The undo stack is bounded: `setMaxUndoStackSize` defaults to 20, and `setUndoLimit` is memory-based.
- **Sketcher (`src/Mod/Sketcher/App`, from the file listing only):** separate `Sketch`, `SketchObject`, `Constraint` and `PropertyConstraintList` types, and a `planegcs` directory that looks like the constraint solver. I did not read these files, so solver algorithms and constraint types are **not verified**.
- **What we took from it, as design contrast (no code reused):**
  - A transaction with an id and a name matches our `batch` plus `History` label. FreeCAD's bound on the undo stack is a feature we lack. OpenDraft's history is currently unbounded (added to the roadmap).
  - The recompute graph is what a future constraints module needs: edit a parameter, then re-evaluate dependants in topological order. The 2D MVP has no dependencies between entities, so none of this applies yet.
  - FreeCAD separates "what the object is" (properties) from "what it produces" (shape). We keep entities as plain data and derive geometry in pure functions, which leaves room for the same split later.
- **Decision:** Relevant to the future 3D track and constraints, not to the 2D MVP. The document model is more complex than we need now.
- **Still not checked:** the property system, `GeoFeature`, the Part module, and the solver.

## 4. Geometry libraries

### Maker.js (`makerjs` on npm)

- **License:** Apache-2.0 (`npm view makerjs license`, repository license).
- **Registry:** version 0.19.2, last modified 2026-07-16.
- **Repository:** Microsoft Garage project, about 1,675 commits, 68 open issues. The page did not state whether it is in maintenance mode.
- **Features (per its README):** intersections, chains, points along paths, fillets (including dogbone), boolean union/intersection/punch, path expansion, outlining, scale/distort/rotate/mirror, layout cloning.
- **Limitations (per its README):** Bezier curves and fonts need extra libraries. Import formats are SVG path/points and fonts only.
- **Decision:** Not used in the MVP. The core needs exact control over endpoint, arc and tangency semantics, and the tolerance behaviour must be documented and tested. The library is a candidate for future offset and boolean operations. It can be added behind an interface in `core/geometry` without changing the document model.

### Hand-written core (chosen)

Geometry primitives (segments, circles, arcs, transforms, bounds) live in `src/core/geometry`. They are small and fully unit-tested (see `tests/unit/geometry.test.ts`). This keeps tolerance rules explicit.

## 5. DXF libraries

| Candidate | License | Last registry update | Reads DXF | Writes DXF | Decision |
|---|---|---|---|---|---|
| `@tarikjabiri/dxf` 2.9.0 | MIT | 2026-09-15 | No (writer only) | Yes | **Use for export** |
| `dxf-parser` 1.1.2 | MIT | 2022-06-16 | Yes | No | Stale, not used |
| `dxf-writer` 1.18.4 | MIT | 2023-06-02 | No | Yes | Superseded by the option above |
| `dxf` 5.3.1 | MIT | 2025-09-01 | Partial | Partial | Not evaluated in depth |

- Verified by reading the package's type declarations and by a probe that wrote a real file. The writer emits `$INSUNITS`, LAYER table entries, LINE, LWPOLYLINE (closed flag 70), ARC (angles in degrees), and true colour via group 420 when given a decimal integer string.
- **Decision:** `@tarikjabiri/dxf` for export. `dxf-parser` is stale (last update 2022), so reading is implemented in-house (`src/io/dxf/read.ts`). The reader supports the subset the editor can represent and reports everything else. Read-side correctness is covered by a hand-written DXF fixture (`tests/fixtures/mixed-sample.dxf`) and round-trip tests.

## 6. Rendering: Canvas 2D vs SVG vs WebGL

- **Chosen:** Canvas 2D. Entities are stroked from the document each frame, with view culling by bounds and adaptive grid spacing with a line cap.
- **Evidence:** Our own benchmark (`docs/BENCHMARKS.md`) shows a full-document scan in the tens of milliseconds at 10,000 entities for file I/O, and about 1 ms for object snapping. That is well inside a 16 ms frame at this scale. Canvas rendering was not profiled in the browser beyond a screenshot check. Frame times for large drawings are unmeasured.
- **SVG** was rejected because DOM node counts grow with entity count and hit-testing is already handled in geometry code.
- **WebGL** is deferred until profiling shows Canvas 2D is the bottleneck.

## 7. Testing

- **Vitest** for unit and integration tests (fast, TypeScript-native).
- **Playwright** (`@playwright/test` 1.64.1, Apache-2.0) for end-to-end tests. Chromium was installed and seven browser workflows pass locally.
- **Numerical tolerance:** relative epsilon `1e-9` scaled by coordinate magnitude (`src/core/geometry/tolerance.ts`). Covered by tests with coordinates from 1e-3 up to 1e12.
- **Oracle-style checks:** circles and arcs are verified against closed-form distances, tangency and bulge geometry, not against snapshots of the implementation.

## 8. Desktop packaging (not implemented)

- **Tauri** is dual-licensed Apache-2.0 / MIT. It uses the system webview: WebView2 on Windows, WKWebView on macOS, WebKitGTK on Linux (verified from the repository page).
- **Decision for later:** evaluate Tauri once the browser build is stable. The current code has no Node-only or browser-only APIs beyond file pickers and downloads, which would need a native file-dialog path in Tauri.
- **Not checked:** bundle size and installer behaviour on each OS.

## 9. Future 3D: Open CASCADE Technology (OCCT)

- **License:** LGPL-2.1 with an added exception, plus a commercial licence option (verified from the repository page).
- **Scope:** C++ library for 3D surface and solid modelling.
- **WebAssembly build:** not confirmed. The repository page points to build docs but says nothing about browser targets. Any WASM route is unverified and needs a separate spike.
- **Decision:** No 3D work in this milestone. The route to evaluate later is OCCT compiled to WASM, or a native OCCT sidecar for the desktop build. Both must be measured for download size and load time before choosing.

## 10. Licensing summary

Every direct dependency is MIT or Apache-2.0 (see `THIRD_PARTY_NOTICES.md`). OpenDraft is released under MIT. GPL (LibreCAD) and LGPL (FreeCAD, OCCT) projects were used only as conceptual references. No code was copied from them. See [ADR 0005](ADR/0005-license.md).

## Open questions

1. Does the owner want OpenDraft to use the morluto/rea repository in some way, or was the link a mistake?
2. Is a commercial-friendly license required for future 3D work that depends on LGPL OCCT?
