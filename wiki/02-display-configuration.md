# 02 — Display Configuration

## 2.1 Core Properties

- [x] `display.width` and `display.height` (integer, 1–4096)
- [x] `display.bitDepth` — 16, 24, or 32
- [x] `display.colorFormat` — `RGB565`, `RGB888`, `ARGB8888`, `L8`, `AL88`
- [x] `display.orientation` — `portrait`, `landscape`, `portrait_flipped`, `landscape_flipped`
- [x] `display.direction` — `ltr`, `rtl`
- [x] `display.dpi` — dots per inch (integer)
- [x] Effective display size computed automatically when orientation causes a width/height swap

## 2.2 Hardware Presets

- [ ] Built-in preset list covering common embedded displays:
  - [ ] 240×320 (ILI9341, common ESP32 TFT)
  - [ ] 320×240 landscape (same, rotated)
  - [ ] 480×272 (STM32 Discovery, RK043FN02H)
  - [ ] 480×320
  - [ ] 800×480 (Riverdi, common industrial HMI)
  - [ ] 128×64 monochrome (OLED SSD1306)
  - [ ] 128×128 monochrome
  - [ ] 240×240 round (GC9A01)
  - [ ] 480×480 round (WT32-SC01 Plus)
  - [ ] 800×600
  - [ ] 1024×600 (Waveshare 7" LVGL dev kit)
- [ ] Presets populate width, height, bit depth, DPI and color format automatically
- [ ] User can save custom presets

## 2.3 Multiple Displays

- [ ] Project can define more than one display (for devices with a main + secondary screen)
- [ ] Each page is assigned to a display
- [ ] Preview panel can switch between displays

## 2.4 Color Format Impact

- [ ] Preview WASM renderer uses the declared color format (LVGL display driver configuration)
- [ ] Code generator emits the correct `lv_display_set_color_format()` call
- [ ] Warning shown when color format is incompatible with selected LVGL version

## 2.5 Rotation & Mirroring

- [ ] LVGL software rotation enabled via `lv_display_set_rotation()` (LVGL 9+)
- [ ] Preview panel physically rotates the canvas to match orientation
- [ ] Code generator emits the correct rotation call
