# Changelog

## 1.0.0

First feature-complete release: visual editing for named styles, data bindings, animations, and the knob widget, with inspector UI and codegen aligned end-to-end.

### New

- **Knob widget** — first-class `type: "knob"` in palette, parser, preview, and codegen (styled `lv_arc` with 270° default sweep, optional `indicatorColor`, touch-friendly defaults).
- **Data binding (Phase 2)** — `slider`, `bar`, `arc`, and `knob` accept `bindings.value` → `project.dataModel.fields[]`. Codegen updates numeric widgets in `ui_bindings_apply()` when setters run.
- **Inspector (Properties panel)** for v1 schema:
  - **Named styles** — edit `project.styles[]` on the page inspector; assign `styleRefs` per widget.
  - **Data model** — edit `project.dataModel.fields[]`; bind label text via `{{field}}` and numeric widgets via **Value bound to**.
  - **Animations** — per-widget list editor (property, easing, from/to, duration, delay, repeat, playback).
- **`lv_font_conv`** — **Add Font to Project** can convert TTF/OTF to `.c` when `lv_font_conv` is on `PATH` (`<project>/fonts/<symbol>.c`).

### Also in 1.0 (from 0.3.7)

- Reusable **named styles** (`ui_styles.c/h`) and **widget animations** (`lv_anim_t` codegen).
- **Data binding Phase 1** — `{{field}}` in labels → `ui_bindings.c/h` with setters/getters.
- **Add Font** command, parser validation for styles, bindings, and animations.

### Fixes

- **Sidebar Tree and Settings** — rail buttons for widget hierarchy and project/display/codegen settings work again (`SIDEBAR_PANEL_LABELS` was missing `hierarchy` and `settings`).
- **Settings → Open in Properties panel** — forces Design mode and expands the Properties panel when collapsed.
- **Theme toggle** — toolbar light/dark control persists `project.theme.dark` in the `.embf` file so preview theme no longer resets to dark after every widget edit.

## 0.3.7

- Reusable named styles: declare `project.styles[]` (each with `id`, optional `name`, and a `props` style bag) and reference them from any widget via `styleRefs: ["card", "danger"]`. Codegen emits `ui_styles.h` / `ui_styles.c`, calls `ui_styles_init()` from `ui_init()`, and adds `lv_obj_add_style(...)` per ref.
- Widget animations: `animations[]` on any component emits a fully wired `lv_anim_t` per entry — supports `x`, `y`, `width`, `height`, `opacity` with `linear` / `ease_in` / `ease_out` / `ease_in_out` / `overshoot` / `bounce` / `step` paths, optional `delay`, `repeat` (finite or infinite), and `playback`. A page-local `ui_anim_opa_cb` helper is emitted only when an opacity animation is present.
- Data binding (Phase 1): declare `project.dataModel.fields[]` (`string` / `int` / `float` / `bool` with optional defaults) and reference them from `label.text` as `{{field_id}}`. Codegen emits `ui_bindings.h` / `ui_bindings.c` with backing storage, `ui_bindings_init()`, `ui_bindings_apply()`, and per-field setters/getters (`ui_set_<id>` / `ui_get_<id>`); setters automatically refresh bound labels.
- Preview: live `{{field}}` substitution using `dataModel.fields[].default`, so the canvas reflects realistic values without needing the embedded firmware.
- Parser: validates `styles[]` (unique C-identifier ids, no duplicates), `styleRefs[]` (must exist in `project.styles`), `dataModel.fields[]` (unique ids, type-checked defaults), `animations[]` (known property/easing), and `{{field}}` references in label text (must match a declared field).
- New command **embeddedflow: Add Font to Project** — adds a `FontDef` to `project.fonts[]` via a guided wizard (id, C symbol, size, optional `.c` source), validates the entry against the parser, and persists with the project's existing JSON indentation.

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
