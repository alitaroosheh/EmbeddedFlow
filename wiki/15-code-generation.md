# 15 — Code Generation

Code generation produces a self-contained LVGL C project that can be dropped into any embedded
firmware build (ESP-IDF, STM32 HAL, Zephyr, Arduino, bare-metal, etc.).

## 15.1 Output Structure

- [ ] Output directory configurable per project (default: `./ui_output/` next to `.embf`)
- [ ] `ui.h` — public API: `void ui_init(void);` and screen extern declarations
- [ ] `ui.c` — `ui_init()` that initialises the theme and loads the first screen
- [ ] Per-screen: `ui_<page_id>.h` + `ui_<page_id>.c`
- [ ] `ui_styles.h` + `ui_styles.c` — all named styles
- [ ] `ui_fonts.h` + `ui_fonts.c` — font declarations and includes
- [ ] `ui_images/` — converted image `.c` files (one per image asset)
- [ ] `lv_conf.h` — tailored to the project (correct color depth, enabled fonts, enabled widgets)
- [ ] `CMakeLists.txt` stub — ready to include in a CMake project
- [ ] `idf_component.yml` — ESP-IDF component manifest

## 15.2 Naming Conventions

- [ ] Widget C variables: `ui_<page_id>_<widget_id>` (e.g. `ui_main_lbl_title`)
- [ ] Screen variables: `ui_<page_id>` (e.g. `ui_main`)
- [ ] Style variables: `ui_style_<style_id>` (e.g. `ui_style_card`)
- [ ] Font variables: `ui_font_<font_id>` (e.g. `ui_font_roboto_24`)
- [ ] Image descriptors: `ui_img_<image_id>` (e.g. `ui_img_logo`)
- [ ] All names are sanitized (spaces → underscores, reserved words prefixed with `_`)

## 15.3 Per-Widget Code Output

For each widget, the generator emits:

- [ ] Object creation call: `lv_<widget>_create(parent)`
- [ ] Position and size: `lv_obj_set_pos()` + `lv_obj_set_size()`
- [ ] Widget-specific setters (text, range, value, options, etc.)
- [ ] Inline style overrides: `lv_obj_set_style_*(obj, value, LV_PART_MAIN | LV_STATE_DEFAULT)`
- [ ] Named style application: `lv_obj_add_style(obj, &ui_style_name, 0)`
- [ ] Flag changes: `lv_obj_add_flag()` / `lv_obj_remove_flag()` (hidden, click, etc.)
- [ ] Event callbacks: `lv_obj_add_event_cb(obj, cb_fn, LV_EVENT_CLICKED, NULL)`

## 15.4 Style Code Output

- [ ] Style init: `lv_style_init(&ui_style_name)`
- [ ] Per-property: `lv_style_set_*(& style, value)` with correct state+part selector
- [ ] Style applied to widget: `lv_obj_add_style(obj, &style, selector)`

## 15.5 Font Code Output

- [ ] Built-in Montserrat fonts referenced as `&lv_font_montserrat_XX`
- [ ] Custom fonts referenced as `&ui_font_<id>` — extern declared in `ui_fonts.h`
- [ ] Custom font C array file generated during export

## 15.6 Event / Action Code Output

- [ ] One `static void <page>_<widget>_cb(lv_event_t *e)` per event handler
- [ ] Built-in navigation action emits `lv_screen_load_anim(...)` in the callback
- [ ] `call_function` emits a forward declaration + a call (user provides the implementation)
- [ ] All callbacks registered with `lv_obj_add_event_cb`

## 15.7 Animation Code Output

- [ ] `lv_anim_t a; lv_anim_init(&a);` block per animation
- [ ] Correct exec_cb: references a setter function like `(lv_anim_exec_xcb_t)lv_obj_set_x`
- [ ] Path: `lv_anim_set_path_cb(&a, lv_anim_path_ease_in_out)` etc.
- [ ] `lv_anim_start(&a)` call placed in the appropriate trigger callback

## 15.8 LVGL Version Compatibility

- [ ] Generated code is valid for the LVGL version declared in the project
- [ ] v8 vs v9 API differences handled:
  - [ ] `lv_btn_create` (v8) vs `lv_button_create` (v9)
  - [ ] `lv_img_create` (v8) vs `lv_image_create` (v9)
  - [ ] `lv_scr_load_anim` (v8) vs `lv_screen_load_anim` (v9)
  - [ ] `lv_obj_set_style_img_recolor` (v8) vs `lv_obj_set_style_image_recolor` (v9)
  - [ ] Image descriptor format differences (v8 `lv_img_dsc_t` vs v9 `lv_image_dsc_t`)
  - [ ] Color format API changes (v9 adds `lv_display_set_color_format`)

## 15.9 Code Generation Trigger

- [ ] `EmbeddedFlow: Generate C Code` command in command palette
- [ ] Keyboard shortcut configurable
- [ ] Output written to disk and opened in a new editor tab (show diff if files exist)
- [ ] Validation runs before generation; errors block generation with a message

## 15.10 Code Preview

- [ ] "Preview C output" command — shows generated code in a read-only diff editor without writing to disk
