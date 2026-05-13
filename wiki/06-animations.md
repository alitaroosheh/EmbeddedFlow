# 06 — Animations

LVGL's `lv_anim_t` system drives property animations. EmbeddedFlow must support both
style transitions (Section 05) and explicit property animations.

## 6.1 Animation Definition in .embf

- [ ] `animations[]` section per widget — list of `lv_anim_t` descriptors
- [ ] Each animation entry has:
  - [ ] `target` — widget ID
  - [ ] `property` — the animated property (x, y, width, height, opacity, value, etc.)
  - [ ] `from`, `to` — start and end values
  - [ ] `duration` — milliseconds
  - [ ] `delay` — start delay in ms
  - [ ] `repeatCount` — 0 = infinite, n = n times, `LV_ANIM_REPEAT_INFINITE`
  - [ ] `repeatDelay` — ms between repeat cycles
  - [ ] `playback` — run animation in reverse on completion
  - [ ] `playbackDelay` — ms before reverse run
  - [ ] `easing` — easing function (see 6.4)
  - [ ] `trigger` — `on_load`, `on_event`, `manual`

## 6.2 Timeline Editor

- [ ] Visual timeline panel (inspired by EEZ Studio timeline)
- [ ] Horizontal time axis in ms
- [ ] Each animated property is a track/row
- [ ] Keyframes displayed as draggable blocks on the timeline
- [ ] Scrubber to preview the animation at any time position
- [ ] Play / Stop / Loop controls
- [ ] Zoom the timeline (scroll to expand/compress time axis)

## 6.3 Property Animation Support

- [ ] Position: `x`, `y`
- [ ] Size: `width`, `height`
- [ ] Opacity: `opacity`
- [ ] Value (arc, slider, bar): `value`
- [ ] Background color: `bgColor` (color interpolation)
- [ ] Text color: `textColor`
- [ ] Border width: `borderWidth`
- [ ] Border radius: `borderRadius`
- [ ] Scale: `scaleX`, `scaleY`
- [ ] Rotation: `rotation`
- [ ] Translation: `translateX`, `translateY`
- [ ] Screen transition (not a property anim — see Section 12)

## 6.4 Easing Functions

- [ ] `lv_anim_path_linear`
- [ ] `lv_anim_path_ease_in`
- [ ] `lv_anim_path_ease_out`
- [ ] `lv_anim_path_ease_in_out`
- [ ] `lv_anim_path_overshoot`
- [ ] `lv_anim_path_bounce`
- [ ] `lv_anim_path_step`
- [ ] Custom path (user-defined C function) — reference in codegen

## 6.5 Live Preview of Animations

- [ ] Animations run live in the WASM preview panel
- [ ] Timeline scrubber seeks the WASM state to any time position
- [ ] "Play from start" resets and replays the animation

## 6.6 Code Generation for Animations

- [ ] Each animation emits `lv_anim_t a; lv_anim_init(&a); ...` in codegen
- [ ] Easing path set via `lv_anim_set_path_cb()`
- [ ] Repeat/playback settings emitted correctly
- [ ] Trigger events wired to `lv_anim_start()` calls
