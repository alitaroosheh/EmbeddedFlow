# EmbeddedFlow — Product Requirements Wiki

EmbeddedFlow is a VSCode extension that provides a full LVGL UI design and simulation environment.
It is inspired by EEZ Studio but lives natively inside VSCode, uses `.embf` as its project format,
and targets all LVGL versions from 8.4 through 9.x.

---

## Sections

| # | Topic | File |
|---|-------|------|
| 01 | [Project Management](./01-project-management.md) | Core project lifecycle |
| 02 | [Display Configuration](./02-display-configuration.md) | Screen, orientation, color format |
| 03 | [Widget Library](./03-widget-library.md) | All LVGL widgets |
| 04 | [Visual Editor](./04-visual-editor.md) | Drag-and-drop UI canvas |
| 05 | [Styles & Themes](./05-styles-themes.md) | Style system, state/part selectors |
| 06 | [Animations](./06-animations.md) | Timeline, property animations |
| 07 | [Fonts](./07-fonts.md) | Built-in + custom font pipeline |
| 08 | [Images & Bitmaps](./08-images.md) | Import, convert, compress |
| 09 | [Events & Actions](./09-events-actions.md) | Event model, built-in actions |
| 10 | [Layouts](./10-layouts.md) | Flex and Grid layout editors |
| 11 | [Groups & Focus](./11-groups-focus.md) | Encoder/keyboard navigation |
| 12 | [Screens & Navigation](./12-screens-navigation.md) | Multi-screen, transitions |
| 13 | [Preview & Simulation](./13-preview-simulation.md) | WASM renderer, interactive preview |
| 14 | [WASM Runtime](./14-wasm-runtime.md) | Custom Emscripten WASM build |
| 15 | [Code Generation](./15-code-generation.md) | C output for embedded targets |
| 16 | [Build & Export](./16-build-export.md) | Export formats, platform presets |
| 17 | [VSCode Integration](./17-vscode-integration.md) | Extension UX, panels, commands |
| 18 | [.embf File Format](./18-embf-format.md) | Schema versioning, full spec |

---

## Progress Legend

- `[x]` — Implemented
- `[ ]` — Not yet implemented
- `[~]` — Partially implemented / scaffolded
