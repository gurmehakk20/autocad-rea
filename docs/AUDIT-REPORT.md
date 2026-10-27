# Platform audit report

Date: 2026-10-28 · Scope: the whole application at commit `c732799` (milestone 1) · Result: 18 defects found and fixed. 17 have regression tests. F18 is a hardening change without one, and parts of F07 and F13 come from code review and were not reproduced (marked below).

## Method

1. **Behavioural audit (Playwright).** 40 tests written as statements of what a user should be able to rely on, then run against the unfixed code. 23 failed and 17 passed first time. Each failure was analysed before anything was changed, and one failure turned out to be a mistake in my test, which I corrected. The passes confirm those behaviours (see "Verified sound").
2. **Fuzz tests.** 4,000 randomly mutated DXF files and 4,000 corrupted native files. Each must load, or be rejected with the expected error type. Seeded and deterministic.
3. **Property tests.** About 30,000 random geometry cases checked against mathematical invariants (intersection points lie on both shapes, a three-point arc passes through its points, rigid transforms preserve lengths, and so on).
4. **Scale test.** A 5,000-entity drawing in a real browser.

## Findings

| # | Severity | Symptom | Root cause | Fix |
|---|---|---|---|---|
| F01 | High | Importing a DXF with an entity on a blank layer name threw an unhandled error and showed no message (reproduced by the fuzz test and a browser test) | The reader did not normalise a blank layer name at the boundary, and the loader only caught one of the error types it could throw | Blank means layer 0. All load failures are now caught and reported |
| F02 | High | DXF circles, arcs and polylines drawn on a mirrored plane (extrusion −Z) imported in the wrong place, silently | The extrusion direction (group codes 210–230) was ignored | −Z mirrors x, reverses arc sweep and flips bulge. Tilted planes are skipped and reported |
| F03 | Medium | A DXF without a layer table warned that layer 0 was undefined | The reader checked entities against layers before adding the implicit layer 0 | Layer 0 is created first |
| F04 | High | After opening a file whose saved id counter was behind its entities, no new entity could be drawn ("already exists") | Id allocation trusted the saved counter and never checked ids in use | Allocation skips used ids. Loading raises the counter above the highest id |
| F05 | Medium | A rejected Open or Import wrote one line in the command log | Errors were returned to nobody | A dialog states the reason and that the drawing is unchanged |
| F06 | Medium | With a dropdown focused, Delete/Backspace deleted the selection and letters switched tools | Dropdowns were not treated as typing targets | Dropdowns own their keys |
| F07 | Medium | Space and Enter did not activate focused buttons (reproduced) | The shortcut handler intercepted Space and Enter globally. A mouse click also left focus on the button, so a later Enter could press it again (this second part is from code review, not reproduced) | Keys go to focused buttons. Mouse clicks release button focus |
| F08 | Medium | Locking or hiding a layer left its entities selected, so edits silently did nothing | Layer changes did not prune the selection | Selection is pruned after every layer change |
| F09 | Medium | Drawing on a hidden or locked layer created objects the user could not see or select | No check at the point of creation | Creation is refused with a message that names the layer |
| F10 | Medium | Layer names with characters DXF forbids, or that differ only by case, were accepted and exported | No naming rules | DXF's rules enforced at add and rename. Case-insensitive uniqueness |
| F11 | Low | Dragging a colour picker created dozens of undo steps | Every input event was its own history entry | Same-key edits merge into one step. Dirty tracking stays correct |
| F12 | Low | The zoom readout did not update on wheel zoom. Trackpads zoomed in 15% jumps | The wheel notified only the canvas, not the UI. Fixed factor per event | Both channels notify. Zoom scales with the wheel delta |
| F13 | Low | The crosshair and coordinates stuck after the pointer left the canvas (reproduced). A cancelled pointer or lost window focus could leave a drag or the Space modifier stuck (from code review; the blur test passes against the old code too, because the key-up still arrives in the test) | No handler for pointer leave, pointer cancel or window blur | All three handled |
| F14 | Low | Grid spacing could not be changed in the UI | Setting existed in the session only | Spacing field in the menu bar, with validation |
| F15 | Low | Escape did not clear text typed in the command line | Not handled | Escape clears it |
| F16 | Medium | The dialog could not be closed with Escape, focus could leave it, and shortcuts acted on the drawing behind it | No keyboard handling for the modal | Escape, focus trap and restore. Shortcuts are disabled while it is open |
| F17 | Low | Arc angles grew without bound under repeated rotation | Rotation added to the stored angles | Angles are normalised to [0, 2π) |
| F18 | Low | Browser zoom could leave the canvas at the wrong pixel density | Only container resize was observed | Window resize also re-measures (not covered by a test) |

## Verified sound

Pan (middle button and Space-drag), zoom anchoring, window and crossing selection, move, copy, rotate (typed angle), delete and undo, ortho, endpoint snap, rename-cancel on a layer, unsaved-work prompts, high-DPI canvas, 1280×720 and 1024×768 layouts, no console errors in any flow, and every control has an accessible name. The fuzz and property tests found no further defects. I checked that the fuzz test can catch a real defect by restoring the old reader: it failed on F01 in under a second.

## Test results

| Suite | Before | After |
|---|---|---|
| Unit and integration (Vitest) | 137 | 197 |
| Browser (Playwright, Chromium) | 9 | 49 |
| Type check, lint, production build | pass | pass |

Scale: a 5,000-entity drawing imports in roughly 200–300 ms. Select-all, delete and undo each complete in tens of milliseconds. A pointer-move frame measured 18.7 ms, which is paced by the display refresh, so it shows the drawing cost fits inside a frame on this machine and not a precise figure.

## Not fixed, and not verified

- **REA analysis of the bundle produced no result.** It stopped at its own limit after 5 minutes, and again after 20 minutes, on the 373 KB minified bundle. I did not count the "no external services" requirement as REA-verified. My own scan found no network calls other than Vite's same-origin module preload, and no analytics, beacons or WebSockets.
- Picking and snapping still scan every entity, and the entity list is copied on each call. Measured acceptable to 10,000 entities. A spatial index is the next step.
- History is unbounded.
- Old-style DXF `POLYLINE` entities are skipped, and their `VERTEX` records inflate the "skipped" list.
- Only Chromium is tested. The line-based wheel path (Firefox) and browser-zoom handling have no test.
- Screen-reader behaviour was not tested. Only accessible names and the dialog's keyboard handling were.
- DXF round trips use a hand-written fixture and generated drawings, not files from AutoCAD.
