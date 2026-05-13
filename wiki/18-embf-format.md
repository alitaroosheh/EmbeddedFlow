# 18 — .embf File Format

The `.embf` file is the single source of truth for an EmbeddedFlow project.
It is a UTF-8 JSON file. This section tracks the completeness of the schema.

## 18.1 Top-Level Structure

```jsonc
{
  "version": "1.0",
  "project": { ... },
  "display": { ... },
  "theme": { ... },
  "fonts": [ ... ],
  "images": [ ... ],
  "styles": [ ... ],     // named styles
  "groups": [ ... ],     // focus groups
  "inputDevices": [ ... ],
  "pages": [ ... ]
}
```

- [x] `version` — `"1.0"` (schema version for migration)
- [x] `project` section
- [x] `display` section
- [x] `theme` section (basic)
- [~] `fonts[]` section (schema defined, not fully used)
- [~] `images[]` section (schema defined, not fully used)
- [ ] `styles[]` section — named shared styles
- [ ] `groups[]` section — focus groups
- [ ] `inputDevices[]` section
- [x] `pages[]` section

## 18.2 Project Section

- [x] `project.name`
- [x] `project.lvglVersion` — enum `"8.4.0"` | `"9.2.2"` | `"9.3.0"` | `"9.4.0"` | `"9.5.0"`
- [x] `project.description`

## 18.3 Display Section

- [x] `display.width`, `display.height`
- [x] `display.bitDepth` — 16 | 24 | 32
- [x] `display.colorFormat`
- [x] `display.orientation`
- [x] `display.direction`
- [x] `display.dpi`

## 18.4 Theme Section

- [x] `theme.dark`
- [x] `theme.primaryColor`
- [x] `theme.secondaryColor`

## 18.5 Font Entry

- [x] `fonts[].id`
- [x] `fonts[].name`
- [x] `fonts[].size`
- [x] `fonts[].source` — path to TTF/OTF file
- [ ] `fonts[].glyphRanges` — array of unicode ranges
- [ ] `fonts[].fallbackFontId` — fallback font reference
- [ ] `fonts[].bpp` — bits per pixel for anti-aliasing (1, 2, 4, 8)
- [ ] `fonts[].type` — `"builtin"` | `"custom"` | `"freetype"`

## 18.6 Image Entry

- [x] `images[].id`
- [x] `images[].path`
- [ ] `images[].colorFormat` — override per image
- [ ] `images[].compressed` — boolean (RLE)
- [ ] `images[].pivot` — `{x, y}` for rotation pivot

## 18.7 Named Style Entry

- [ ] `styles[].id`
- [ ] `styles[].name`
- [ ] `styles[].selector` — `"part:LV_PART_MAIN state:LV_STATE_DEFAULT"` style string
- [ ] `styles[].props` — full `StyleProps` object (see Section 05)

## 18.8 Group Entry

- [ ] `groups[].id`
- [ ] `groups[].name`
- [ ] `groups[].wrap`
- [ ] `groups[].refocusPolicy`
- [ ] `groups[].defaultForEncoder` — boolean
- [ ] `groups[].defaultForKeyboard` — boolean

## 18.9 Page Entry

- [x] `pages[].id`
- [x] `pages[].name`
- [x] `pages[].backgroundColor`
- [x] `pages[].components[]`
- [ ] `pages[].createAtStart`
- [ ] `pages[].deleteOnUnload`
- [ ] `pages[].events[]` — page lifecycle events
- [ ] `pages[].displayId` — which display this page belongs to (multi-display)

## 18.10 Base Component Properties

- [x] `id`, `type`, `x`, `y`, `width`, `height`, `hidden`, `styles`
- [ ] `align` — LVGL alignment
- [ ] `styleIds[]` — references to named styles
- [ ] `events[]` — event handlers list
- [ ] `animations[]` — animations list
- [ ] `flags[]` — LVGL `lv_obj_flag_t` values to add/remove
- [ ] `scrollable`, `scrollbarMode`
- [ ] `groupId`, `groupOrder`
- [ ] `comment`
- [ ] `userData`

## 18.11 Widget-specific Properties

- [x] Label: `text`, `longMode`
- [x] Button: `label`
- [x] Image: `src`
- [x] Slider: `min`, `max`, `value`
- [x] Switch: `checked`
- [x] Bar: `min`, `max`, `value`, `mode`
- [x] Spinner: `speed`, `arcLength`
- [x] Arc: `min`, `max`, `value`, `startAngle`, `endAngle`, `mode`
- [x] Checkbox: `text`, `checked`
- [x] Dropdown: `options[]`, `selectedIndex`
- [x] Roller: `options[]`, `selectedIndex`, `mode`
- [x] Textarea: `text`, `placeholder`, `oneLine`
- [x] Line: `points[]`, `rounded`
- [x] Container: `layout`, `flexFlow`, `children[]`
- [x] Panel: `children[]`
- [ ] Spinbox: `min`, `max`, `value`, `digitCount`, `separatorPosition`
- [ ] ButtonMatrix: `map[]`, `ctrlMap[]`
- [ ] Chart: `chartType`, `series[]`, `axes`
- [ ] Meter: `scales[]`, `indicators[]`
- [ ] Scale: `range`, `minorTickCount`, `majorTickEvery`, `labels`
- [ ] LED: `color`, `brightness`
- [ ] Table: `rows`, `cols`, `cells[][]`
- [ ] Tabview: `tabPosition`, `tabs[]`
- [ ] Tileview: `tiles[]`, `scrollDirection`
- [ ] Window: `title`, `headerButtons[]`, `content`
- [ ] Menu: `items[]` tree

## 18.12 Schema Versioning

- [ ] `version` field incremented on breaking changes
- [ ] Migration scripts: `migrate_1_0_to_1_1.ts`, etc.
- [ ] Extension warns when opening a project with a newer schema version than supported
- [ ] Extension auto-migrates when opening an older schema version (with user confirmation)
