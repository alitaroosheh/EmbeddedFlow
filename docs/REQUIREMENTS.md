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
- [ ] **V4** Navigation Graph overlay on page designer — same IR, edges = navigation transitions
- [ ] **V5** Flex/grid layout authoring with codegen

### Navigation Graph

- [x] **N1** Page navigate with LVGL transitions (static calls)
- [x] **N2** Page swipe flows
- [ ] **N3** Visual overlay on designer: nodes = pages, edges = transitions with animation + trigger metadata
- [ ] **N4** Navigation edges stored in IR — compiler generates `ui_navigate_to_*()` static functions
- [ ] **N5** Navigation stack (push/pop/back) *(Phase 3)*

Navigation graph generates **only static LVGL calls** in Phase 1. No router, no stack.

### Property System *(IR metadata only in Phase 1)*

- [ ] **PR1** `model.properties[]` in `.embf`: id, type, default, min, max, direction hint
- [ ] **PR2** Properties used for preview mocks only — zero codegen in Phase 1
- [ ] **PR3** Inspector: add/edit/delete properties
- [ ] **PR4** Preview substitutes property defaults into bound widgets

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
