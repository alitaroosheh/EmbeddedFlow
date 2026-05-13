# 10 — Layouts

LVGL supports Flex and Grid layouts on container objects. These must be fully editable.

## 10.1 Flex Layout

Schema fields on a `container` component:

- [x] `layout: "flex"` — enable flex
- [x] `flexFlow` — `row`, `column`, `row_wrap`, `column_wrap`
- [ ] `flexAlign` — main axis alignment:
  - [ ] `start` → `LV_FLEX_ALIGN_START`
  - [ ] `end` → `LV_FLEX_ALIGN_END`
  - [ ] `center` → `LV_FLEX_ALIGN_CENTER`
  - [ ] `space_evenly` → `LV_FLEX_ALIGN_SPACE_EVENLY`
  - [ ] `space_around` → `LV_FLEX_ALIGN_SPACE_AROUND`
  - [ ] `space_between` → `LV_FLEX_ALIGN_SPACE_BETWEEN`
- [ ] `flexCrossAlign` — cross axis (per-item): `start`, `end`, `center`
- [ ] `flexTrackCrossAlign` — cross axis (per-track)

Per-child flex properties:
- [ ] `flexGrow` — integer (0 = no grow, 1+ = proportional)

Codegen:
- [ ] `lv_obj_set_layout(obj, LV_LAYOUT_FLEX)` emitted correctly
- [ ] `lv_obj_set_flex_flow()` and `lv_obj_set_flex_align()` emitted

## 10.2 Grid Layout

Schema fields on a `container` component:

- [ ] `layout: "grid"` — enable grid
- [ ] `gridColumnDescriptors[]` — array of column sizes:
  - [ ] Pixel values: `80` → `LV_GRID_FR(x)` or fixed px
  - [ ] Fraction units: `"1fr"`, `"2fr"`
  - [ ] Content-sized: `"content"` → `LV_GRID_CONTENT`
  - [ ] Template must end with `"template_last"` → `LV_GRID_TEMPLATE_LAST`
- [ ] `gridRowDescriptors[]` — array of row sizes (same options)
- [ ] `gridColumnGap`, `gridRowGap`
- [ ] `gridAlign` — horizontal grid alignment
- [ ] `gridVAlign` — vertical grid alignment

Per-child grid placement:
- [ ] `gridCol` — column index
- [ ] `gridRow` — row index
- [ ] `gridColSpan` — columns to span (default 1)
- [ ] `gridRowSpan` — rows to span (default 1)
- [ ] `gridCellXAlign`, `gridCellYAlign` — alignment within cell

Codegen:
- [ ] Grid descriptor arrays emitted as `static lv_coord_t col_dsc[] = {..., LV_GRID_TEMPLATE_LAST};`
- [ ] `lv_obj_set_layout(obj, LV_LAYOUT_GRID)` emitted
- [ ] Per-child `lv_obj_set_grid_cell()` calls emitted

## 10.3 Layout Editor UI

- [ ] Flex properties shown in Property Inspector when `layout == "flex"` is set
- [ ] Grid properties shown when `layout == "grid"` is set
- [ ] Visual grid overlay shown on canvas for grid containers
- [ ] Visual flex arrows/spacing indicators for flex containers
- [ ] Drag column/row separators on canvas to resize grid tracks
- [ ] `flexGrow` / `gridCell` per-child properties editable in Property Inspector when a child is selected inside a layout container
