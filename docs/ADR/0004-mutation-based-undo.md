# ADR 0004: Undo/redo from reversible mutations, not snapshots

- Status: Accepted
- Date: 2026-10-27

## Context

The brief asks for reliable undo and redo without expensive full-document snapshots for small operations.

## Decision

Every change is a `Mutation`. `Drawing.apply` returns the inverse mutation. `History` stores `(forward, backward)` pairs. Multi-step commands are wrapped in a `batch` that rolls back on failure. The save point is tracked by entry identity, so dirty state is exact after undo and redo.

## Consequences

- Memory is proportional to the size of each change.
- Adding a new operation means writing forward and inverse behaviour in one place (`Drawing.apply`).
- Batches make one user action one undo step (move, copy, rotate, layer delete).

## Alternatives considered

- Full snapshots: simpler, but too costly once drawings grow.
- Command objects with separate `undo()` methods: duplicates logic and makes validation harder to keep consistent.
