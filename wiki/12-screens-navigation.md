# 12 — Screens & Navigation

## 12.1 Multi-Screen Project

- [x] `pages[]` array in `.embf` (schema exists)
- [x] Page selector toolbar in preview panel
- [ ] Each page corresponds to one LVGL screen (`lv_screen_t`)
- [ ] Pages panel in visual editor listing all screens with thumbnails
- [ ] Add / rename / delete / reorder pages from the UI

## 12.2 Page Properties

Per-page settings:

- [x] `id` — unique string identifier (used in navigation actions and codegen symbols)
- [x] `name` — human-readable label
- [x] `backgroundColor`
- [ ] `createAtStart` — boolean: create the screen object during `lv_init` (vs lazy creation)
- [ ] `deleteOnUnload` — boolean: `lv_obj_delete` the screen when navigating away
- [ ] `onLoad` — action(s) triggered by `LV_EVENT_SCREEN_LOADED`
- [ ] `onUnload` — action(s) triggered by `LV_EVENT_SCREEN_UNLOADED`
- [ ] `onLoadStart` — action(s) triggered by `LV_EVENT_SCREEN_LOAD_START`
- [ ] `onUnloadStart` — action(s) triggered by `LV_EVENT_SCREEN_UNLOAD_START`

## 12.3 Screen Transitions

Built-in LVGL transition effects for `lv_screen_load_anim()`:

- [ ] `none` — `LV_SCR_LOAD_ANIM_NONE`
- [ ] `over_left` — `LV_SCR_LOAD_ANIM_OVER_LEFT`
- [ ] `over_right` — `LV_SCR_LOAD_ANIM_OVER_RIGHT`
- [ ] `over_top` — `LV_SCR_LOAD_ANIM_OVER_TOP`
- [ ] `over_bottom` — `LV_SCR_LOAD_ANIM_OVER_BOTTOM`
- [ ] `move_left` — `LV_SCR_LOAD_ANIM_MOVE_LEFT`
- [ ] `move_right` — `LV_SCR_LOAD_ANIM_MOVE_RIGHT`
- [ ] `move_top` — `LV_SCR_LOAD_ANIM_MOVE_TOP`
- [ ] `move_bottom` — `LV_SCR_LOAD_ANIM_MOVE_BOTTOM`
- [ ] `fade_in` — `LV_SCR_LOAD_ANIM_FADE_IN`
- [ ] `fade_out` — `LV_SCR_LOAD_ANIM_FADE_OUT`
- [ ] `out_left` / `out_right` / `out_top` / `out_bottom`

Per `navigate` action:
- [ ] `transition` — transition type
- [ ] `duration` — transition duration in ms
- [ ] `delay` — ms before starting the transition
- [ ] `autoReverse` — reverse animation for back navigation

## 12.4 Navigation History

- [ ] Back navigation (`navigate_back` action) pops from an internal history stack
- [ ] Maximum history depth configurable
- [ ] Preview panel shows a "Back" button when history is non-empty

## 12.5 Screen Management in Preview

- [x] Page selector dropdown in preview toolbar
- [ ] Transition animation plays in preview when navigating
- [ ] Breadcrumb in preview toolbar shows current screen
- [ ] Preview remembers the active screen across file reloads

## 12.6 Code Generation for Screens

- [ ] Each page generates a C function: `void ui_page_name_create(void)`
- [ ] Screen object is a `lv_obj_t *` stored in a generated global variable
- [ ] Navigation calls use `lv_screen_load_anim(screen, transition, duration, delay, auto_del)`
- [ ] Lifecycle event handlers registered via `lv_obj_add_event_cb`
- [ ] Main `ui_init()` function calls `createAtStart` screens and loads the first one
