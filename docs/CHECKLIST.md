# Project checklist

Status key: `[x]` done and tested · `[~]` partly done (the gap is noted) · `[ ]` not started.

Section numbers follow the project brief.

## 4. Research and documents

- [x] `docs/RESEARCH.md`
- [x] `docs/ARCHITECTURE.md`
- [x] `docs/ROADMAP.md`
- [x] `docs/ADR/` (six decision records)
- [x] Licence review (MIT chosen, see ADR 0005)
- [x] LibreCAD architecture: engine layout, entity model and undo read from headers (entities/, layers/, snapping, libdxfrw not read)
- [x] FreeCAD architecture: document, recompute and transactions read from Document.h (property system, Part, Sketcher solver not read)
- [x] Maker.js evaluated (deferred, ADR 0002)
- [x] DXF library comparison (ADR 0003)
- [~] Canvas 2D vs SVG vs WebGL: Canvas chosen, no browser profiling yet
- [~] Desktop packaging (Tauri): licence and webview checked, no spike
- [~] 3D (Open CASCADE): licence checked, WASM build unverified

## 6A. Drawing viewport

- [x] Dark drafting workspace
- [x] Grid rendering (adaptive spacing, line cap)
- [x] Configurable grid spacing (menu bar field, validated)
- [x] Pan (middle drag, Space+drag) and zoom at pointer
- [x] Cursor and coordinate display (status bar)
- [x] High-DPI rendering
- [x] Responsive resize
- [x] Layout checked at 1440×900, 1280×720 and 1024×768 (no horizontal scroll)

## 6B. Drawing entities

- [x] Line
- [x] Polyline (open and closed)
- [x] Rectangle (stored as closed polyline)
- [x] Circle
- [x] Arc (three-point creation)
- [x] Stable entity ids, never reused
- [x] Validation of geometry
- [x] Serialisation of every entity type

## 6C. Interaction tools

- [x] Selection, Shift-toggle, multi-selection
- [x] Window (left to right) and crossing (right to left) selection
- [x] Move
- [x] Copy
- [x] Rotate (base and reference, or typed angle)
- [x] Delete
- [x] Escape cancels, Enter confirms
- [x] Undo and redo
- [x] Explicit tool states with prompts and previews

## 6D. Precision tools

- [x] Absolute coordinates
- [x] Relative and polar coordinates
- [x] Grid snapping
- [x] Endpoint, midpoint, centre snapping
- [x] Intersection snapping (between entities)
- [x] Ortho mode
- [x] Object snap indicators
- [x] Snapping uses geometry, not screen proximity alone
- [~] Configurable drawing units: a metadata setting only, no conversion

## 6E. CAD interface

- [x] Top toolbar with drawing tools and actions
- [x] Layer manager
- [x] Properties panel
- [x] Command input and command history
- [~] Command history recall (Up and Down arrows): not implemented
- [x] Status bar with cursor coordinates
- [x] Grid and snap controls
- [x] Active tool state
- [x] Keyboard shortcuts
- [x] Empty-state hint and error messages
- [x] Original visual identity (no SaaS dashboard styling)

## 6F. Layers and properties

- [x] Create, rename, delete layers (delete moves entities to layer 0)
- [x] Layer visibility
- [x] Layer locking
- [x] Layer colours
- [x] Active layer
- [x] Entity-to-layer assignment
- [x] Entity colour (or ByLayer)
- [~] Entity property editing: layer and colour only, not geometry (endpoints, radius, angles)
- [x] Locked and hidden entities cannot be edited or selected, and geometry cannot be created on a hidden or locked layer
- [x] Layer names follow DXF rules and are unique ignoring case

## 6G. History and persistence

- [x] Undo and redo through mutations, with batch rollback
- [x] New drawing
- [x] Open drawing
- [x] Save drawing (download)
- [x] Versioned native format (version 1, future versions rejected)
- [x] Clear messages for invalid files
- [x] Unsaved-changes prompt on New, Open, Import, and tab close
- [~] Save uses download only, with no file handle (File System Access API not used)

## 6H. DXF interoperability

- [x] LINE, CIRCLE, ARC, LWPOLYLINE (import and export)
- [x] Layers and colours
- [x] Drawing units (`$INSUNITS`)
- [x] Import report for unsupported entities and approximations
- [x] Failed open or import shows a dialog and leaves the drawing unchanged
- [x] DXF mirrored-plane entities are mirrored. Tilted-plane entities are skipped and reported
- [x] Export report for approximated layer colours
- [~] Round trips with real drawings: only a hand-written fixture and generated drawings are tested. No file from AutoCAD or another CAD tool has been tested.
- [ ] Second-reader validation of exported DXF

## 7. Geometry correctness tests

- [x] Coordinate transformations (camera round trip, zoom anchoring, pan)
- [x] Distance calculations
- [x] Point-on-segment
- [x] Segment intersections (crossing, endpoint contact, parallel, nearly parallel)
- [x] Circle intersections (two points, tangent, separated, nested, concentric)
- [x] Point-to-entity distance
- [x] Hit testing (topmost pick, hidden and locked excluded)
- [x] Snapping candidate selection and priority
- [x] Entity transformations (rigid only)
- [~] Polyline editing: no vertex-level editing exists yet
- [x] Bounding boxes
- [x] Undo and redo correctness
- [x] DXF round trips
- [x] Zero-length, duplicate points, very small and very large coordinates, negatives
- [x] Nearly parallel and tangent cases
- [x] Invalid arcs
- [x] Floating-point tolerance (documented, tested from 1e-3 to 1e12)
- [x] Empty and malformed files (4,000 mutated DXF and 4,000 corrupted native files, seeded)
- [x] Random-input property tests for intersections, arcs and transforms
- [x] Tolerances and unit assumptions documented (README)

## 8. Rendering and performance

- [x] React is not re-rendered on pointer movement
- [x] Persistent geometry and transient previews drawn separately
- [x] View culling by bounds
- [x] Benchmark with repeatable script (`npm run bench`, writes `docs/BENCHMARKS.md`)
- [~] Benchmarks cover 1,000 and 10,000 entities only
- [~] Browser frame time: measured for one 5,000-entity drawing only, and paced by the display refresh
- [ ] Spatial index for picking, snapping, and selection
- [~] Bottlenecks identified (entity-list copies, O(n) scans) and recorded in ARCHITECTURE.md; not yet fixed

## 9. UX and visual design

- [x] Compact drafting toolbar
- [x] Large central viewport
- [x] Layer panel
- [x] Context-sensitive properties
- [x] Command line at the bottom
- [x] Tooltips with shortcuts
- [x] Restrained colours and high-contrast geometry
- [x] Keyboard-friendly
- [~] Accessibility: every control has an accessible name, and the modal dialog handles Escape, focus trap and focus restore. Screen reader behaviour and full focus order are not tested

## 10. Open-source quality

- [x] Licence (MIT)
- [x] README with setup, usage, shortcuts, limits, and testing
- [x] Feature list and honest limitations
- [~] Screenshot included; no demo GIF or video
- [x] Contribution guide
- [x] Code of conduct
- [x] Issue templates (bug and feature)
- [x] Pull-request template
- [x] Environment setup instructions
- [x] Architecture documentation
- [x] Testing instructions
- [~] CI workflow written (typecheck, lint, tests, build, e2e); not yet run on GitHub
- [x] Dependency attribution (`THIRD_PARTY_NOTICES.md`)
- [x] No analytics or external services

## 12. Definition of done (milestone 1)

- [x] Runs locally with documented commands
- [x] Grid renders; pan and zoom work
- [x] Lines, circles, rectangles, and polylines can be drawn and selected
- [x] Coordinate transforms correct across zoom and pan
- [x] Snapping works; Escape cancels
- [x] Move and delete work
- [x] Undo and redo for editing operations
- [x] Layers and basic entity properties work
- [x] Drawing can be saved and reopened
- [x] Supported DXF can be imported and exported
- [x] Automated tests cover core geometry and document mutations
- [x] README explains setup, features, limits, and testing
- [~] No known critical errors: none found in the tested workflows, but only Chromium was tested

## Platform audit (2026-10-28)

- [x] Behavioural audit with a Playwright suite (40 tests), fuzzing, property tests and a scale test
- [x] Root cause analysis and fixes for 18 defects, with regression tests for 17. See [AUDIT-REPORT.md](AUDIT-REPORT.md)
- [ ] REA analysis of the production bundle: timed out at 5 and 20 minutes, no result
- [ ] Spatial index (picking and snapping still scan every entity)
- [ ] Bounded history
- [ ] Firefox and Safari testing

## Milestone 2: usability and precision

Plan and evidence: [M2-PLAN.md](M2-PLAN.md). Items change to `[x]` only after the check named on the line has run.

### WP-A. Browser matrix
- [ ] CI has run once on GitHub (precondition)
- [~] Firefox and WebKit projects in `playwright.config.ts` (added and run locally; the CI workflow does not use them yet)
- [x] Rotate test enters the base point by typed coordinates (root cause: WebKit and Firefox truncate pointer coordinates)
- [x] Backspace on a focused dropdown or checkbox no longer navigates away, with a regression test (fails without the fix in WebKit)
- [ ] Line-based wheel zoom test (Firefox path)
- [ ] Middle-button pan test on all engines
- [~] Intermittent failures (Firefox DPR and locked-layer once each; WebKit copy and rotate tests, both 30 s test timeouts that passed on retry) look like load timeouts under parallel workers; the slowness itself is not root-caused
- [~] Browser suite green on Chromium, Firefox and WebKit locally: 199 passed, 2 flaky (retry) with `--workers=2 --retries=1`. Not run in CI yet

### WP-B. Measure at scale
- [~] Benchmarks to 100,000 entities and select-all-delete done; the dense-cluster case is not measured
- [ ] Browser frame time per engine at 5,000 and 50,000 entities
- [x] Exit targets X1 met at 100,000 entities (pick 0.002 ms, snap 0.003 ms, window select 0.024 ms)

### WP-C. Drawing read API and bulk remove
- [x] `forEachEntity`, `boundsOf` cache and creation-order ranks (`entitiesIn`)
- [x] Pick, snap, rectangle selection, select-all and rendering no longer call `entities()` (file I/O and fit-to-extents still do, by design)
- [x] Bulk remove and bulk insert with exact undo order
- [x] Tests: cache correctness after insert, remove, replace, undo, redo and failed batch

### WP-D. Spatial index
- [~] ADR 0007 written (status Proposed); maintainer agreement pending (decision D1)
- [x] Index inside `Drawing`, updated only in `apply` and `loadParts`
- [x] Pick, snap, rectangle selection and the renderer use the index
- [x] Differential test against full scans on random drawings, including undo, redo and a failed batch; three planted index bugs were caught (the test count is smaller than the 30,000 in the plan)
- [x] 100,000-entity targets met (X1) and `docs/BENCHMARKS.md` updated

### WP-E. Render batching (dropped)
- [x] Built and measured on three engines: no faster, reverted (see M2-PLAN.md, C5)

### WP-F. Command history and completion
- [x] `InputHistory` unit tests (cap, duplicates, draft, empty)
- [x] Up and Down recall in the command line (Chromium, Firefox, WebKit)
- [x] Tab completion for command names (Chromium, Firefox, WebKit)
- [x] Tab is not cancelled for empty input, numbers, coordinates, complete commands and Shift+Tab, tested. Found by QA: Tab on an ambiguous prefix that cannot grow trapped focus; fixed (the second Tab is left to the browser), with tests

### WP-G. Editable properties
- [ ] Line start and end
- [ ] Circle centre and radius
- [ ] Arc centre, radius, start and end angle
- [ ] Validation errors shown at the field, drawing unchanged
- [ ] No silent rounding: focus and blur without a change leaves the entity identical
- [ ] One undo step per edit

### WP-H. DXF colour
- [ ] Layer and entity colour index 10 to 255 imported as the table colour
- [ ] Layer true colour (group 420) read on import
- [ ] Layer true colour written on export, one summary warning instead of one per layer
- [ ] Round-trip property test for random `#rrggbb`
- [ ] ACI table sourced, noticed in `THIRD_PARTY_NOTICES.md`, and structure tested (maintainer decision D2)
- [ ] Existing entries for indices 8 and 9 checked against the table

### WP-I. File handles
- [ ] Open keeps the file handle (native format)
- [ ] Save writes in place, Save As asks for a file
- [ ] Cancel is silent, failed write does not mark the drawing saved
- [ ] Download fallback on Firefox and WebKit, tested
- [ ] File name shown in the menu bar
- [ ] Manual pass in Chrome and Edge recorded

### WP-J. Close-out
- [ ] README, ARCHITECTURE, ROADMAP and BENCHMARKS match what shipped
- [ ] `npm run check`, `npm run build` and `npm run e2e` pass
- [ ] QA report attached to the final change

## Open decisions and housekeeping

- [ ] Owner confirms the MIT licence (ADR 0005 says "owner to confirm")
- [ ] Owner confirms the `morluto/rea` link: reference, or a mistake?
- [ ] Initial commit (the repository has `git init` only, nothing committed)
- [ ] Replace the placeholder project name "OpenDraft" if a different name is wanted
- [ ] Run the CI workflow on GitHub
- [ ] Demo GIF for the README
