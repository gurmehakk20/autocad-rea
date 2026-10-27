# Contributing to OpenDraft

Thank you for helping. OpenDraft is a geometry-first project, so correctness matters more than speed of merge.

## Ground rules

1. **Write original code.** Do not copy from LibreCAD, FreeCAD, Open CASCADE, AutoCAD or any proprietary source, documentation or asset. Describe behaviour from public documentation or your own design.
2. **Keep the core free of UI code.** Nothing under `src/core`, `src/io` or `src/state` may import React, the DOM, or `src/viewport`.
3. **Route every document change through `Drawing.apply`.** Tools and the session create `Mutation` values. This keeps undo, validation and dirty tracking correct.
4. **Do not weaken tests to get a green result.** If a test is wrong, explain why in the pull request and fix the expectation with a reason.
5. **Document limits honestly.** If something is only partly supported, say so in the README and in the DXF report.

## Setup

```bash
npm install
npm run dev
```

Before you open a pull request:

```bash
npm run check        # typecheck, lint, unit and integration tests
npm run e2e          # browser workflows (first time: npx playwright install chromium)
```

Run `npm run bench` when you change a hot path, and include the updated `docs/BENCHMARKS.md` in the same pull request.

## Adding a feature

1. Open an issue describing the behaviour and its acceptance criteria. Name the geometry rules (tolerances, edge cases).
2. Add pure functions in `src/core` with unit tests, including zero-length, tangent, near-parallel, very large and very small cases where they apply.
3. Wire the feature into a tool or the session. Add an integration test that drives it through the session.
4. Add an end-to-end test only for workflows a user performs from the UI.
5. Update the README (shortcuts, limitations) and `docs/ROADMAP.md`.
6. Add an ADR under `docs/ADR/` for a significant architectural decision.

## Commit and pull request style

- Use Conventional Commit subjects (for example `feat(tools): add trim`). See [AGENTS.md](AGENTS.md) for the full conventions, which also apply to AI agents.
- Keep pull requests focused. One behaviour change per pull request where possible.
- Say what changed, how you tested it, and what you did not test.
- Do not commit generated folders (`dist/`, `test-results/`, `playwright-report/`).

## Reporting bugs

Use the bug report template. A small DXF or native drawing file that reproduces the problem is the most useful attachment. Do not attach drawings that contain confidential information.

## Licence

By contributing you agree that your contribution is licensed under the MIT licence in [LICENSE](LICENSE).
