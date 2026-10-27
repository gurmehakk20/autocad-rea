# Agent and contributor conventions

These rules apply to people and to AI agents working in this repository. Several are adapted from the conventions in [morluto/rea](https://github.com/morluto/rea) (MIT).

## Architecture rules

- `src/core`, `src/io` and `src/state` must not import React, the DOM or `src/viewport`.
- Every document change goes through `Drawing.apply` as a `Mutation`. Do not mutate entities or layers elsewhere.
- Normalise unknown input once, at the boundary that owns it (the DXF reader, the native-format parser, the command-line parser). Return explicit errors or reports rather than silently defaulting.
- Fix the producing representation before adding downstream repairs.
- Remove superseded code. Add an abstraction only when it removes complexity you can point to.
- Do not add speculative race-condition or security handling without explaining the failure mode and its cost.

## Scope

- Do not add features that need a new architectural decision (3D, constraints, scale and mirror, a new file format) without an ADR in `docs/ADR/` and maintainer agreement.
- Do not reverse engineer proprietary software to copy its behaviour. Interoperability work uses public specifications and files you are permitted to use.

## Testing and reporting

- Prefer tests that go through the real workflow (session or browser) over tests of internals. Add unit tests for geometry rules and edge cases.
- A passing test does not prove the problem is fixed. Say what was and was not verified.
- Report only checks that actually ran. Never claim reproduction you did not perform.
- Do not weaken a test to get a green result. If an expectation was wrong, say why in the change.

## Commands

```bash
npm ci
npm run check      # typecheck, lint, unit and integration tests
npm run e2e        # browser workflows (first time: npx playwright install chromium)
npm run bench      # only for performance-relevant changes; commit docs/BENCHMARKS.md
```

## Commits and pull requests

- Use Conventional Commit subjects and PR titles, for example `feat(tools): add trim` or `fix(selection): crossing window ignores enclosed circles`. Mark breaking changes with `!` or a `BREAKING CHANGE:` footer.
- Never commit `dist/`, `node_modules/`, `test-results/`, `playwright-report/`, credentials, or drawings that contain confidential data.
- Keep PR descriptions current and list only checks you ran. A human owner reviews the final diff. Agents must not attest to human review.
