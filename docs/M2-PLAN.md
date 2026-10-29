# Milestone 2 plan: usability and precision

Status: plan v2 (verified against the code and measurements on 2026-10-29). Owner: to be assigned. Scope source: [ROADMAP.md](ROADMAP.md), milestone 2.

## 1. What changed after verification

Plan v1 was the roadmap list in roadmap order. Checking it against the code and running measurements changed it in six ways. One of the changes (C5) was itself corrected by a later measurement, and the record below keeps both.

| # | Finding (evidence in section 3) | Change to the plan |
|---|---|---|
| C1 | The roadmap says the spatial index "removes the full scans measured in BENCHMARKS.md". Those scans are cheap at 10,000 entities (pick 0.8 ms, snap 1.6 ms). They cross the 16.7 ms frame budget between 50,000 and 100,000 entities (snap 20.8 ms at 100,000). | The index is kept, but justified by the 100,000-entity target, with a measured gate. WP-B (measure first) is added before it. |
| C2 | Roadmap item 2 (no entity copies) is a prerequisite of item 1 (the index needs cached bounds and a rank). | Order swapped: WP-C (Drawing read API) before WP-D (index). |
| C3 | Roadmap item 7 (Firefox, WebKit) came last. Running the existing suite on both engines found real defects and test faults today. | Browser matrix moved first (WP-A) so every later package ships tested on three engines. |
| C4 | Deleting from a large drawing is O(n) per removal (`order.indexOf` plus `splice`). At 100,000 entities, 2,000 removals from the front took 242 ms. Select-all then delete will not scale with the index alone. | WP-C includes a bulk-remove path, gated on a full-delete measurement. |
| C5 | First reading: at 5,000 entities a pointer-move frame cost 109 ms in WebKit and 147 ms in Firefox against 18.7 ms in Chromium, so render batching (WP-E) was added as a conditional package. **Falsified by measurement.** The 147 ms came from running with parallel workers. Alone, the old renderer takes 22 to 26 ms in Chromium and Firefox. A batched renderer was built and measured and was no faster (27 to 45 ms on those two, 122 to 127 ms on WebKit against 94 to 112 ms). It was reverted. | WP-E is dropped. The frame guard is changed to bound the cost the entities add (see section 3). |
| C6 | Roadmap item 5 ("ACI table for all 256 indices") is the wrong first step. The DXF library has no table, and entity colours already round-trip exactly through true colour. The real defects are on import: indices 10 to 255 are dropped, and layer true colour is ignored. | WP-H is re-scoped to import correctness first, then exact layer export through group 420, then the table. |

## 2. Goals, non-goals, exit criteria

**Goals.** Make the application hold up at 100,000 entities, make precision input faster to use, make properties editable by value, make DXF colour handling correct for real files, and keep the work tested on Chromium, Firefox and WebKit.

**Non-goals (milestone 3 or later).** Trim, extend, offset, fillet, chamfer, scale, mirror, polyline vertex editing, new entity types, TEXT, blocks, desktop packaging, 3D. Multi-entity numeric editing. Persisting command history across sessions. A recent-files list.

**Exit criteria.** Each is checked by a command, not by opinion.

| ID | Criterion | Check |
|---|---|---|
| X1 | At 100,000 entities (median, Node): pick under 0.5 ms, object snap under 1 ms, 50x50 window select under 1 ms. Targets are provisional and are frozen in the WP-B change once the new baseline is recorded. | `npm run bench` |
| X2 | Index results equal brute-force results for pick, snap candidates and rectangle selection on 30,000+ random cases, including after undo, redo and batch rollback. | `npm test` |
| X3 | The browser suite passes on Chromium, Firefox and WebKit in CI. | `npm run e2e`, CI matrix |
| X4 | The cost 5,000 entities add to a pointer-move frame is recorded per browser (today: Chromium 3.5 ms, Firefox 4.1 ms, WebKit 31 ms). The guard stays at 100 ms of added cost. | `npm run e2e` |
| X5 | Up/Down recall and Tab completion work, and Tab never traps keyboard focus. | e2e |
| X6 | Line, circle and arc geometry can be edited by value, with validation, one undo step per edit, and no silent rounding. | unit, e2e |
| X7 | Layer and entity colours round-trip exactly (export then import) for any `#rrggbb`. Imported ACI indices 1 to 255 produce the table colour. | unit, property test |
| X8 | Save writes to the opened file through a file handle where the browser supports it, and falls back to download elsewhere. A failed or cancelled save never marks the drawing saved. | e2e with a file-system double |
| X9 | `npm run check`, `npm run build` and `npm run e2e` pass. README, CHECKLIST, ARCHITECTURE and BENCHMARKS match what shipped. | commands, review |

## 3. Verified baseline

Everything here was run or read on 2026-10-29. Nothing is carried over from earlier reports.

**Test baseline.** `npm run check`: typecheck and lint clean, 197 unit and integration tests pass.

**Scaling of the current scans** (Node 24, i5-1235U, synthetic grid of lines and circles, one run, median of 9 samples of 5 calls; the tolerance is 0.5 so each query touches few entities):

| Entities | pick ms | object snap ms | window select ms | `entities()` copy ms | first 2,000 removals ms |
|---|---|---|---|---|---|
| 10,000 | 0.78 | 1.57 | 0.50 | 0.17 | 29 |
| 50,000 | 4.49 | 9.62 | 4.00 | 1.73 | 101 |
| 100,000 | 14.48 | 20.80 | 13.03 | 7.33 | 242 |
| 200,000 | 36.17 | 62.97 | 21.97 | 12.71 | 328 |

Growth is faster than linear from 10,000 to 100,000 (pick 18x, snap 13x for 10x the entities), which fits the entity list falling out of cache. These are single runs on one machine, so use them for the shape of the curve, not for exact values. The snapping work runs on every pointer move.

**Browser suite on the unchanged tests** (49 tests in `tests/e2e`):

| Engine | Result | Failures |
|---|---|---|
| Chromium | 49 pass (audit report) | none |
| WebKit (Playwright build, Windows) | 46 pass, 3 fail | rotate test, Delete-in-dropdown test, frame-time guard |
| Firefox 157 | 45, 46, 47 pass over three full runs | rotate test and frame-time guard every run; DPR test and locked-layer test failed once each and passed alone and in later runs |

After the fixes in WP-A (rotate test, Backspace, guard), the three previously failing tests pass on WebKit and the Firefox failures that repeated are gone. A full three-engine run is recorded in the checklist when it has been done.

**Root cause analysis of the browser failures**

| Failure | Root cause | Evidence | Class | Resolution |
|---|---|---|---|---|
| Rotate about a clicked base point ends at (0.0094, -4.99) instead of (0, -5) in WebKit and Firefox | The test sends a fractional pointer coordinate. The canvas top is at y = 41.1875 and the test clicks at 435.1875. Chromium delivers the fraction, while WebKit and Firefox truncate to 435. The 0.1875 px error is 0.1875 / 20 = 0.0094 units. The rotate base point is not snapped because the selection being moved is excluded from snapping. | Probe on all three engines: sent 435.1875, received 435.1875 (Chromium) and 435 (WebKit, Firefox). Observed offset matches to four digits. | Test fault (the expectation assumed sub-pixel input) | Enter the base point by typed coordinates. Intent unchanged. |
| Backspace on a focused dropdown navigates the page away in WebKit | `useShortcuts` returns early for dropdowns (`typing`) without `preventDefault`. This WebKit build treats Backspace outside a text field as history-back. | Probe: URL goes from `http://localhost:5173/` to `about:blank` after Backspace, and the panel is gone. Chromium and Firefox stay put. | Product defect in this engine (an unsaved drawing is lost unless the unload prompt fires). Whether current Safari on macOS behaves the same is not verified. | Prevent the default for Backspace on a dropdown. Regression test asserts the URL and the selection. |
| Frame guard exceeded (WebKit 109 ms, Firefox 147 ms) | Two causes. (1) Firefox: load. The 147 ms came with parallel workers, and alone the unchanged renderer takes 22 to 26 ms. (2) WebKit: an empty drawing already costs 45 to 50 ms per frame against a 16 ms frame interval, so most of its cost is the canvas clear, fill and grid in this build; 5,000 entities add about 31 ms. The 100 ms bound was calibrated on Chromium and compared total frame time. | Probe on an empty drawing: Chromium 16.6, Firefox 14.8, WebKit 45.0 ms per frame, bare frame interval 16.7, 14.9, 16.2. Old and new renderer compared two rounds per engine. | Test fault (the guard measured the engine, not the entities) | The guard subtracts the same engine's empty-drawing frame time and bounds the difference at 100 ms. The threshold is unchanged. The batching hypothesis was tested and rejected (see C5). |
| DPR test and locked-layer test failed once each in Firefox | Not determined. Both pass alone (11 to 14 s each) and in two later full runs. | The error text of the failing run was not captured. | Unexplained intermittent failure | Tracked as an open item. WP-A captures traces on first retry and records the error before any claim of a cause. |

**Other facts checked in the code**

- `Drawing.entities()` copies the list. It is called from eight places: selection (3), snapping (1), DXF writer, native serializer, fit-to-extents (2) and the renderer on every frame.
- `Drawing.apply` is the only mutator, so an index owned by `Drawing` keeps the project rule intact.
- `History.execute` with a `coalesceKey` merges any consecutive same-key edit with no time bound. Fine for a colour picker drag. Wrong for typed property edits, because two deliberate edits of the same field would become one undo step.
- `PropertiesPanel` formats numbers with `toFixed(4)`. An editable field built on that text would silently round geometry on blur.
- `ACI_PALETTE` has nine entries and `nearestAci` searches only 1 to 7. `readCommon` turns any other index into "ByLayer" with a warning, and the layer reader replaces it with white.
- `@tarikjabiri/dxf` has no colour table, but `DxfLayer.trueColor` exists and is written as group 420. The reader does not read group 420 on layers.
- File System Access is Chromium only and needs a secure context (`localhost` counts). Playwright cannot drive its native dialogs.
- Playwright's WebKit build is not Safari. A pass there is not a Safari pass.

## 4. Work packages

Sizes are engineer-days for one engineer who knows the code, with the main uncertainty named. Packages are listed in dependency order.

### WP-A. Browser matrix (roadmap item 7) · 2 days · uncertainty: unknown Firefox failures

- Add `firefox` and `webkit` projects to `playwright.config.ts`. CI runs a matrix of three browsers with `--with-deps`, traces on first retry, one retry in CI only.
- Fix the rotate test (typed base point) and the Backspace defect, each with a regression test.
- Add tests for what the audit marked untested: line-based wheel zoom (`deltaMode` 1, the Firefox path), and middle-button pan on all engines.
- Policy for a cross-browser failure: find the root cause, then fix the product or fix a wrong test and say why. A `test.fixme` needs an issue link and a written cause.
- Precondition: push the branch and run CI once. The workflow has never run on GitHub.
- Done when X3 holds. Claims in the docs say "Chromium, Firefox and Playwright WebKit", never "Safari".

### WP-B. Measure at scale · 1 day

- Extend `tests/bench/geometry.bench.ts` to 50,000 and 100,000 entities, add a dense cluster scenario (500 overlapping entities at the cursor) and a full select-all-then-delete timing.
- Add a browser frame-time measurement per engine at 5,000 and 50,000 entities.
- Freeze X1 targets from the new baseline. Gate for WP-D: proceed only if the 100,000-entity baseline misses the targets by more than 2x (the table above says it does).

### WP-C. Drawing read API and bulk remove (roadmap item 2) · 1.5 days

- Add to `Drawing`: `forEachEntity(fn)` (no allocation), `boundsOf(id)` backed by a bounds cache filled in `apply` and `loadParts`, and `rankOf(id)` for creation order. Keep `entities()` for I/O, where a snapshot is the right semantics.
- Move picking, snapping, selection, rendering and fit-to-extents off `entities()`.
- Bulk remove: apply a batch of removals in one pass instead of one `indexOf` and `splice` each. The inverse is built from the original indices so undo restores the exact order.
- Rule, documented in the JSDoc: no mutation inside `forEachEntity`. The hot paths are read-only, so no runtime guard is added.
- Tests: iteration order equals `entities()` order, bounds cache stays correct after insert, remove, replace, undo, redo and a failed batch, bulk-remove undo restores order exactly.

### WP-D. Spatial index (roadmap item 1) · 4 days · uncertainty: index maintenance under undo, ordering

- Decision record: ADR 0007. Recommendation: an own R-tree in `src/core/spatial/` (about 200 lines, bulk load by sort-tile-recursive on `loadParts`, incremental insert and remove on `apply`). Reason: entity sizes differ by many orders of magnitude and coordinates are unbounded (tests run to 1e12), which makes a uniform grid degenerate for long lines. Alternative: the MIT `rbush` package. Choose it instead if a one-day spike shows the own tree is more than 1.5x slower or needs more than a day of debugging.
- The index lives inside `Drawing`, updated in `insert`, `remove`, `replace` and `loadParts`. A failed batch rolls back through the same path, so the index follows the entities.
- Queries: `entitiesNear(point, tolerance)` and `entitiesIn(rect)`, returning entities in creation order. Order comes from the rank cache (a map rebuilt lazily after an insert or remove, not after a replace), so the topmost-wins rule of picking is unchanged.
- Callers: `pickEntity`, `findObjectSnap` (including the intersection pass), `selectByRectangle` and the renderer's visible set. The renderer falls back to a linear pass when the visible fraction is large, because a fit-all view needs everything and sorting 100,000 results per frame would cost more than the scan.
- Tests: differential property test against the brute-force functions on 30,000+ random cases (mixed entity types, wide size range, tolerance 0 to large); same checks after random undo and redo sequences and after a failing batch; empty drawing; one entity; all entities at one point; huge and tiny coordinates. Benchmarks to 100,000 entities into `docs/BENCHMARKS.md`.
- Done when X1 and X2 hold. If X1 is missed, the change does not merge (AGENTS.md: an abstraction must remove complexity you can point to).

### WP-E. Render batching · dropped

Built, measured and reverted. Drawing consecutive same-style entities in one path did not reduce frame time on any engine (two rounds each, old against new: Chromium 22 and 26 against 40 and 33 ms, Firefox 25 and 22 against 45 and 28 ms, WebKit 94 and 112 against 127 and 122 ms). The rendering cost at 5,000 entities is small in Chromium and Firefox (3.5 and 4 ms added) and the large WebKit cost sits mostly outside entity drawing. Revisit rendering only with a profile at 50,000 entities from WP-B, because an index does not help a fit-all view that draws everything. Level-of-detail culling and offscreen caching are the candidates then.

### WP-F. Command history and completion (roadmap item 3) · 1.5 days

- `InputHistory` class in `src/state` (no React): `push`, `previous(draft)`, `next`, `reset`. Records every non-empty submission, skips consecutive duplicates, caps at 200, keeps the unsent draft so Down past the newest entry restores it. In memory only.
- `CommandLine` handles ArrowUp and ArrowDown and moves the caret to the end.
- Tab completion over the full command names (LINE, CIRCLE, ...) from `TOOL_INFO` and the non-tool commands. Unique prefix completes. Several matches complete to the common prefix and list the candidates in the command log. Tab does nothing special, so focus moves on, when the field is empty, looks like a coordinate or number, already equals a command, or matches nothing. Shift+Tab is never touched.
- Tests: unit tests for `InputHistory` (cap, duplicates, draft, empty), unit tests for completion, e2e for recall and for Tab leaving the field from an empty input.

### WP-G. Editable properties (roadmap item 4) · 2.5 days

- Fields: line start and end, circle centre and radius, arc centre, radius, start angle and end angle (degrees in the UI, radians stored). Polyline vertices are milestone 3.
- Commit on Enter or blur only if the text differs from what was shown. Escape reverts. Fields show full precision (12 significant digits), never the 4-digit display rounding, so tabbing through a field cannot alter geometry.
- One `replace` mutation per commit through `session`, no `coalesceKey`. Errors from `entityValidationError` appear next to the field (`aria-invalid`, message in a live region), the drawing and history stay untouched.
- The session method rejects non-editable (hidden or locked) entities, like the other selection edits.
- Tests: unit and session tests for each field, invalid values (zero radius, zero-length line, `start == end` arc, `NaN`, `Infinity`, empty, `1,5`), undo restores the exact previous value, focus without edit leaves the entity identical (`===`), locked layer refuses. E2E for the circle radius flow.

### WP-H. DXF colour (roadmap item 5, re-scoped) · 3 days · uncertainty: table provenance

1. **Import first.** Layer colour: read group 420 (true colour) if present, else group 62 through the table. Entity colour: 420 first (already), else 62 through the table. Today indices 10 to 255 become ByLayer with a warning and layers fall back to white.
2. **Export exact layer colours.** Set `DxfLayer.trueColor` for every layer, so `#rrggbb` round-trips exactly. Keep the nearest ACI index as the fallback for readers that ignore group 420, searched over the full table. Replace the per-layer "approximated" warning with one line, because the file is now exact for readers that honour true colour.
3. **The table.** `src/io/dxf/aci.ts`, 256 entries. Do not type it from memory. Source it from a permissively licensed implementation (ezdxf is MIT), record the source in `THIRD_PARTY_NOTICES.md`, and test its structure (256 entries, indices 1 to 9 as already used, 250 to 255 a monotonic grey ramp, no invalid hex). Check the existing entries 8 and 9 against it, and fix them if they differ. Index 7 stays the display colour `#e6e6e6` by design.
- Maintainer decision D2 (source of the table) is needed before step 3 merges.
- Tests: property test over random `#rrggbb` for layers and entities (export, import, equal), a fixture with indices 30, 140 and 253, an export that a second parse of the text can read back, entries 8 and 9 asserted against the sourced table.
- Not claimed: AutoCAD or any third-party reader honours group 420 on layers. Second-reader validation stays in milestone 4.

### WP-I. File handles (roadmap item 6) · 3 days · uncertainty: handle permission edge cases

- `src/app/files.ts` gets two implementations of one small interface (handle-based and download-based) selected by feature detection. The handle lives in the app layer only, never in `src/core`.
- Semantics: Open (native format) keeps the handle. Save writes in place with no dialog. Save As asks for a file. DXF export and import never change the handle. The current file name is shown in the menu bar.
- Failure rules: the picker being cancelled (`AbortError`) is silent. `markSaved` runs only after `close()` resolves. A permission or not-found error shows a dialog and offers Save As. A failed Open leaves both the drawing and the handle unchanged (the F05 rule).
- Types: check whether `lib.dom` declares the pickers. If not, add a small local declaration, not a types package.
- Tests: Playwright stubs `showOpenFilePicker` and `showSaveFilePicker` with handles from the origin-private file system (`navigator.storage.getDirectory()`), which are real handle objects. Fallback tests run on all three engines. A manual pass in Chrome and Edge is recorded in the checklist, since the stub cannot prove the native dialog.
- Whether OPFS handles expose `queryPermission` and `requestPermission` is verified in the first hour. If they do not, the code calls them with optional chaining and the double adds them.

## 5. Order, parallelism and pull requests

```
WP-A ──► WP-B ──► WP-C ──► WP-D
  │
  ├──► WP-F ─┐
  ├──► WP-G ─┼──► WP-J  docs, benchmarks, checklist, README
  ├──► WP-H ─┤
  └──► WP-I ─┘
```

WP-F to WP-I touch different files and can run in parallel after WP-A. WP-F and WP-G both edit `EditorSession.ts`, so merge them in sequence. About 16 engineer-days in total for one engineer.

| PR | Conventional title |
|---|---|
| 1 | `test(e2e): run browser workflows on Firefox and WebKit` (config, CI matrix, test fixes) |
| 2 | `fix(shortcuts): stop Backspace on a dropdown navigating away` |
| 3 | `perf(bench): measure to 100,000 entities and record browser frame time` |
| 4 | `perf(core): add allocation-free entity reads, bounds cache and bulk remove` |
| 5 | `docs(adr): choose the spatial index` then `perf(core): add spatial index for pick, snap and selection` |
| 6 | `feat(command): recall history with arrow keys and complete command names` |
| 7 | `feat(properties): edit line, circle and arc geometry by value` |
| 8 | `fix(io): read all ACI colours and layer true colour` then `feat(io): export exact layer colours` |
| 9 | `feat(files): save in place through file handles with download fallback` |
| 10 | `docs: milestone 2 status` |

## 6. Risks

| Risk | Likelihood | Effect | Mitigation |
|---|---|---|---|
| Index and entity list drift apart after undo or a failed batch | Medium | Missed picks, ghost entities | Index owned by `Drawing`, updated only in `apply`/`loadParts`, differential test after random undo and redo |
| Index gains less than expected | Low | Wasted work | WP-B gate and the X1 merge condition |
| Firefox or WebKit expose more defects than the three found | Medium | WP-A runs over | Time-box triage, fix by root cause, record the rest as checklist items |
| ACI table source is not acceptable | Medium | Step 3 of WP-H blocks | Steps 1 and 2 ship without the table for index 10 to 255 only if D2 is unresolved; the 420 path already makes our own files exact |
| Typed property edits alter geometry silently | Medium | Data corruption | Full-precision fields, commit only on change, `===` test |
| Tab completion traps keyboard users | Low | Accessibility regression | Tab only acts on a non-empty prefix match; e2e test that Tab leaves an empty field |
| File handle write fails halfway | Low | Lost work | Write via `createWritable` and commit on `close()`; mark saved only after close; keep the unsaved prompt |
| The frame guard flakes under load | Medium | False failures | It already did once (Firefox, 147 ms with parallel workers). The guard bounds added cost at 100 ms against a 3 to 31 ms measurement, and per-browser numbers are recorded, not asserted |

## 7. Decisions needed from the maintainer

Work proceeds on the recommended default for each until told otherwise.

| ID | Decision | Default |
|---|---|---|
| D1 | Own R-tree or `rbush` | Own R-tree, `rbush` if the spike fails (ADR 0007) |
| D2 | Source of the 256-entry ACI table | ezdxf (MIT) with a notice; no table typed from memory |
| D3 | Write group 420 on every layer | Yes |
| D4 | Save writes in place once a file was opened | Yes, with Save As for a new target |
| D5 | Record command history across sessions | No |
