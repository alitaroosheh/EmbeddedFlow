# EmbeddedFlow — Framework Requirements

**Status:** Locked decisions (confirmed 2026-06-04)  
**Companion:** [VISION.md](./VISION.md), [ROADMAP.md](./ROADMAP.md)

Requirements grouped by phase and pillar. Check the box when a requirement is fully implemented and tested.

- `[x]` — done (in current VSIX v1.1.x)
- `[ ]` — not yet implemented

---

## Phase 1 — UI Designer + Navigation Graph + Property System

### Visual UI designer

- [x] **V1** Multi-page projects, widget palette, inspector
- [x] **V2** Live WASM preview, design/run modes
- [x] **V3** Styles, themes, animations, groups
- [x] **V4** Navigation Graph overlay on page designer — same IR, edges = navigation transitions
- [ ] **V5** Flex/grid layout authoring with codegen

### Navigation Graph

- [x] **N1** Page navigate with LVGL transitions (static calls)
- [x] **N2** Page swipe flows
- [x] **N3** Visual overlay on designer: nodes = pages, edges = transitions with animation + trigger metadata
- [x] **N4** Navigation edges stored in IR — compiler generates `ui_navigate_to_*()` static functions
- [ ] **N5** Navigation stack (push/pop/back) *(Phase 3)*

Navigation graph generates **only static LVGL calls** in Phase 1. No router, no stack.

### Property System *(IR metadata only in Phase 1)*

- [ ] **PR1** `model.properties[]` in `.embf`: id, type, default, min, max, direction hint
- [ ] **PR2** Properties used for preview mocks only — zero codegen in Phase 1
- [ ] **PR3** Inspector: add/edit/delete properties
- [ ] **PR4** Preview substitutes property defaults into bound widgets

### Internationalization (string resources)

Translatable UI text must not be hardcoded in `.embf` widgets. Strings live in a **separate `.res` resource file**; `.embf` references keys only. Codegen resolves keys at compile time (pure C, no runtime resource loader on device).

**File layout (target):**

```
my_app.embf
i18n/
  strings.res           ← default path; extension must be .res
```

**`.res` file format (on disk):** structured document (JSON-compatible body inside the `.res` file) with `defaultLocale` and per-locale key→value maps. The extension parses/saves `.res` only — not `.json` for application strings.

**Example `i18n/strings.res`:**

```json
{
  "defaultLocale": "en",
  "locales": {
    "en": {
      "temp_label": "Temperature",
      "settings_title": "Settings"
    },
    "fa": {
      "temp_label": "دما",
      "settings_title": "تنظیمات"
    }
  }
}
```

**Widget IR reference (target):** label `text` uses a resource key, not a literal:

```json
{ "text": { "ref": "temp_label" } }
```

(or equivalent `@temp_label` syntax — exact form TBD at implementation)

**String resource table editor (in extension):** users edit translations in a **spreadsheet-style table**, not raw file text by default.

| Key | en | fa | … |
|-----|----|----|---|
| `temp_label` | Temperature | دما | … |
| `settings_title` | Settings | تنظیمات | … |

- Rows = string keys (add/remove row)
- Columns = locale ids (add/remove column; one column marked default)
- Cells = editable translation text; changes persist to `.res` on save
- Optional “open as text” for power users

- [ ] **I18n1** Project declares `project.stringsPath` (default `i18n/strings.res` next to `.embf`); path must use **`.res`** extension
- [ ] **I18n2** `.res` schema: `defaultLocale`, `locales.<localeId>.<key>` → string value; parse/validate on load
- [ ] **I18n3** **String resource table editor** in VS Code: open linked `.res`, show keys × locales grid, inline edit
- [ ] **I18n4** Table actions: add/remove key row, add/remove locale column, set default locale
- [ ] **I18n5** Save table edits back to `.res` (atomic write; preserve unknown keys/locales not shown)
- [ ] **I18n6** Widget text (labels, buttons, etc.) can reference a string resource key instead of a literal
- [ ] **I18n7** Validation: missing keys reported at design time; fallback to `defaultLocale` then key id
- [ ] **I18n8** Preview: locale selector in designer; WASM preview shows selected locale strings from `.res`
- [ ] **I18n9** Codegen: emit string resources using **X-Macros** (single source list, no hand-maintained parallel enums/tables)
- [ ] **I18n10** Codegen: `lv_label_set_text` / `set_text` use `ui_get_string(UI_STR_<key>)`, not raw literals, when widget references a resource key
- [ ] **I18n11** Codegen (multi-locale): one X-Macro list per locale (or build-time locale define); `ui_get_string(id)` indexes the active locale table
- [ ] **I18n12** `set_text` actions accept resource keys, resolved through the same X-Macro string API

**Generated C layout (X-Macro — mandatory pattern):**

From `strings.res`, codegen emits:

| File | Purpose |
|------|---------|
| `ui_strings_ids.h` | Key list only: `#define UI_STRING_KEYS` with `X(UI_STR_<KEY>)` — shared by all locales |
| `ui_strings_<locale>.def` | Per locale: `#define UI_STRING_LIST` with `X(UI_STR_<KEY>, "translated text")` |
| `ui_strings.h` | `ui_string_id_t` enum (from keys X-Macro) + `const char *ui_get_string(ui_string_id_t id);` |
| `ui_strings.c` | String table + `ui_get_string()` built by including the active locale `.def` twice (enum already in `.h`) |

**Example generated `ui_strings_ids.h`:**

```c
#define UI_STRING_KEYS \
    X(UI_STR_TEMP_LABEL) \
    X(UI_STR_SETTINGS_TITLE)
```

**Example generated `ui_strings_en.def`:**

```c
#define UI_STRING_LIST \
    X(UI_STR_TEMP_LABEL, "Temperature") \
    X(UI_STR_SETTINGS_TITLE, "Settings")
```

**Example generated `ui_strings.h`:**

```c
typedef enum {
#define X(id) id,
    UI_STRING_KEYS
#undef X
    UI_STR_COUNT
} ui_string_id_t;

const char *ui_get_string(ui_string_id_t id);
```

**Example generated `ui_strings.c` (build locale = `en`):**

```c
#include "ui_strings.h"
#include "ui_strings_en.def"

static const char *const ui_strings_table[UI_STR_COUNT] = {
#define X(id, text) text,
    UI_STRING_LIST
#undef X
};

const char *ui_get_string(ui_string_id_t id)
{
    if ((unsigned)id >= (unsigned)UI_STR_COUNT) {
        return "";
    }
    return ui_strings_table[id];
}
```

**Widget / action codegen example:**

```c
lv_label_set_text(ui_lbl_temp, ui_get_string(UI_STR_TEMP_LABEL));
```

**Multi-locale firmware:** ship `ui_strings_en.def`, `ui_strings_fa.def`, … and either (a) compile `ui_strings.c` once per locale with `-DUI_LOCALE=en`, or (b) generate `ui_strings_<locale>.c` each including its `.def`. Active locale selected at build time or via a single `ui_set_locale()` that swaps table pointer — still **no** `.res` parser on device.

**Constraints:**

- String resources are **not** merged into `.embf` by default (translators edit `.res` via table or file)
- On device: **no** runtime loading of `.res` — only static `const char *` tables from X-Macros
- **No** duplicate manual maintenance of enum values vs table indices — keys list and locale lists must stay in sync via X-Macro only
- LVGL remains the only generated-code dependency
- Application string files use **`.res` only** (not `.json`) for this feature

**Extension UI (designer chrome):** optional later — `package.nls.json` for the VS Code extension’s own UI language; separate from application `.res` files.

---

## Phase 2 — Symbol Discovery + Binding

### Symbol discovery

- [ ] **SD1** EmbeddedFlow spawns dedicated clangd instance per project
- [ ] **SD2** Firmware project path configured in `.embf` `project.firmwarePath`
- [ ] **SD3** clangd pointed at `compile_commands.json` — headless, no user IDE dependency
- [ ] **SD4** LSP queries: globals, struct members, function signatures
- [ ] **SD5** Symbol graph built and cached per session

### Binding UX

- [ ] **BU1** Tree picker: widget → "Bind Data" → browse symbol tree
- [ ] **BU2** IntelliSense autocomplete for manual symbol path entry
- [ ] **BU3** Both UIs resolve to the same IR binding object
- [ ] **BU4** Type validation at bind time (e.g. float symbol → float property)

### Code mapping

- [ ] **CM1** Binding `direction` field in IR: `push` or `pull`
- [ ] **CM2** `push` → generate `ui_set_<id>(T value)` setter function
- [ ] **CM3** `pull` → generate `extern T symbol` + `ui_bindings_apply()` entry
- [ ] **CM4** Direction determined by IR — developer does not choose per-binding manually
- [ ] **CM5** Transforms: range map, format string, enum→resource
- [ ] **CM6** Visibility binding: `visible when property/state` *(Phase 3)*

---

## Phase 3 — State + Actions + Generated Framework

### State — FSM

- [ ] **SF1** `state.fsm` in `.embf`: named states, initial state
- [ ] **SF2** Generate `app_state_t` enum + `set_state()` transition function in `ui_fsm.c`
- [ ] **SF3** State entry/exit triggers actions (IR-declared)
- [ ] **SF4** FSM and derived state are strictly separate layers — never merged

### State — Derived

- [ ] **DV1** `model.derived[]` in `.embf`: id + C expression string
- [ ] **DV2** Generate inline function (no storage) or cached variable updated in `update_derived_states()`
- [ ] **DV3** Derived state referenced in visibility rules and action guards

### Actions

- [x] **A1** `navigate` action (static call)
- [x] **A2** `set_value`, `set_text`, `set_theme` actions
- [ ] **A3** `actions[]` top-level in `.embf`: trigger + typed instruction sequence
- [ ] **A4** Action types: `navigate`, `set_property`, `set_state`, `call_function`
- [ ] **A5** Triggers: widget events, FSM entry/exit, timer (`every:<ms>`, `after:<ms>`)
- [ ] **A6** Sequential composition in IR — flattened to one C function per trigger at compile time
- [ ] **A7** `call_function`: symbol validated against clangd symbol graph
- [ ] **A8** `publish` action type defined in IR (Phase 4 implements transport)

**Constraint:** no runtime interpreter, no dynamic dispatch, no scripting, no reflection — in any action context.

### Generated Framework

- [ ] **GF1** Generate `embf_app.c` / `embf_app.h` as orchestration glue
- [ ] **GF2** `embf_app_init()`: calls `ui_init`, `ui_styles_init`, `state_init`, `ui_bindings_init`, `actions_init` in correct order
- [ ] **GF3** `embf_app_tick()`: calls `update_derived_states`, `ui_bindings_apply`, `process_timers`
- [ ] **GF4** `embf_dispatch_event(ui_event_t *)`: routes events to compiled action functions
- [ ] **GF5** Generated framework contains zero runtime logic — deterministic wiring only

---

## Phase 4 — Protocol Bindings

### Interface contract

- [ ] **PC1** `protocol[]` in `.embf`: abstract direction + topic + propertyId binding declarations
- [ ] **PC2** Generate `embf_protocol.h`: `embf_publish_fn` and `embf_subscribe_fn` typedefs + extern pointers
- [ ] **PC3** EmbeddedFlow owns interface definition only — never generates a protocol stack
- [ ] **PC4** Firmware wires adapter once: `embf_publish = my_mqtt_publish`
- [ ] **PC5** Core generated code compiles and links without any adapter present

### Adapter ecosystem

- [ ] **PA1** Optional sidecar adapter for ESP-IDF MQTT
- [ ] **PA2** Optional sidecar adapter for Zephyr BLE / networking
- [ ] **PA3** Optional sidecar adapter for Modbus
- [ ] **PA4** Adapters are not part of core codegen — separate distribution

---

## Hard constraints (all phases)

These are non-negotiable at every phase. No PR may violate them.

- [x] Output language: pure C only
- [x] External dependency in generated code: LVGL only
- [x] No runtime interpreter — ever
- [x] No dynamic dispatch on device
- [x] One IR → one deterministic compiled artifact
- [x] clangd: headless, EmbeddedFlow-owned, never user-visible *(enforced from Phase 2)*
- [x] Protocol stacks: firmware-owned; EmbeddedFlow defines interface only *(enforced from Phase 4)*
