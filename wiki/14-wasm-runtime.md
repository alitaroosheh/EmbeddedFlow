# 14 — WASM Runtime

Two WASM paths exist. Path A (EEZ WASM fallback) is already bundled.
Path B (custom `embf_runtime`) is the target — a clean WASM built with our own C source.

## 14.1 EEZ LVGL WASM (Fallback / Interim)

- [x] `lvgl_runtime_v8.4.0.js` + `.wasm` bundled in `media/wasm/`
- [x] `lvgl_runtime_v9.2.2.js` + `.wasm` bundled
- [x] `lvgl_runtime_v9.3.0.js` + `.wasm` bundled
- [x] `lvgl_runtime_v9.4.0.js` + `.wasm` bundled
- [x] `lvgl_runtime_v9.5.0.js` + `.wasm` bundled
- [ ] Minimal assets blob correctly initialises LVGL without the EEZ flow runtime
- [ ] Raw `_lv_*` API calls work after init (build direct LVGL objects from `.embf`)

## 14.2 Custom EmbeddedFlow WASM (`embf_runtime`)

### Build Infrastructure

- [x] `wasm-src/embf_runtime.c` — C source
- [x] `wasm-src/lv_conf.h` — LVGL configuration
- [x] `wasm-src/Makefile` — builds with emsdk at `D:\Works\emsdk`
- [x] LVGL v9.5.0 source cloned into `wasm-src/lvgl/`
- [x] `build.ps1` produces `media/wasm/embf_runtime.js` (11 KB) + `embf_runtime.wasm` (370 KB)
- [x] `lv_conf.h` tuned for Emscripten (ARGB8888, clib malloc, all widgets enabled)
- [ ] `build.ps1` supports `LVGL_VERSION` parameter for multiple version builds
- [ ] CI / GitHub Actions workflow for automated WASM builds
- [ ] Pre-built WASM committed to repo so users don't need emsdk locally

### C API — Lifecycle

- [x] `embf_init(width, height, dark_theme)` — `lv_init` + display driver + theme
- [x] `embf_main_loop()` — `lv_timer_handler()`
- [x] `embf_get_buffer()` — returns pointer to RGBA8888 framebuffer
- [x] `embf_clear_screen()` — `lv_obj_clean(lv_screen_active())`

### C API — Screen Management

- [x] `embf_create_screen()` → `lv_obj_t *`
- [x] `embf_load_screen(screen)`

### C API — Widget Constructors

- [x] `embf_create_label(parent, x, y, w, h)` → `lv_obj_t *`
- [x] `embf_label_set_text(obj, text)`
- [x] `embf_create_button(parent, x, y, w, h)` → `lv_obj_t *`
- [x] `embf_button_set_label(btn, text)`
- [x] `embf_create_slider(parent, x, y, w, h)` + `_set_range` + `_set_value`
- [x] `embf_create_switch(parent, x, y, w, h)` + `_set_state`
- [x] `embf_create_bar(parent, x, y, w, h)` + `_set_range` + `_set_value`
- [x] `embf_create_spinner(parent, x, y, w, h, speed, arc_length)`
- [x] `embf_create_arc(parent, x, y, w, h)` + `_set_range` + `_set_value`
- [x] `embf_create_checkbox(parent, x, y, w, h)` + `_set_text` + `_set_state`
- [x] `embf_create_container(parent, x, y, w, h)`
- [ ] `embf_create_image(parent, x, y, w, h, src_ptr)` — inline image data from JS
- [ ] `embf_create_dropdown(parent, x, y, w, h)` + `_set_options` + `_set_selected`
- [ ] `embf_create_roller(parent, x, y, w, h)` + `_set_options` + `_set_selected`
- [ ] `embf_create_textarea(parent, x, y, w, h)` + `_set_text` + `_set_placeholder`
- [ ] `embf_create_line(parent, x, y, w, h)` + `_set_points`
- [ ] `embf_create_spinbox(parent, x, y, w, h)` + `_set_range` + `_set_value`
- [ ] `embf_create_keyboard(parent, x, y, w, h)`
- [ ] `embf_create_buttonmatrix(parent, x, y, w, h)` + `_set_map`
- [ ] `embf_create_chart(parent, x, y, w, h)` + series API
- [ ] `embf_create_meter(parent, x, y, w, h)` + scale/indicator API
- [ ] `embf_create_scale(parent, x, y, w, h)`
- [ ] `embf_create_led(parent, x, y, w, h)` + `_set_color` + `_set_brightness`
- [ ] `embf_create_table(parent, x, y, w, h)` + cell API
- [ ] `embf_create_tabview(parent, x, y, w, h)` + tab add API
- [ ] `embf_create_tileview(parent, x, y, w, h)` + tile add API
- [ ] `embf_create_qrcode(parent, x, y, size)` + `_update`
- [ ] `embf_create_colorwheel(parent, x, y, w, h)`
- [ ] `embf_create_calendar(parent, x, y, w, h)`
- [ ] `embf_create_list(parent, x, y, w, h)` + item add API

### C API — Style Setters

- [x] `embf_obj_set_style_bg_color(obj, argb)`
- [x] `embf_obj_set_style_text_color(obj, argb)`
- [x] `embf_obj_set_style_border_width(obj, width)`
- [x] `embf_obj_set_style_radius(obj, radius)`
- [x] `embf_obj_set_style_pad_all(obj, pad)`
- [ ] Full style API: one `embf_obj_set_style_*` function per style property (Section 05)
- [ ] State selector parameter: `embf_obj_set_style_*(obj, value, state | part)`

### C API — Input Devices

- [x] `embf_on_pointer(x, y, pressed)` — touch/mouse
- [x] `embf_on_wheel(delta, pressed)` — encoder
- [x] `embf_on_key(keycode)` — keyboard

### C API — Font Loading

- [ ] `embf_load_font_from_array(data_ptr, data_len)` → `lv_font_t *`
- [ ] `embf_get_builtin_font(name_ptr)` → `lv_font_t *`
- [ ] `embf_obj_set_style_text_font(obj, font_ptr)`

### C API — Layout

- [ ] `embf_obj_set_layout_flex(obj, flow, main_align, cross_align, track_align)`
- [ ] `embf_obj_set_layout_grid(obj, col_dsc_ptr, row_dsc_ptr, col_gap, row_gap)`
- [ ] `embf_obj_set_grid_cell(obj, col, row, col_span, row_span, x_align, y_align)`
- [ ] `embf_obj_set_flex_grow(obj, grow)`

### C API — Animations

- [ ] `embf_anim_create(target, exec_cb_name, from, to, duration, delay)` → `uint32_t` handle
- [ ] `embf_anim_set_repeat(handle, count, delay)`
- [ ] `embf_anim_set_path(handle, path_type)`
- [ ] `embf_anim_start(handle)`
- [ ] `embf_anim_delete(handle)`
