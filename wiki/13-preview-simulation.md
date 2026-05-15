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

- [~] Zoom selector in toolbar (fit + fixed integer scale 1×–4×); panel fits container when zoom = Fit
- [ ] Zoom slider or +/- arbitrary percentages (50%, 75%, …)
- [ ] Pixel-accurate at 100% zoom in all layouts (CSS vs backing buffer parity)
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

## 13.12 Design mode overlay — multi-select & layout tooling

Requirements for the WASM preview’s **interactive design overlay** (toggle in toolbar). Behaviour is mirrored in [`media/webview.js`](../media/webview.js) and the host preview panel [`src/previewPanel.ts`](../src/previewPanel.ts).

### 13.12.1 Selection model

- [x] Maintain an ordered list `selectedComponentIds` (persisted ordering for stable UI); host `load` payload restores `selectedComponentIds` or legacy `selectedComponentId`.
- [x] Plain click on unselected widget: selection becomes exactly that widget.
- [x] Plain click on an already-selected widget (with others selected): keeps the multi-selection (start drag).
- [x] Ctrl/Cmd+click: toggle widget in/out of selection.
- [x] Shift+click: add widget to selection (union).
- [x] Click or short drag on empty canvas (no modifiers, below marquee-move threshold): clear widget selection; show **page** inspector.
- [x] Overlay draws rectangles for **all** selected widgets.
- [x] Escape clears widget selection (shows page inspector when design mode stays on).
- [x] **Drag marquee** — drag on empty canvas (no widget hit) with pointer captured: **replace** selection with every widget whose bounds intersect the axis-aligned marquee; **Shift+drag** unions with current selection; **Ctrl/Cmd+drag** toggles each intersected widget in/out.
- Small movement below threshold falls back to: plain → page inspector focused; modifiers → no-op (selection unchanged).

### 13.12.2 Move & delete

- [x] Dragging any selected widget moves **all** selected siblings **by the same delta** in absolute page coordinates (nested parents handled via bounding-box math).
- [x] Webview emits `bulkMoveWidgets` with `{ componentId, absX, absY }` per item; host converts to parent-relative `.embf` `x`/`y` and writes once per operation.
- [x] Delete key or inspector **Delete**: `bulkDeleteWidgets` when `|selection| ≥ 2`, otherwise `deleteWidget`.
- [x] Undo/redo (`undo` / `redo`) may include `selectedComponentIds` so history restores sensible selection focus.

### 13.12.3 Multi-inspector & alignment

- With `|selection| ≥ 2` and **design mode** on:
  - If widgets are **different types**, the inspector shows only the layout toolbar (**Align**, **Match size**, **Move group**) and hints (no typed property fields yet).
  - If all selected widgets share the **same `type`**, the inspector additionally shows **shared fields**: Layout (x/y/width/height/hidden), type-specific controls, **Appearance**, and **Events**. Values that disagree show **(mixed)**; leaving a mixed field unchanged omits it from the patch so each widget keeps its own value on disk. Applies via **`bulkPatchWidgets`** using one patch broadcast to each selected component.
- [x] Section **Align** — align edges of all widgets to the axis-aligned bounding box of the selection: left, right, top, bottom; center horizontal / vertical relative to bbox.
- [x] Section **Space** — distribute centers evenly along X and along Y (`distribute-h` / `distribute-v`); require ≥2 widgets.
- [x] Section **Match** — resize all widgets to the **maximum** width and **maximum** height within the selection (`match-width`, `match-height`).
- [x] Section **Move group** — move the whole bbox so its **left/top** aligns to parent page `0`; **center bbox** horizontally on the page canvas.
- [x] All layout actions persist through `bulkPatchWidgets` with a single file read/write on the host.

### 13.12.4 Host/extension API summary

Messages from webview handled by [`previewPanel.ts`](../src/previewPanel.ts) (delegating to `.embf` helpers):

| Message | Purpose |
|---------|---------|
| `bulkMoveWidgets` | Reposition multiple components after overlay drag |
| `bulkPatchWidgets` | Batch property / style / geometry patches (layout buttons & homogeneous bulk inspector edits) |
| `bulkDeleteWidgets` | Remove many components |

Load payload extras: **`selectedComponentIds?: string[]`**, **`selectedComponentId?`** (deprecated single).
