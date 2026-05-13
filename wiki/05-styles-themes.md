# 05 — Styles & Themes

LVGL's style system is one of its most powerful features. EmbeddedFlow must expose it fully.

## 5.1 Inline Styles (per widget)

- [~] `styles` object on every widget (basic properties in schema)
- [ ] All style properties exposed in `StyleProps`:

### Background
- [ ] `bgColor` — fill color
- [ ] `bgOpacity` — 0–255
- [ ] `bgGradColor` — gradient end color
- [ ] `bgGradDir` — `none`, `horizontal`, `vertical`
- [ ] `bgGradStop` — gradient stop position (0–255)
- [ ] `bgMainStop` — gradient start position (0–255)
- [ ] `bgDitherMode` — `none`, `ordered`, `err_diffuse`
- [ ] `bgImageSrc` — background image asset ID
- [ ] `bgImageOpacity`
- [ ] `bgImageTintColor`
- [ ] `bgImageTintOpacity`

### Border
- [ ] `borderColor`
- [ ] `borderOpacity`
- [x] `borderWidth`
- [ ] `borderSide` — `none`, `bottom`, `top`, `left`, `right`, `full`, `internal`
- [ ] `borderPost` — draw border after children

### Outline
- [ ] `outlineColor`
- [ ] `outlineOpacity`
- [ ] `outlineWidth`
- [ ] `outlinePad` — offset from edge

### Shadow
- [ ] `shadowColor`
- [ ] `shadowOpacity`
- [ ] `shadowWidth`
- [ ] `shadowOffsetX`, `shadowOffsetY`
- [ ] `shadowSpread`

### Text
- [ ] `textColor`
- [ ] `textOpacity`
- [x] `fontSize`
- [ ] `fontFamily` — reference to font ID in `fonts[]`
- [ ] `textLetterSpace`
- [ ] `textLineSpace`
- [ ] `textDecor` — `none`, `underline`, `strikethrough`
- [x] `textAlign` — `left`, `center`, `right`, `auto`

### Image
- [ ] `imageOpacity`
- [ ] `imageRecolor` — tint color
- [ ] `imageRecolorOpacity`

### Line
- [ ] `lineColor`
- [ ] `lineOpacity`
- [ ] `lineWidth`
- [ ] `lineDashWidth`, `lineDashGap`
- [ ] `lineRounded`

### Arc
- [ ] `arcColor`
- [ ] `arcOpacity`
- [ ] `arcWidth`
- [ ] `arcRounded`

### Transform (LVGL 9+)
- [ ] `transformWidth`, `transformHeight`
- [ ] `translateX`, `translateY`
- [ ] `scaleX`, `scaleY`
- [ ] `rotation`
- [ ] `pivotX`, `pivotY`
- [ ] `skewX`, `skewY`

### Padding / Margin
- [x] `padding` — shorthand
- [ ] `paddingTop`, `paddingBottom`, `paddingLeft`, `paddingRight`
- [ ] `paddingRow`, `paddingColumn` (grid layout)
- [ ] `marginTop`, `marginBottom`, `marginLeft`, `marginRight`

### Size & Position
- [ ] `minWidth`, `maxWidth`, `minHeight`, `maxHeight`
- [ ] `alignmentX`, `alignmentY` — scroll snap alignment

### Misc
- [x] `borderRadius`
- [ ] `clipCorner` — clip children to rounded corners
- [ ] `opacity` — overall opacity of the object
- [ ] `blendMode`
- [ ] `colorFilterDsc`, `colorFilterOpacity`
- [ ] `transitionList` — style transitions

## 5.2 Named Styles (Shared Styles)

- [ ] `styles[]` section at project root — define reusable named styles
- [ ] Widgets reference named styles by ID via `styleIds: ["my_style"]`
- [ ] Named styles can have a `selector` (part + state combination)
- [ ] Named styles are compiled to `lv_style_t` declarations in codegen
- [ ] Named styles panel in visual editor with live editing

## 5.3 State Selectors

Every style property can be set per state:

- [ ] `LV_STATE_DEFAULT` (normal)
- [ ] `LV_STATE_CHECKED`
- [ ] `LV_STATE_FOCUSED`
- [ ] `LV_STATE_FOCUS_KEY`
- [ ] `LV_STATE_EDITED`
- [ ] `LV_STATE_HOVERED`
- [ ] `LV_STATE_PRESSED`
- [ ] `LV_STATE_SCROLLED`
- [ ] `LV_STATE_DISABLED`
- [ ] `LV_STATE_USER_1` through `LV_STATE_USER_4`

## 5.4 Part Selectors

Every style property can be set per widget part:

- [ ] `LV_PART_MAIN`
- [ ] `LV_PART_SCROLLBAR`
- [ ] `LV_PART_INDICATOR` (slider, bar, arc, checkbox, switch)
- [ ] `LV_PART_KNOB` (slider, arc)
- [ ] `LV_PART_SELECTED` (list, roller, table)
- [ ] `LV_PART_ITEMS` (chart, table, keyboard, roller)
- [ ] `LV_PART_CURSOR` (textarea)
- [ ] `LV_PART_CUSTOM_FIRST` (user-defined)

## 5.5 Style Inheritance

- [ ] Child widgets inherit styleable properties from parent (LVGL cascade)
- [ ] Explicit `lv_obj_remove_style_all()` option per widget
- [ ] Visual editor shows inherited vs overridden properties distinctly

## 5.6 Themes

- [ ] Default theme (LVGL built-in) — light mode
- [ ] Default theme — dark mode toggle in preview
- [ ] Simple theme
- [ ] Mono theme (for 1-bit displays)
- [ ] Custom theme: define primary + secondary palette colors
- [ ] Theme selector in preview toolbar
- [ ] Theme is emitted correctly in codegen (`lv_theme_default_init`)

## 5.7 Style Transitions

- [ ] `transition` style property: which property, duration, delay, easing
- [ ] Transitions shown live in the preview (state changes animate)
- [ ] Transitions serialised in `.embf` and emitted in codegen
