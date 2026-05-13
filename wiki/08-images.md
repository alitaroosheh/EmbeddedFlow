# 08 — Images & Bitmaps

## 8.1 Image Import

- [ ] Import PNG, JPEG, BMP, GIF source images
- [ ] Imported images are stored in `images[]` in the `.embf` file as relative path references
- [ ] Images panel in visual editor shows thumbnails of all project images
- [ ] Drag an image from the panel onto the canvas to create an `lv_image` widget

## 8.2 LVGL Color Format Conversion

Convert source images to LVGL-compatible binary format at build/export time:

- [ ] `LV_COLOR_FORMAT_RGB565` (16-bit, no alpha)
- [ ] `LV_COLOR_FORMAT_RGB565A8` (16-bit + 8-bit alpha plane)
- [ ] `LV_COLOR_FORMAT_RGB888` (24-bit)
- [ ] `LV_COLOR_FORMAT_ARGB8888` (32-bit with alpha)
- [ ] `LV_COLOR_FORMAT_L8` (grayscale 8-bit)
- [ ] `LV_COLOR_FORMAT_AL88` (grayscale + alpha)
- [ ] `LV_COLOR_FORMAT_A8` (alpha-only mask)
- [ ] Per-image format override (defaults to project display color format)
- [ ] Output as C array (`.c`/`.h`) or binary `.bin` file

## 8.3 RLE Compression

- [ ] Option to enable LVGL RLE compression per image
- [ ] Compressed size estimate shown in the images panel
- [ ] Codegen marks the image descriptor with `LV_IMAGE_FLAGS_COMPRESSED`

## 8.4 Image Descriptor (v8 vs v9)

LVGL v8 and v9 use different image descriptor formats:

- [ ] v8 descriptor: `lv_img_dsc_t` with `header.cf`, `header.w/h`, `data`, `data_size`
- [ ] v9 descriptor: `lv_image_dsc_t` with new header + `stride` field
- [ ] Conversion tool produces the correct descriptor for the selected LVGL version

## 8.5 Animated Images (lv_animimage)

- [ ] Import a sequence of frames (individual PNGs or a GIF)
- [ ] Specify animation speed (ms per frame)
- [ ] Produces an array of `lv_image_dsc_t` in codegen
- [ ] Preview plays the animation in the WASM panel

## 8.6 Image Button (lv_imagebutton)

- [ ] Per-state image sources: released, pressed, disabled, checked
- [ ] Left / middle / right parts for stretchable buttons
- [ ] Full schema + codegen support

## 8.7 Image Preview in Visual Editor

- [ ] Images render correctly on the design canvas (not placeholder boxes)
- [ ] Proper aspect ratio maintained if only one dimension is specified
- [ ] Alpha transparency shown correctly on canvas
