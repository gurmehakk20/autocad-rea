# ADR 0006: Document model choices (rectangles, rigid transforms, layers)

- Status: Accepted
- Date: 2026-10-27

## Context

The brief lists rectangles as an entity. DXF represents rectangles as closed LWPOLYLINE entities. Transforms that include scale or mirror change how arcs and circles must be stored.

## Decision

- Rectangles are **closed polylines with four vertices**. The rectangle tool produces them, and DXF export writes them as LWPOLYLINE with the closed flag.
- Entity-level transforms are **rigid only** (translation and rotation). `transformEntity` rejects anything else with an error. Scale and mirror are deferred.
- Layer 0 always exists and cannot be deleted or renamed. Deleting another layer moves its entities to layer 0 in the same undo step.
- Entity colour is `#rrggbb` or `null` (ByLayer). DXF export writes true colour so explicit colours survive a round trip.

## Consequences

- Import and export are simpler, because the model matches DXF.
- Scale and mirror need a separate design: arcs under mirror need an orientation flag, and under non-uniform scale they become ellipses.
- Rectangles are not individually editable as rectangles. Users edit their vertices as a polyline.
