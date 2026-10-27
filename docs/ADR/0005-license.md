# ADR 0005: MIT licence

- Status: Accepted (owner to confirm)
- Date: 2026-10-27

## Context

The licence must suit an open-source CAD project that may later bundle geometry kernels and desktop packaging.

## Options reviewed

- **GPL-2.0 / GPL-3.0** (LibreCAD): would require the whole application to be GPL. It limits reuse of the core in other projects, and it is incompatible with some planned dependencies.
- **LGPL-2.1** (FreeCAD, Open CASCADE Technology): suits libraries, but applies friction to dynamic linking and WASM packaging of the editor itself.
- **MIT**: permissive, simple, and compatible with every dependency checked (MIT, Apache-2.0). Matches the licence of the `@tarikjabiri/dxf` writer.

## Decision

Release OpenDraft under MIT. Keep `THIRD_PARTY_NOTICES.md` current. Do not copy code from GPL or LGPL projects.

## Consequences

- Users and contributors can reuse the core freely.
- Future LGPL dependencies (OCCT for 3D) would be consumed as separate components, and that needs its own review before adoption.
- Contributors must write original code. The contribution guide says so.
