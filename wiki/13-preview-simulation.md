# 13 — Preview & Simulation

## 13.1 Core WASM Rendering Pipeline

- [x] WebviewPanel side-panel opens next to the editor
- [x] Emscripten WASM module loaded inside the webview
- [x] `requestAnimationFrame` loop ticks LVGL and reads RGBA buffer
- [x] `putImageData` blits RGBA pixels to HTML `<canvas>`
- [x] Display width and height read from `.embf` `display` section
- [x] Loading overlay shown while WASM initialises
- [x] Error overlay shown on parse/runtime errors
- [x] Preview updates live on every `.embf` file save

## 13.2 Input Forwarding

- [x] Pointer down/move/up forwarded to `_embf_on_pointer` (or EEZ `_onPointerEvent`)
- [x] Mouse wheel forwarded to `_embf_on_wheel`
- [x] Keyboard key forwarded to `_embf_on_key`
- [ ] Multi-touch simulation (two-finger pinch/zoom for scrollable containers)
- [ ] Long-press simulation (hold pointer for configurable ms)

## 13.3 Page Selection

- [x] Page selector dropdown in preview toolbar
- [x] Switching pages rebuilds the UI in WASM from the new page's component list
- [ ] Transition animation plays when switching pages via navigation events (not toolbar)

## 13.4 Zoom & Scaling

- [ ] Zoom slider or +/- buttons in preview toolbar (50%, 75%, 100%, 150%, 200%)
- [ ] Canvas CSS-scaled to fit the panel when zoom = "Fit"
- [ ] Pixel-accurate at 100% zoom (1 LVGL pixel = 1 screen pixel)
- [ ] Image rendering set to `pixelated` (no blurring on zoom in)

## 13.5 Theme Toggle

- [ ] Dark / Light theme toggle button in preview toolbar
- [ ] Triggers `lv_theme_default_init()` call with opposite dark parameter
- [ ] State persisted per preview panel across reloads

## 13.6 FPS & Performance Monitor

- [ ] FPS counter displayed in preview toolbar (computed from rAF deltas)
- [ ] LVGL perf monitor overlay toggle (calls `lv_obj_invalidate` to show built-in perf widget)

## 13.7 Device Frame (Bezel)

- [ ] Optional device bezel rendered around the canvas
- [ ] Presets: naked display, phone, tablet, embedded device
- [ ] Bezel colour/radius configurable
- [ ] Toggle on/off from toolbar

## 13.8 WASM Version Selection

- [x] Preview loads `lvgl_runtime_v{version}.js` matching `project.lvglVersion`
- [ ] Preview toolbar shows the active LVGL version
- [ ] "Reload with version X" command for testing across versions without editing the file

## 13.9 Debugger / Inspect Mode

- [ ] Toggle "Debug mode" in preview toolbar
- [ ] Debug mode draws bounding boxes for all widgets (like LVGL `LV_USE_OBJ_ID`)
- [ ] Clicking a widget in debug mode highlights it in the widget tree / property inspector
- [ ] Console log panel below the canvas showing LVGL log output (`LV_LOG_*`)
- [ ] Event log: list of fired events with timestamp, widget ID, event type

## 13.10 State Simulation

- [ ] Force a widget into a specific state (pressed, focused, disabled, checked) from the inspector
- [ ] State is applied in WASM and reflected visually so styles can be verified

## 13.11 Snapshot & Export

- [ ] "Take screenshot" button — saves the current canvas as PNG
- [ ] "Copy screenshot to clipboard" button
- [ ] Snapshot saved alongside the `.embf` file or in a configurable output folder
