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

## Data copied into the source

| Source | Licence | What | Where |
|---|---|---|---|
| [ezdxf](https://github.com/mozman/ezdxf), `src/ezdxf/colors.py`, `DXF_DEFAULT_COLORS` | MIT | The 256-entry AutoCAD Colour Index as RGB values (AutoCAD 2020 model-space palette, dark background) | `src/io/dxf/aci.ts`, generated from that file by script |

ezdxf licence text:

```
MIT License

Copyright (c) 2020 Manfred Moitzi

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
