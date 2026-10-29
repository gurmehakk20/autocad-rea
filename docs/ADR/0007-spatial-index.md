# ADR 0007: Spatial index inside `Drawing`, an own R-tree

- Status: Proposed (maintainer to confirm, decision D1 in `docs/M2-PLAN.md`)
- Date: 2026-10-29

## Context

Picking, object snapping, rectangle selection and rendering each scanned every entity. Measured on one machine (Node 24, i5-1235U, synthetic drawing, median), the cost grows faster than linearly:

| Entities | pick ms | object snap ms | window select ms |
|---|---|---|---|
| 10,000 | 0.78 | 1.57 | 0.50 |
| 50,000 | 4.49 | 9.62 | 4.00 |
| 100,000 | 14.48 | 20.80 | 13.03 |

Snapping runs on every pointer move, and at 100,000 entities it exceeds a 16.7 ms frame.

## Decision

`Drawing` owns a dynamic R-tree (`src/core/spatial/rtree.ts`, about 250 lines). It is updated only inside `Drawing.apply` and `Drawing.loadParts`, so the rule that `apply` is the only place that changes entities still holds, and a failed batch rolls the index back through the same code.

- The tree stores each entity's reach, which is its bounds united with its snap points. An arc's centre is a snap point and can lie outside the arc's bounds. Indexing bounds alone would silently stop snapping to arc centres.
- `Drawing.entitiesIn(area)` returns a superset of the entities touching `area`, in creation order, so callers keep their exact tests and the topmost-wins rule of picking.
- Creation order comes from a rank map that is rebuilt on demand after an insert or remove. A search that covers the whole tree skips the tree and the sort.
- `loadParts` packs the tree with sort-tile-recursive. Single inserts use least-area-growth choice and the quadratic split.
- `batch` mutations made only of removes, or only of inserts at strictly ascending positions, are applied in one pass instead of one list splice per entity.

## Consequences

- Measured after the change at 100,000 entities (`docs/BENCHMARKS.md`): pick 0.002 ms, snap 0.003 ms, window select 0.024 ms. Select-all, delete and undo together take about 0.67 s in that benchmark, where the drawing is built by single inserts. Before the bulk paths, 2,000 single removals alone took 242 ms at this size.
- Loading a drawing costs more: building the index adds roughly 150 ms at 100,000 entities.
- Remove does not re-insert underfull nodes, so heavy deletion loosens the tree until the next `loadParts`. This affects speed, not results.
- Correctness rests on a differential test: the indexed results must equal the results of the old full scans on random drawings, including after random undo and redo and after a failed batch.

## Alternatives considered

- A uniform grid: entity sizes span many orders of magnitude and coordinates are unbounded (tests run to 1e12), so a long line would occupy millions of cells.
- The `rbush` package (MIT): a good fit and well tested. Not chosen because the tree is small, the differential test covers it, and the project keeps its geometry and document core free of third-party code (ADR 0002). Switching later changes one file.
- Rebuilding a packed tree after every edit: simple, but about 200 ms per edit at 100,000 entities.
