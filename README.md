# embeddedflow — LVGL UI design in VS Code

Design touch UIs for embedded devices without leaving your editor. **embeddedflow** lets you lay out screens in a visual preview, wire up navigation and interactions, and export ready-to-build **C** code for **LVGL** — the graphics library used on ESP32, STM32, NXP, and many other MCUs.

---

## Why embeddedflow?

Building LVGL interfaces by hand means juggling object trees, styles, screen loads, and event callbacks in C. embeddedflow keeps your UI in a single **`.embf` project file**: edit visually or in JSON, see the result on a **live preview**, then generate firmware sources that match your display and LVGL version.

**You get:**

- Faster iteration — change layout, save, preview updates
- Fewer wiring mistakes — navigation and flows are defined declaratively
- One source of truth — the same project drives preview and generated C

No separate designer app. No cloud account. Everything runs inside VS Code or Cursor.

---

## Features

### Visual design & live preview

Open **embeddedflow: Open UI Preview** on any `.embf` file. The preview runs real LVGL logic in the panel so widgets, styles, and page switches behave like on device.

- **Design mode** — add widgets from a palette, drag to position, resize, multi-select, and edit properties in the sidebar
- **Run mode** — tap buttons, move sliders, and test navigation as an end user would
- **Multiple pages** — build multi-screen apps; switch pages from the toolbar or from your flows
- **Accurate display** — set resolution, color depth, orientation, and theme colors to match your hardware

### Widget library

Labels, buttons, sliders, switches, bars, arcs, checkboxes, dropdowns, rollers, text areas, lines, images, containers, panels, spinners, and more — with common style properties (colors, fonts, borders, etc.).

### Flows & navigation

Connect UI behavior without writing C first:

- **Button / widget events** — e.g. click → go to another page, toggle dark theme, update another widget
- **Page transitions** — slide and fade animations when changing screens (preview + generated firmware)
- **Swipe gestures** — swipe left/right/top/bottom to open another page, with the same transition options

### C code generation

**embeddedflow: Generate C Code** writes an `ui_output` folder (or your configured path) next to the project:

- `ui.c` / `ui.h` — application entry points
- Per-page sources — one screen per page
- Event handlers and navigation — stubs aligned with your flows
- **LVGL 8 and 9** — set `project.lvglVersion` and include path to match ESP-IDF or your SDK

Optional **generate on save** keeps firmware in sync while you design.

### Editor integration

- **JSON Schema** — autocomplete and validation while editing `.embf` as text
- **Commands in the editor title bar** when a `.embf` file is active
- **Sample project** — open `sample/demo.embf` to explore

---

## Getting started

1. **Install** the extension from the Marketplace (or install a `.vsix` locally).
2. Run **embeddedflow: New Project** or open the included **sample/demo.embf**.
3. Click **Open UI Preview** in the editor toolbar (or run the command from the Command Palette).
4. Turn on **Design** to place and arrange widgets; turn it off to interact with the UI.
5. When you are ready for firmware, run **embeddedflow: Generate C Code** and copy the output into your embedded project.

### Useful commands

| Command | What it does |
|--------|----------------|
| **embeddedflow: Open UI Preview** | Live LVGL canvas for the current `.embf` file |
| **embeddedflow: New Project** | Create a starter `.embf` in your workspace |
| **embeddedflow: Generate C Code** | Export C sources for your LVGL version |
| **embeddedflow: Show Output Log** | Extension log for codegen and diagnostics |

### Settings (optional)

- **embeddedflow.defaultLvglVersion** — LVGL version for new projects (8.4.0 or 9.x)
- **embeddedflow.autoOpenPreview** — open preview when you open a `.embf` file
- **embeddedflow.outputDirectory** — default folder for generated C
- **embeddedflow.liveGenerateOnSave** — regenerate C when you save the project

In your `.embf` file, set `project.lvglVersion` and `project.lvglInclude` (e.g. `lvgl.h` vs `lvgl/lvgl.h`) to match your board’s LVGL port before generating code.

---

## Who is this for?

- Firmware developers using **LVGL** on microcontrollers
- Teams who want a **repeatable UI workflow** in the same repo as application code
- Anyone prototyping **embedded touch UIs** before committing to full C layout code

---

## Requirements

- **VS Code 1.85+** or a compatible editor (including Cursor)
- For **using** the extension: nothing else — preview and codegen work out of the box
- For **firmware**: your existing LVGL / ESP-IDF / SDK project to compile the generated C

---

## Feedback & source

- **Issues & feature requests:** [GitHub Issues](https://github.com/alitaroosheh/EmbeddedFlow/issues)
- **Repository:** [github.com/alitaroosheh/EmbeddedFlow](https://github.com/alitaroosheh/EmbeddedFlow)

## License

MIT — see [LICENSE](./LICENSE). LVGL remains under its own license where bundled for the preview runtime.
