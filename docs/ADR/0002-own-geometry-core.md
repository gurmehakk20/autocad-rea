# ADR 0002: Own geometry core, no geometry-kernel dependency for the MVP

- Status: Accepted
- Date: 2026-10-27

## Context

The brief asks for accurate geometry, explicit tolerances, and a core that can later be swapped for a specialised kernel. Maker.js (Apache-2.0) offers booleans, offsets and intersections, but its semantics for endpoints, tangency and tolerance are not documented at the level this project needs.

## Decision

Implement the primitives needed for the MVP in `src/core/geometry` and `src/core/entities`: segments, circles, arcs, bounds, rigid transforms and entity operations. Every comparison goes through `tolerance.ts`. Each primitive has tests for its edge cases (zero-length, tangency, near-parallel, large and small coordinates).

## Consequences

- We control and document numerical behaviour, and we can test it directly.
- Operations Maker.js covers and we do not (fillets, booleans, offsets) are not available. They are roadmap items.
- Maker.js can be added behind an interface later. Its licence (Apache-2.0) is compatible.

## Alternatives considered

- Maker.js now: rejected for the MVP because tolerance semantics would be inherited rather than specified.
- A WASM geometry kernel: deferred to the 3D investigation.
