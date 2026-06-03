# EmbeddedFlow — Framework Requirements

**Status:** Planning requirements (pre-release)  
**Companion:** [VISION.md](./VISION.md), [ROADMAP.md](./ROADMAP.md)

Requirements are grouped by pillar. Each item is tagged:

- **P0** — Required for “framework credibility” (not just designer)
- **P1** — Important next wave
- **P2** — Strategic, later phase

**Current VSIX** satisfies mostly **View** and early **ViewModel** items marked `[today]`.

---

## 1. Visual UI designer

| ID | Priority | Requirement | Notes |
|----|----------|-------------|-------|
| V1 | [today] | Multi-page projects, widget palette, inspector | Core editor |
| V2 | [today] | Live WASM preview, design/run modes | |
| V3 | [today] | Styles, themes, animations, groups | |
| V4 | P1 | Flex/grid layout authoring with codegen | Reduce manual x/y |
| V5 | P2 | Component library across projects | Reuse patterns |

*Designer-only items are necessary but not sufficient for vision.*

---

## 2. Declarative data binding

| ID | Priority | Requirement | Notes |
|----|----------|-------------|-------|
| B1 | [today] | `dataModel.fields[]` with types and defaults | Preview + init |
| B2 | [today] | Label `{{field}}` → generated format/apply | |
| B3 | [today] | Slider/bar/arc/knob `bindings.value` | |
| B4 | [today] | `ui_set_*` + `ui_bindings_apply()` on device | |
| B5 | P0 | Bind to **workspace C symbols** (globals, struct members) | Not only inline defaults |
| B6 | P0 | Inspector: pick symbol with validation (LSP/clangd) | See wiki/19 |
| B7 | P0 | **Transforms** (range map, format string, enum→resource) | RSSI bars, units |
| B8 | P1 | **Visibility binding** (`visible when property/state`) | Replace manual HIDDEN |
| B9 | P1 | **List repeaters** (template row × array/API) | WiFi scans, logs |
| B10 | P1 | Explicit **write** bindings (slider → property) | |
| B11 | P2 | Refresh policies: timer, on_event, manual | |

---

## 3. State management

| ID | Priority | Requirement | Notes |
|----|----------|-------------|-------|
| S1 | P0 | Named **application states** (enum or flags) in project | `connecting`, `fault` |
| S2 | P0 | Widget/page rules: show/hide/enable from state | Declarative |
| S3 | P1 | Derived properties (expressions without full scripting) | e.g. `temp_f = celsius_to_f(temp_c)` |
| S4 | P2 | Optional state machine editor | |

---

## 4. ViewModel generation

| ID | Priority | Requirement | Notes |
|----|----------|-------------|-------|
| VM1 | [today] | Per-field setters calling `ui_bindings_apply()` | |
| VM2 | P0 | Single **refresh entry** (`ui_refresh_all` / dirty flags) | |
| VM3 | P0 | Generated code only touches bound widgets | No full-tree walk |
| VM4 | P1 | Per-page refresh scopes | Performance |
| VM5 | P1 | Generated action stubs from event table | |

---

## 5. Event system

| ID | Priority | Requirement | Notes |
|----|----------|-------------|-------|
| E1 | [today] | Widget events: click, value_changed | |
| E2 | [today] | Actions: navigate, set_value, set_text, set_theme | |
| E3 | P0 | **Named actions** reusable across widgets | `action: "save_settings"` |
| E4 | P1 | **Timer events** in project (periodic refresh) | |
| E5 | P1 | **External events** hook (firmware calls `ui_on_mqtt(...)`) | |
| E6 | P2 | Action parameters and guards (if state == X) | |

---

## 6. Navigation framework

| ID | Priority | Requirement | Notes |
|----|----------|-------------|-------|
| N1 | [today] | Page navigate with LVGL transitions | |
| N2 | [today] | Page swipe flows | |
| N3 | P0 | **Navigation stack** (push/pop/replace) | Back button |
| N4 | P1 | Pass parameters to next screen (context struct) | |
| N5 | P2 | Tab/bar navigation patterns | |

---

## 7. Settings framework

| ID | Priority | Requirement | Notes |
|----|----------|-------------|-------|
| ST1 | P1 | `settings` schema in `.embf` (keys, types, defaults) | |
| ST2 | P1 | Bind settings screen widgets to schema | |
| ST3 | P1 | **Persistence adapter** interface in generated code | NVS, EEPROM, file |
| ST4 | P2 | Settings validation and migration | |

---

## 8. Device communication bindings

| ID | Priority | Requirement | Notes |
|----|----------|-------------|-------|
| C1 | P1 | Declarative **comm sources** (MQTT topic, BLE char, Modbus reg) | |
| C2 | P1 | Incoming message → update property → UI refresh | |
| C3 | P2 | Outgoing: action publishes to topic | |
| C4 | P2 | Protocol-specific assistants in IDE | |

*Firmware still owns stacks; EmbeddedFlow wires data plane to properties.*

---

## 9. Code generation

| ID | Priority | Requirement | Notes |
|----|----------|-------------|-------|
| G1 | [today] | LVGL 8/9 C, per-page files, `ui_bindings` | |
| G2 | [today] | `LV_SCR_LOAD_ANIM_*`, screen load order | |
| G3 | P0 | Stable **public generated API** (`ui_init`, setters, refresh) | Documented |
| G4 | P1 | CMake/IDF export templates | |
| G5 | P1 | Diff-friendly codegen (minimal churn) | |

---

## 10. Live preview

| ID | Priority | Requirement | Notes |
|----|----------|-------------|-------|
| P1 | [today] | WASM LVGL preview | |
| P2 | [today] | Run mode: navigation, buttons | |
| P3 | P0 | Preview honors **same binding rules** as firmware | |
| P4 | P1 | Mock profiles (sensor scenarios) | |
| P5 | P1 | Edit property mocks in inspector → live update | |

---

## 11. Runtime synchronization (on device)

| ID | Priority | Requirement | Notes |
|----|----------|-------------|-------|
| R1 | P0 | No dynamic allocation in default refresh path | |
| R2 | P1 | Configurable refresh rate / coalesce | |
| R3 | P2 | Optional LVGL observer integration (v9) | |

---

## Success metrics (framework release)

- Sample app (e.g. station + settings) updates **only via properties** — no hand-written label updates in app code.
- New screen added by editing `.embf` + model fields only.
- Third-party example: WiFi list from C array via repeater binding.
- Documentation reads as **framework**, not “EEZ-like designer”.
