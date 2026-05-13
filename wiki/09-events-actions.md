# 09 — Events & Actions

## 9.1 Event Model

Every widget can have a list of event handlers. Each handler is: **event → action**.

Schema per widget:
```json
"events": [
  { "event": "clicked", "action": "navigate", "target": "page_settings" }
]
```

- [ ] `events[]` array in widget schema
- [ ] Each entry has: `event` (string), `action` (string), `params` (object, action-specific)
- [ ] JSON Schema validation for known event/action combinations

## 9.2 Supported LVGL Events

All `lv_event_code_t` values must be supported:

### Input Events
- [ ] `pressed` — `LV_EVENT_PRESSED`
- [ ] `pressing` — `LV_EVENT_PRESSING`
- [ ] `press_lost` — `LV_EVENT_PRESS_LOST`
- [ ] `short_clicked` — `LV_EVENT_SHORT_CLICKED`
- [ ] `single_clicked` — `LV_EVENT_SINGLE_CLICKED`
- [ ] `double_clicked` — `LV_EVENT_DOUBLE_CLICKED`
- [ ] `triple_clicked` — `LV_EVENT_TRIPLE_CLICKED`
- [ ] `long_pressed` — `LV_EVENT_LONG_PRESSED`
- [ ] `long_pressed_repeat` — `LV_EVENT_LONG_PRESSED_REPEAT`
- [ ] `clicked` — `LV_EVENT_CLICKED`
- [ ] `released` — `LV_EVENT_RELEASED`
- [ ] `scroll_begin` — `LV_EVENT_SCROLL_BEGIN`
- [ ] `scroll_throw_begin` — `LV_EVENT_SCROLL_THROW_BEGIN`
- [ ] `scroll_end` — `LV_EVENT_SCROLL_END`
- [ ] `scroll` — `LV_EVENT_SCROLL`
- [ ] `gesture` — `LV_EVENT_GESTURE`
- [ ] `key` — `LV_EVENT_KEY`
- [ ] `rotary` — `LV_EVENT_ROTARY` (LVGL 9+)
- [ ] `focused` — `LV_EVENT_FOCUSED`
- [ ] `defocused` — `LV_EVENT_DEFOCUSED`
- [ ] `leave` — `LV_EVENT_LEAVE`
- [ ] `hit_test` — `LV_EVENT_HIT_TEST`
- [ ] `indev_reset` — `LV_EVENT_INDEV_RESET`
- [ ] `hover_over` — `LV_EVENT_HOVER_OVER`
- [ ] `hover_leave` — `LV_EVENT_HOVER_LEAVE`

### Value / State Events
- [ ] `value_changed` — `LV_EVENT_VALUE_CHANGED`
- [ ] `insert` — `LV_EVENT_INSERT`
- [ ] `refresh` — `LV_EVENT_REFRESH`
- [ ] `ready` — `LV_EVENT_READY`
- [ ] `cancel` — `LV_EVENT_CANCEL`
- [ ] `checked` — custom (checked state entered)
- [ ] `unchecked` — custom (checked state left)

### Lifecycle Events
- [ ] `create` — `LV_EVENT_CREATE`
- [ ] `delete` — `LV_EVENT_DELETE`
- [ ] `screen_load_start` — `LV_EVENT_SCREEN_LOAD_START`
- [ ] `screen_loaded` — `LV_EVENT_SCREEN_LOADED`
- [ ] `screen_unload_start` — `LV_EVENT_SCREEN_UNLOAD_START`
- [ ] `screen_unloaded` — `LV_EVENT_SCREEN_UNLOADED`
- [ ] `draw_main` / `draw_post` — `LV_EVENT_DRAW_MAIN`/`LV_EVENT_DRAW_POST`

## 9.3 Built-in Actions

These actions are handled by the WASM runtime and the codegen without user-written C:

### Navigation
- [ ] `navigate` — load a screen by page ID (with optional transition)
- [ ] `navigate_back` — go back to the previous screen

### Widget State
- [ ] `set_value` — set a numeric value on a target widget (slider, bar, arc, etc.)
- [ ] `set_text` — set label/textarea text
- [ ] `set_checked` — check/uncheck a checkbox or switch
- [ ] `show` — make a widget visible (`lv_obj_remove_flag(LV_OBJ_FLAG_HIDDEN)`)
- [ ] `hide` — hide a widget
- [ ] `toggle_visibility` — flip visible state
- [ ] `enable` — remove `LV_STATE_DISABLED`
- [ ] `disable` — add `LV_STATE_DISABLED`
- [ ] `add_style` — apply a named style to a widget
- [ ] `remove_style` — remove a named style from a widget

### Animation Control
- [ ] `start_animation` — start a named animation
- [ ] `stop_animation` — stop a named animation
- [ ] `pause_animation` — pause (LVGL 9+)

### Misc
- [ ] `call_function` — invoke a user-defined C function by name (emitted as a forward declaration in codegen)
- [ ] `set_variable` — set a global/local variable value (for logic flow)

## 9.4 Event Editor UI

- [ ] Events section in the Property Inspector for the selected widget
- [ ] "Add event" button → select event type from dropdown
- [ ] Action picker dropdown (all built-in actions listed)
- [ ] Target picker for actions that require a widget ID
- [ ] Multiple actions per event (ordered list)
- [ ] Delete event handler button

## 9.5 Event Simulation in Preview

- [ ] Click events simulated via pointer input (already partially working)
- [ ] `value_changed` events fire live when sliders/arcs are dragged
- [ ] Navigation actions actually switch the displayed page in the preview
- [ ] `call_function` actions log the call to the debug console in preview
