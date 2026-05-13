# 16 — Build & Export

## 16.1 Export Formats

- [ ] **LVGL C Project** — self-contained `ui/` folder (see Section 15)
- [ ] **ZIP archive** — the C project zipped for easy sharing
- [ ] **EEZ Project** — export as `.eez-project` for opening in EEZ Studio (round-trip)
- [ ] **SquareLine Studio** — export compatible C output (SquareLine-style naming)

## 16.2 Platform Presets

Presets configure the generated `lv_conf.h` and `CMakeLists.txt` / build files:

- [ ] **Generic / Bare Metal** — minimal lv_conf, no platform assumptions
- [ ] **ESP-IDF (ESP32 / ESP32-S3)** — `esp_lvgl_port` integration hints
- [ ] **STM32 HAL / TouchGFX alt** — FreeRTOS tick, DMA2D hints in comments
- [ ] **Zephyr RTOS** — Zephyr module structure, `prj.conf` snippet
- [ ] **Linux (SDL2 PC simulator)** — SDL2 driver boilerplate
- [ ] **Arduino** — `lvgl_setup()` / `lvgl_loop()` Arduino sketch stub
- [ ] **Raspberry Pi Pico (SDK)** — CMake pico_sdk integration
- [ ] **NuttX** — NuttX framebuffer driver hints

## 16.3 Asset Build Pipeline

At export time, all referenced assets are compiled:

- [ ] Fonts: TTF → LVGL C array via `lv_font_conv` (bundled Node.js tool)
- [ ] Images: PNG/JPEG → LVGL binary via `lv_img_conv` (bundled Node.js tool)
- [ ] Assets compiled for the correct LVGL version and color format
- [ ] Asset output files placed in the correct output subdirectory

## 16.4 Export Dialog

- [ ] Output directory picker
- [ ] Platform preset selector
- [ ] Options: include/exclude images, include/exclude fonts, include generated `lv_conf.h`
- [ ] "Dry run" mode — show what files would be written without writing them
- [ ] Progress indicator for large asset sets

## 16.5 Incremental / Watch Mode Export

- [ ] `EmbeddedFlow: Watch & Export` command — re-exports on every `.embf` save
- [ ] Only changed files are re-written (hash-based comparison)
- [ ] Useful during firmware development: save the `.embf`, firmware rebuild picks up new `ui/` files

## 16.6 Embedded Binary Export

- [ ] Export as compiled binary blob (EEZ-style `GUI_ASSETS_DATA`) for use with the EEZ WASM runtime
- [ ] Binary blob can be flashed to external flash and loaded at runtime
- [ ] Compression option (LZ4)
