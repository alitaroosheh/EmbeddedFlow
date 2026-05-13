# 07 — Fonts

## 7.1 Built-in Montserrat Fonts

All LVGL built-in Montserrat sizes must be selectable:

- [ ] 8px
- [ ] 10px
- [ ] 12px
- [x] 14px (default — configured in `lv_conf.h`)
- [ ] 16px
- [ ] 18px
- [ ] 20px
- [ ] 22px
- [ ] 24px
- [ ] 26px
- [ ] 28px
- [ ] 30px
- [ ] 32px
- [ ] 34px
- [ ] 36px
- [ ] 38px
- [ ] 40px
- [ ] 42px
- [ ] 44px
- [ ] 46px
- [ ] 48px

Each size is enabled/disabled in `lv_conf.h`. Built-in font sizes used in a project are automatically enabled in the generated `lv_conf.h`.

## 7.2 Built-in Symbol Font (lv_font_symbol)

- [ ] Full LVGL symbol glyphs available as a selectable font
- [ ] Symbol picker UI in the property inspector for label text
- [ ] Symbols rendered correctly in the preview

## 7.3 Custom TTF / OTF Font Import

- [ ] Drag-and-drop `.ttf` or `.otf` file into the Fonts panel to import
- [ ] Specify: font size (px), Unicode ranges / glyph subset
- [ ] Preview the imported font glyphs before confirming
- [ ] Font stored as a reference path in `fonts[]` of the `.embf` file
- [ ] At build/export time, font is compiled to LVGL C binary array using `lv_font_conv` (Node.js)
- [ ] Generated `.c` / `.h` file placed in the output directory

## 7.4 Unicode / Glyph Subset Selection

- [ ] Range picker: ASCII (0x20–0x7F), Latin-1 (0x80–0xFF), Cyrillic, Arabic, CJK, etc.
- [ ] Custom codepoint list / range input
- [ ] Glyph count estimate and output file size estimate shown
- [ ] Auto-detect glyphs used in the project (only include what is referenced in label text)

## 7.5 FreeType Runtime Font Loading (LVGL 8+)

- [ ] `lv_freetype_font_create()` support — load font from filesystem at runtime
- [ ] Schema field: `source` on a font entry points to a TTF path on the device
- [ ] Preview can use FreeType WASM rendering for these fonts
- [ ] Codegen emits `lv_freetype_font_create()` call

## 7.6 Bitmap / BDF / PCF Fonts

- [ ] Import `.bdf` or `.pcf` bitmap fonts
- [ ] Converted to LVGL C array via `lv_font_conv`

## 7.7 Font Fallback Chain

- [ ] Per-font: specify a fallback font ID for missing glyphs
- [ ] Codegen emits `lv_font_set_fallback()` (LVGL 9+)

## 7.8 Font Preview

- [ ] Fonts panel shows a rendered glyph sample ("The quick brown fox...")
- [ ] Preview updates at the selected font size
- [ ] Click any font in the panel to apply it to the selected widget
