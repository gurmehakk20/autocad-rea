# ADR 0003: DXF writer from a library, reader implemented in-house

- Status: Accepted
- Date: 2026-10-27

## Context

DXF import and export are required. Registry checks (see `docs/RESEARCH.md`) showed:

- `@tarikjabiri/dxf` (MIT, updated 2026-09) writes DXF but cannot read it.
- `dxf-parser` (MIT) reads DXF but was last updated in 2022.

## Decision

- Export uses `@tarikjabiri/dxf`. We verified its output for `$INSUNITS`, LAYER, LINE, CIRCLE, ARC, LWPOLYLINE and true colour.
- Import is implemented in `src/io/dxf/read.ts` for the supported subset. Everything else is counted and reported. Layer colours are approximated to the AutoCAD primary palette and reported when they are not exact.

## Consequences

- Import behaviour is tested against a hand-written DXF fixture and round trips, so the claims in the README are backed by tests.
- We own the reader's maintenance. Scope is deliberately small.
- A future switch to a fuller parser is possible if `dxf-parser` or another maintained reader becomes suitable.

## Alternatives considered

- `dxf-parser` for reading: stale, and it would have forced a second data model.
