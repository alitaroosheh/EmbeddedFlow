# 03 — Widget Library

Every LVGL widget must be supported in the `.embf` schema, in the visual editor, in the WASM runtime,
and in C code generation. The table below tracks all three layers.

Legend: **Schema** = `.embf` type defined | **Preview** = rendered in WASM | **Codegen** = C output

## 3.1 Base Object

- [~] `panel` / raw `lv_obj_t` container — Schema ✓ | Preview partial | Codegen ✗

## 3.2 Basic Widgets

| Widget | LVGL Name | Schema | Preview | Codegen |
|--------|-----------|--------|---------|---------|
| Label | `lv_label` | [x] | [~] | [ ] |
| Button | `lv_button` | [x] | [~] | [ ] |
| Image | `lv_image` | [x] | [ ] | [ ] |
| Line | `lv_line` | [x] | [ ] | [ ] |
| Arc | `lv_arc` | [x] | [~] | [ ] |
| Checkbox | `lv_checkbox` | [x] | [~] | [ ] |
| Slider | `lv_slider` | [x] | [~] | [ ] |
| Switch | `lv_switch` | [x] | [~] | [ ] |
| Bar | `lv_bar` | [x] | [~] | [ ] |
| Spinner | `lv_spinner` | [x] | [~] | [ ] |

## 3.3 Input Widgets

| Widget | LVGL Name | Schema | Preview | Codegen |
|--------|-----------|--------|---------|---------|
| Textarea | `lv_textarea` | [x] | [ ] | [ ] |
| Dropdown | `lv_dropdown` | [x] | [ ] | [ ] |
| Roller | `lv_roller` | [x] | [ ] | [ ] |
| Spinbox | `lv_spinbox` | [ ] | [ ] | [ ] |
| Keyboard | `lv_keyboard` | [ ] | [ ] | [ ] |
| Button Matrix | `lv_buttonmatrix` | [ ] | [ ] | [ ] |

## 3.4 Container / Layout Widgets

| Widget | LVGL Name | Schema | Preview | Codegen |
|--------|-----------|--------|---------|---------|
| Container | `lv_obj` with layout | [x] | [~] | [ ] |
| Tabview | `lv_tabview` | [ ] | [ ] | [ ] |
| Tab | `lv_tab` | [ ] | [ ] | [ ] |
| Tileview | `lv_tileview` | [ ] | [ ] | [ ] |
| Window | `lv_win` | [ ] | [ ] | [ ] |
| Menu | `lv_menu` | [ ] | [ ] | [ ] |
| Message Box | `lv_msgbox` | [ ] | [ ] | [ ] |

## 3.5 Data Visualization Widgets

| Widget | LVGL Name | Schema | Preview | Codegen |
|--------|-----------|--------|---------|---------|
| Chart | `lv_chart` | [ ] | [ ] | [ ] |
| Meter | `lv_meter` | [ ] | [ ] | [ ] |
| Scale | `lv_scale` | [ ] | [ ] | [ ] |
| LED | `lv_led` | [ ] | [ ] | [ ] |
| Table | `lv_table` | [ ] | [ ] | [ ] |

## 3.6 Media / Special Widgets

| Widget | LVGL Name | Schema | Preview | Codegen |
|--------|-----------|--------|---------|---------|
| Image Button | `lv_imagebutton` | [ ] | [ ] | [ ] |
| Animation Image | `lv_animimage` | [ ] | [ ] | [ ] |
| Canvas | `lv_canvas` | [ ] | [ ] | [ ] |
| QR Code | `lv_qrcode` | [ ] | [ ] | [ ] |
| Color Wheel | `lv_colorwheel` | [ ] | [ ] | [ ] |
| Calendar | `lv_calendar` | [ ] | [ ] | [ ] |
| List | `lv_list` | [ ] | [ ] | [ ] |
| Span / Spangroup | `lv_span` / `lv_spangroup` | [ ] | [ ] | [ ] |
| Lottie (LVGL 9.2+) | `lv_lottie` | [ ] | [ ] | [ ] |

## 3.7 Widget Properties (all widgets must support)

- [x] `id` — unique string identifier within the page
- [x] `x`, `y` — position (pixels, relative to parent)
- [x] `width`, `height` — size in pixels (or `LV_SIZE_CONTENT`, `LV_PCT(n)`)
- [x] `hidden` — boolean visibility flag
- [x] `styles` — inline style overrides (see Section 05)
- [ ] `align` — LVGL alignment constant (`LV_ALIGN_CENTER`, `LV_ALIGN_TOP_LEFT`, etc.)
- [ ] `scrollable` — enable/disable scrolling on container objects
- [ ] `scrollbar_mode` — `off`, `on`, `auto`, `active`
- [ ] `click_focus` — whether clicking this object takes focus
- [ ] `user_data` — arbitrary string passed through to generated code
- [ ] `comment` — designer note, stripped from generated code

## 3.8 Label-specific

- [x] `text` — display string (supports newlines)
- [x] `longMode` — `wrap`, `dot`, `scroll`, `clip`
- [ ] `recolor` — enable `#RRGGBB text#` inline coloring (LVGL 8, removed in 9.3+)
- [ ] `textAlign` — `left`, `center`, `right`, `auto`
- [ ] `binding` — bind text to a variable/expression (for flow/logic)

## 3.9 Image-specific

- [x] `src` — image asset ID (references `images[]` array in project)
- [ ] `rotation` — 0–3600 (tenths of degrees)
- [ ] `scale` — 256 = 100%, integer
- [ ] `pivotX`, `pivotY` — rotation/scale pivot point
- [ ] `antialias` — enable antialiasing for transform
- [ ] `tintColor` — recolor the image with a tint
- [ ] `blendMode` — `normal`, `additive`, `subtractive`

## 3.10 Arc-specific

- [x] `min`, `max`, `value`
- [x] `startAngle`, `endAngle`
- [x] `mode` — `normal`, `reverse`, `symmetrical`
- [ ] `bgStartAngle`, `bgEndAngle` — background arc angles
- [ ] `rotation` — rotate the entire arc
- [ ] `changeOnClick` — allow user interaction
- [ ] `indicatorColor`, `backgroundColor`, `knobColor`

## 3.11 Chart-specific

- [ ] `chartType` — `line`, `bar`, `scatter`, `step`
- [ ] `series[]` — data series with color and data points
- [ ] `xAxis`, `yAxis` — axis configuration (range, tick count, labels)
- [ ] `cursor` — cursor/crosshair support
- [ ] `zoomX`, `zoomY`

## 3.12 Meter-specific

- [ ] `scale[]` — multiple scales on the same meter
- [ ] `indicators[]` — needles, arcs, line indicators
- [ ] `startAngle`, `endAngle`

## 3.13 Tabview-specific

- [ ] `tabPosition` — `top`, `bottom`, `left`, `right`
- [ ] `tabs[]` — list of Tab children
- [ ] `tabBarSize`

## 3.14 Tileview-specific

- [ ] `tiles[]` — grid of Tile children
- [ ] `scrollDirection` — `horizontal`, `vertical`, `both`
