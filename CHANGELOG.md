# Changelog

## 0.3.6

- Hierarchy sidebar: drag a widget in the tree to **reparent** it into a container/panel or back to page root; absolute position is preserved. Visual drop indicators show `before` / `into` / `after`.
- Canvas rulers: toolbar **Rulers** toggle overlays horizontal and vertical pixel rulers on the display edges; tick step adapts to zoom.
- Canvas pan: hold **Space** and drag (or use the **middle mouse button**) to pan the canvas inside the scroll area without scrolling the inspector.
- Codegen: when a project declares `fonts[]`, generates `ui_fonts.h` / `ui_fonts.c` with `LV_FONT_DECLARE` lines and `UI_FONT_<ID>` macros; `ui.h` includes them automatically.
- Codegen: widget `styles.fontFamily` referencing a project font id now emits the matching font symbol (`UI_FONT_*`) instead of falling back to the nearest built-in Montserrat by size.
- Parser: validates `fonts[]` (id uniqueness, C-identifier `name`, positive `size`, optional `source`).

## 0.3.5

- Marketplace keywords: LVGL, UI, ESP32, STM32, Embedded.
- Design editor: palette drag-drop, search, resize handles, grid snap, widget tree, z-order, copy/paste, Alt+duplicate.
- Preview: theme toggle, bezel, FPS, page fade in run mode; Settings sidebar.
- Codegen outputs only `.c` / `.h` (no CMake or platform manifests).
- New project display presets; parser accepts missing `version` as 1.0.

## 0.3.4

- Expanded README with full feature documentation and recent-release summary.
- Added CHANGELOG for Marketplace release notes.

## 0.3.3

- Grouped widgets: united selection by default; group-edit mode (double-click, **Edit contents**, Esc / Done).
- Toolbar widget picker on the preview toolbar.
- Image preview alignment fixes (overlay position and zoom).
- New Project wizard from preview toolbar, explorer, and command palette.

## 0.3.2

- Fix VSIX packaging: include `node_modules` dependencies (`pngjs`, `jpeg-js`) so the extension activates and commands register after Marketplace install.
- New Project command and activation event improvements.
- Lighter image-format imports for preview panel.

## 0.3.1 and earlier

See [GitHub releases](https://github.com/alitaroosheh/EmbeddedFlow/releases) and commit history for prior changes.
