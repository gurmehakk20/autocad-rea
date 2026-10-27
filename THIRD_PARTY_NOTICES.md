# Third-party notices

OpenDraft is distributed under the MIT licence. It depends on the packages below. Each is used unmodified from npm. Licence text for each package ships in its npm tarball under `node_modules/<name>/`.

## Runtime dependencies

| Package | Version checked | Licence | Use |
|---|---|---|---|
| react | 19.3.1 | MIT | UI components |
| react-dom | 19.3.1 | MIT | UI rendering |
| @tarikjabiri/dxf | 2.9.0 | MIT | DXF writer (export) |

## Build and development dependencies

| Package | Version checked | Licence | Use |
|---|---|---|---|
| vite | 8.3.5 | MIT | Dev server and bundler |
| @vitejs/plugin-react | 6.1.2 | MIT | React fast refresh and JSX |
| typescript | 7.0.2 | Apache-2.0 | Type checking |
| vitest | 5.0.5 | MIT | Unit and integration tests |
| @playwright/test | 1.64.1 | Apache-2.0 | End-to-end tests |
| oxlint | 1.90.0 | MIT | Linting |
| @types/react | 19.3.0 | MIT | Type definitions |
| @types/react-dom | 19.3.0 | MIT | Type definitions |
| @types/node | 26.6.5 | MIT | Type definitions |

## Projects studied but not used as code

These were reviewed for design and licensing only. No code, data tables or structure was copied.

- LibreCAD (GPL-2.0), see [docs/RESEARCH.md](docs/RESEARCH.md)
- FreeCAD (LGPL-2.1)
- Open CASCADE Technology (LGPL-2.1 with exception)
- Maker.js (Apache-2.0)
- Tauri (Apache-2.0 / MIT), under evaluation for desktop packaging

If you add a dependency, add it to this file in the same change. Check that its licence is compatible with MIT.
