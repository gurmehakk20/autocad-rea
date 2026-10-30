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
- [x] Save writes in place through a file handle where the browser has the File System Access API, and downloads elsewhere

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
- [x] Spatial index for picking, snapping, and selection (milestone 2, ADR 0007)
- [x] Bottlenecks identified (entity-list copies, O(n) scans) and fixed in milestone 2. Next bottleneck: rendering a fitted 50,000-entity drawing

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
- [x] Spatial index (milestone 2)
- [ ] Bounded history
- [~] Firefox and Playwright WebKit tested (milestone 2). Real Safari on macOS is not tested

## Milestone 2: usability and precision

Plan and evidence: [M2-PLAN.md](M2-PLAN.md). Items change to `[x]` only after the check named on the line has run.

### WP-A. Browser matrix
- [ ] CI has run once on GitHub (precondition)
- [x] Firefox and WebKit projects in `playwright.config.ts`, and a three-browser CI matrix with one retry in CI (the workflow has not run on GitHub)
- [x] Rotate test enters the base point by typed coordinates (root cause: WebKit and Firefox truncate pointer coordinates)
- [x] Backspace on a focused dropdown or checkbox no longer navigates away, with a regression test (fails without the fix in WebKit)
- [x] Line-based and page-based wheel zoom tests (`tests/e2e/wheel-modes.spec.ts`, all three engines)
- [x] Middle-button pan test passes on all three engines (it was already in the audit suite)
- [~] Intermittent failures (Firefox DPR and locked-layer once each; WebKit copy and rotate tests, both 30 s test timeouts that passed on retry) look like load timeouts under parallel workers; the slowness itself is not root-caused
- [~] Browser suite green on Chromium, Firefox and WebKit locally: 199 passed, 2 flaky (retry) with `--workers=2 --retries=1`. Not run in CI yet

### WP-B. Measure at scale
- [x] Benchmarks to 100,000 entities, select-all-delete, and dense cases (overlapping and concentric circles). Dense true overlap is still quadratic: 200 circles about 11 ms, 500 about 65 ms
- [x] Browser frame time per engine at 5,000 and 50,000 entities (`tests/e2e/scale-50k.spec.ts`). Fitted 50,000 entities cost 215 to 575 ms per frame: rendering is the next bottleneck
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
- [x] Line start and end (X and Y each)
- [x] Circle centre and radius
- [x] Arc centre, radius, start and end angle (degrees in the UI; unit-tested, not browser-tested)
- [x] Validation errors shown at the field, drawing and history unchanged
- [x] No silent rounding: focus and blur without a change records nothing (browser test fails if the guards are removed)
- [x] One undo step per edit, never merged

### WP-H. DXF colour
- [x] Layer and entity colour index 1 to 255 imported as the table colour (all 255 tested)
- [x] Layer true colour (group 420) read on import, priority over the index
- [x] Layer true colour written on export, one summary warning instead of one per layer (not tested against a third-party reader)
- [x] Round-trip test for 400 random layer and 400 random entity colours, and for all 255 palette colours
- [~] ACI table generated by script from ezdxf (MIT), licence text in `THIRD_PARTY_NOTICES.md`, structure tested. Decision D2 is still open for the maintainer; I used the plan default. The source palette is AutoCAD 2020 dark-background, so index 7 is overridden to the workspace off-white
- [x] Existing entries for indices 8 and 9 checked against the table: both match (#808080, #c0c0c0)

### WP-I. File handles
- [x] Open keeps the file handle (native format)
- [x] Save writes in place, Save As asks for a file (Ctrl+S, Ctrl+Shift+S, buttons)
- [x] Cancel is silent; a failed write shows why and does not mark the drawing saved; an edit made during the write keeps the drawing unsaved
- [x] Download fallback on Firefox and WebKit, tested
- [x] File name and unsaved mark shown in the menu bar (already present; now tested)
- [ ] Manual pass in Chrome and Edge recorded (the tests use stand-in pickers backed by the browser file system; the real dialogs and permission prompts are unverified)

### WP-J. Close-out
- [x] README, ARCHITECTURE, ROADMAP and BENCHMARKS match what shipped (reviewed against the code; ROADMAP lists what is still open)
- [~] `npm run check` (667 tests) and `npm run build` pass. The last complete browser run (Chromium, Firefox, Playwright WebKit) was 279 passed, 1 flaky, 26 skipped, with 3 failures that were the QA repro fixed afterwards; after that one-line fix the geometry-field and properties specs were re-run on all three engines (36 passed), but the complete suite was not
- [x] QA review ran on every part of milestone 2. It found a Tab focus trap and four defects in work packages G to I; all five are fixed with regression tests

## Open decisions and housekeeping

- [ ] `src/state` breaks an AGENTS.md rule that is already on main: `session.ts` imports React and `EditorSession.ts` imports `src/viewport/camera`. Maintainer to decide whether to move the camera transform into `src/core` and split the React hook out
- [ ] Owner confirms the MIT licence (ADR 0005 says "owner to confirm")
- [ ] Owner confirms the `morluto/rea` link: reference, or a mistake?
- [x] Initial commit (the repository has history; this line was stale)
- [ ] Replace the placeholder project name "OpenDraft" if a different name is wanted
- [ ] Run the CI workflow on GitHub
- [ ] Demo GIF for the README
