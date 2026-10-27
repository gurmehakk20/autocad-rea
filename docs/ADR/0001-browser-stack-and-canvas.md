# ADR 0001: Browser-first stack with Canvas 2D rendering

- Status: Accepted
- Date: 2026-10-27

## Context

The product must run locally without an account and later ship as a desktop app. It needs a responsive drafting viewport, keyboard-driven UI and no server.

## Decision

- React 19 with TypeScript in strict mode, built with Vite 8.
- The drawing surface is a single `<canvas>` drawn with Canvas 2D through `src/viewport/Renderer.ts`.
- React owns panels and chrome only. Drawing state lives in `EditorSession`, which has no React dependency.

## Consequences

- Canvas 2D handles the expected scale (see `docs/BENCHMARKS.md`). WebGL is deferred until profiling shows a need.
- Rendering is decoupled from React. Pointer movement never re-renders the component tree.
- The same core code runs in Node for tests and benchmarks.

## Alternatives considered

- SVG: DOM nodes grow with entity count, and hit testing is already done in geometry code.
- WebGL from the start: extra complexity before any measured need.
