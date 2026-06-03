# EmbeddedFlow — Architecture (Target)

**Status:** Target architecture for planning  
**Companion:** [VISION.md](./VISION.md), [REQUIREMENTS.md](./REQUIREMENTS.md)

---

## Layered model

EmbeddedFlow follows a **Model – ViewModel – View** separation adapted for embedded C and LVGL.

```
┌─────────────────────────────────────────────────────────────┐
│  Application / Firmware (developer-owned)                    │
│  • Business logic  • Drivers  • Protocols  • Persistence       │
│  • Model: structs, globals, APIs (wifi_scan, sensor_read)    │
└───────────────────────────┬─────────────────────────────────┘
                            │ read / write (typed)
┌───────────────────────────▼─────────────────────────────────┐
│  EmbeddedFlow framework (generated + small runtime)            │
│  • Properties & state store                                  │
│  • Binding engine / refresh policies                           │
│  • Action dispatcher (UI + timer + bus events)                 │
│  • Settings service                                          │
│  • Navigation controller                                       │
└───────────────────────────┬─────────────────────────────────┘
                            │ LVGL API
┌───────────────────────────▼─────────────────────────────────┐
│  View (generated from .embf)                                   │
│  • ui_*.c object trees  • styles  • assets                     │
└─────────────────────────────────────────────────────────────┘
```

### View (today: largely implemented)

- Source: `.embf` → `pages[]`, `components[]`, `styles[]`, `events[]`, `flows[]`
- Output: `ui_page_*.c`, `ui_styles.c`, assets
- Preview: WASM runtime mirrors structure

### ViewModel (today: partial)

- Source: `dataModel`, widget `bindings`, label `{{field}}`, event `actions`
- Output today: `ui_bindings.c`, `ui_set_*`, `ui_bindings_apply()`
- Target: full refresh graph, list repeaters, transforms, action handlers, navigation stack

### Model (today: developer-owned only)

- Lives in firmware C; **not** duplicated inside `.embf` except mocks for preview
- Target: symbol references from `.embf` to workspace C (clangd/LSP), typed paths, compile-time validation

---

## Data flow (target)

### Read path (Model → UI)

1. Firmware or mock updates a **property** (`app.temp_c = 24`).
2. Framework marks dependents dirty (bindings referencing `temp_c`).
3. ViewModel runs refresh (on load, timer, or event).
4. LVGL widgets update (label text, bar value, visibility).

### Write path (UI → Model)

1. User interacts (slider, textarea, toggle).
2. **Action** updates property or calls firmware hook (`ui_set_brightness` → `settings.brightness`).
3. Optional **persist** action writes NVS/EEPROM via registered driver.
4. Read path propagates side effects (other bound widgets).

Write paths must be **explicit** in v1 (no silent two-way binding everywhere).

---

## Declarative project surface (evolving `.embf`)

Current and planned declarative sections:

| Section | Status | Purpose |
|---------|--------|---------|
| `pages` / widgets | Implemented | View layout |
| `styles`, `theme` | Implemented | Visual chrome |
| `dataModel.fields` | Partial | App properties (preview defaults) |
| Widget `bindings` | Partial | Numeric `value` → field |
| Label `{{field}}` | Partial | Text binding |
| `events` / `actions` | Partial | navigate, set_value, set_text, set_theme |
| `properties` (typed, sources) | Planned | Symbol-backed model |
| `states` / `visibility` | Planned | Derived UI rules |
| `settings` schema | Planned | Keys, types, storage backend id |
| `repeaters` / list templates | Planned | WiFi list, log viewers |
| `transforms` | Planned | RSSI→bars, enum→icon |
| `refreshPolicies` | Planned | on_load, timer, on_event |
| `commBindings` | Planned | MQTT topic → property |
| `navigation` stack | Planned | Beyond single-shot navigate |

Detailed binding requirements: [wiki/19-code-binding-and-data-model.md](../wiki/19-code-binding-and-data-model.md).

---

## Codegen vs runtime

| Approach | Use |
|----------|-----|
| **Codegen-first** | Default: bindings compile to straight C, minimal RAM |
| **Thin runtime library** | Optional shared `embf_runtime.h` for navigation stack, property store, refresh scheduler |
| **No interpreter** | No Lua/JS on device; no reflection |

Preview uses **mocks** and WASM — not firmware symbols at runtime.

---

## Decision filter (mandatory for reviews)

Before merging a feature, answer:

1. **Framework vs designer?** Does it only help draw screens?
2. **Declarative?** Does it reduce hand-written `lv_*_set_*` in application code?
3. **Coupling?** Does UI stay ignorant of business logic details (only bindings)?
4. **Embedded-fit?** Flash/RAM predictable? No desktop-only assumptions?
5. **Incremental?** Can adopters use one screen or one binding without migrating entire app?

Reject or defer items that fail (1) unless they unblock a strategic pillar.

---

## Non-goals (framework v1)

- General scripting runtime on MCU
- Replacing LVGL with a custom renderer
- Full visual logic editor (Blockly) — actions stay declarative JSON
- Auto-generating entire driver stacks (WiFi, MQTT clients remain user code)
- GDB/live RAM attach in preview (mocks first)

---

## Integration with developer workflow

- **IDE:** VS Code / Cursor extension (design, preview, lint, codegen)
- **Firmware:** Generated files merged into ESP-IDF, Zephyr, CMake, etc.
- **Symbols:** C/C++ extension + clangd for pickers and validation
- **Versioning:** `.embf` schema versioned; codegen banner warns on regen
