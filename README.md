# EmbeddedFlow

**EmbeddedFlow** is a [Visual Studio Code](https://code.visualstudio.com/) extension for describing embedded UIs in a JSON project format (`.embf`), previewing them with **LVGL** in a live canvas inside the editor, and generating **C** source you can drop into a firmware project.

## What it does

- **`.embf` projects** — One file holds display settings, theme, pages, and a tree of widgets (labels, buttons, bars, sliders, switches, arcs, containers, and more) with positions, sizes, and inline styles.
- **Live preview** — Open a side panel that runs LVGL compiled to **WebAssembly** (Emscripten), reads the framebuffer, and draws it on an HTML canvas. Edits to the JSON refresh the preview when the file is saved.
- **JSON Schema** — Editors get validation and completions for `.embf` files via the bundled schema.
- **C code generation** — Command **EmbeddedFlow: Generate C Code** writes `ui_output/` next to your project: per-page sources, a root `ui.c` / `ui.h`, and a starter `lv_conf.h` aligned with your display settings.
- **Simple interaction model** — Pointer input is forwarded into LVGL; you can attach declarative **events** (e.g. click → navigate to another page, toggle theme, update another widget) in the JSON for the preview and for emitted C stubs.

## Requirements

- **VS Code** (or a compatible editor) matching the `engines.vscode` range in `package.json`.
- **Node.js** — to compile the extension TypeScript (`npm install`, `npm run compile`).
- **Emscripten (emsdk)** — only if you rebuild the LVGL WASM runtime yourself (`wasm-src/build.ps1` on Windows, or your own `emcc` flow). Prebuilt `media/wasm/embf_runtime.js` and `.wasm` can be shipped with the extension so end users do not need a C toolchain.

## Quick start

1. Clone or copy this repository and run `npm install` in the extension root.
2. Run `npm run compile`.
3. Open the folder in VS Code and start **Run and Debug** → “Launch Extension” (or package with `vsce` for distribution).
4. Open `sample/demo.embf` (or create a project with **EmbeddedFlow: New Project**) and use **EmbeddedFlow: Open UI Preview** from the title bar or context menu.

## Repository layout (high level)

| Path | Role |
|------|------|
| `src/` | Extension host: parser, preview panel, code generation, types, JSON schema |
| `media/` | Webview script and packaged WASM glue |
| `wasm-src/` | LVGL + `embf_runtime.c` Emscripten build |
| `sample/` | Example `.embf` project |

## License

MIT — see [LICENSE](./LICENSE).

LVGL and other third-party code under `wasm-src/lvgl/` remain under their respective licenses.
