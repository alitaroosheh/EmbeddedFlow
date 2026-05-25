# Changelog

## 1.0.0

- **Data binding (Phase 2)**: numeric widgets (`slider`, `bar`, `arc`, `knob`) now accept a `bindings.value` map pointing at a `project.dataModel.fields[]` entry. Codegen emits `lv_*_set_value(…, (int32_t)ui_get_<id>(), …)` inside `ui_bindings_apply()`, so calling a setter refreshes both bound labels and numeric widgets in one pass.
- **Knob widget**: new first-class `type: "knob"` component (palette + parser + codegen). Emits a styled `lv_arc` with a 270° default sweep, thicker indicator, optional `indicatorColor`, and `LV_OBJ_FLAG_CLICKABLE` for touch interaction; the preview renders it via the existing arc primitive.
- **Inspector UI for v1 schema**:
  - **Named styles**: list/add/remove `project.styles[]` from the page inspector (id, optional name, props JSON) and pick `styleRefs` per widget with a checkbox group.
  - **Animations**: per-widget editor (property, easing, from/to, duration, delay, repeat, playback) with add/remove buttons; commits as a full `animations[]` replacement.
  - **Data model**: list/add/remove `project.dataModel.fields[]` from the page inspector with id/type/default fields; numeric-widget inspectors expose a "Value bound to" dropdown that writes `bindings.value`.
- **`lv_font_conv` integration**: the **Add Font** wizard now detects `lv_font_conv` on `PATH` and offers an in-tool TTF/OTF → `.c` conversion step (range, bpp, font size) directly into `<project>/fonts/<symbol>.c`, then registers the resulting `FontDef`.
- Component edit pipeline: `applyComponentPatch` accepts `styleRefs`, `animations`, and `bindings` patches with type-safe filtering; `applyPageInspectorPatch` accepts `projStyles` / `projDataFields` patches that replace `project.styles[]` / `project.dataModel.fields[]` in one shot.
- Parser hardening: rejects `bindings` whose key isn't a bindable property for the widget type, rejects unknown field ids in `{{template}}` text, and refuses bindings when `dataModel.fields[]` is empty.

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
