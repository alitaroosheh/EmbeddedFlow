# 11 — Groups & Focus Management

LVGL groups allow encoder/keyboard navigation. This is critical for devices without a
touchscreen (rotary encoder, D-pad, physical keyboard).

## 11.1 Group Definition

- [ ] `groups[]` section at project root
- [ ] Each group has:
  - [ ] `id` — unique string
  - [ ] `name` — human-readable label
  - [ ] `wrap` — boolean (focus wraps around at end/start)
  - [ ] `refocus_policy` — `prev`, `next` (LVGL 9+)
  - [ ] `editing` — whether the group starts in editing mode
- [ ] Default group for encoder input device
- [ ] Default group for keyboard input device

## 11.2 Widget Group Assignment

- [ ] `groupId` property on any focusable widget — assigns it to a group
- [ ] `groupOrder` — integer index within the group (focus traversal order)
- [ ] Visual indicator on canvas: badge showing group membership and order
- [ ] Property Inspector shows group assignment for selected widget

## 11.3 Input Device Types

- [ ] `inputDevices[]` section at project root defining simulated input devices:
  - [ ] Pointer (touchscreen / mouse) — always present
  - [ ] Encoder — wheel + button
  - [ ] Keypad — discrete keys
  - [ ] Button (external physical button mapped to coordinates)
- [ ] Each device is assigned to a group

## 11.4 Focus Simulation in Preview

- [ ] Tab key cycles focus through the active encoder group in the preview panel
- [ ] Enter key simulates encoder press / click
- [ ] Arrow keys simulate encoder rotation (LVGL 9+)
- [ ] Focused widget shown with LVGL focus ring
- [ ] Group focus ring style configurable (style on `LV_PART_MAIN` of focused obj)

## 11.5 Code Generation for Groups

- [ ] `lv_group_t *group = lv_group_create();` emitted
- [ ] `lv_group_add_obj(group, obj)` emitted for each widget in the group (in order)
- [ ] `lv_group_set_wrap()` emitted if configured
- [ ] Default group set via `lv_indev_set_group()` for encoder/keyboard devices
