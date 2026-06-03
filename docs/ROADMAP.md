# EmbeddedFlow — Product Roadmap

**Status:** Locked (confirmed 2026-06-04)  
**Companion:** [VISION.md](./VISION.md), [REQUIREMENTS.md](./REQUIREMENTS.md)

---

## Phase 0 — Foundation (shipped / v1.1.x)

**Identity:** Credible LVGL screen designer + binding prototype

| Deliverable | Status |
|-------------|--------|
| Visual editor, inspector, preview (WASM) | Done |
| Multi-page, navigation (static calls), swipe, animations | Done |
| Codegen LVGL 8/9 (`ui_*.c`, `ui_bindings.c` scaffold) | Done |
| `dataModel` + `{{field}}` + numeric widget bindings | Done |
| Station + settings page sample | Done |
| VS Code extension (v1.1.1 VSIX, GPL-3.0-or-later) | Done |

**Honest release description:** LVGL UI designer with early data binding — foundation for the EmbeddedFlow compiler.

---

## Phase 1 — Navigation Graph + Property System

**Identity:** Complete visual design layer with semantic data foundation

**Exit criteria:**
- Navigation connections visible as edges in the designer overlay
- Any `.embf` project can declare typed properties used for preview mocks
- No hand-written navigation wiring for standard page transitions

| Deliverable | Details |
|-------------|---------|
| **Navigation Graph overlay** | Integrated second visual layer on designer — nodes = pages, edges = transitions with animation + trigger metadata |
| Navigation codegen | `ui_navigate_to_*()` static functions; no runtime stack |
| **Property System in IR** | `model.properties[]`: id, type, default, min/max, direction hint |
| Properties in inspector | Add/edit/delete properties, set mock defaults |
| Preview mocks from properties | Preview substitutes defaults into bound widgets |
| `.embf` schema: new sections | Add `model`, `state`, `actions`, `protocol` as stub top-level keys |

---

## Phase 2 — Symbol Discovery + Binding

**Identity:** Model ↔ View without hand-written `lv_*_set_*` for common cases

**Exit criteria:**
- Developer binds a label to `app_data.temp_c` from a picker — no manual code
- Push binding generates `ui_set_temp_c()` called from firmware
- Pull binding generates extern + `ui_bindings_apply()` called from tick loop
- Type mismatch detected at bind time, not at compile time

| Deliverable | Details |
|-------------|---------|
| **clangd integration** | EmbeddedFlow spawns dedicated instance per firmware project |
| Symbol tree picker | Click widget → browse discovered symbols in tree |
| IntelliSense autocomplete | Type symbol path with completion + type validation |
| Binding direction analysis | IR `direction` field → compiler selects push or pull strategy |
| `ui_set_*` codegen (push) | Setter functions per bound property |
| `ui_bindings_apply` codegen (pull) | Extern + refresh per bound property |
| Transforms | Range map, format string, enum→resource |
| Preview mocks update | Preview uses property defaults when no clangd available |

---

## Phase 3 — State + Actions + Generated Framework

**Identity:** Application logic declared in `.embf`, compiled to deterministic C

**Exit criteria:**
- App states (`idle`, `alarm`, etc.) declared in designer, UI reacts without manual `lv_obj_add_flag`
- Action sequences declared in IR, compiled to single C functions
- `embf_app_init()` + `embf_app_tick()` replace all manual wiring in `main.c`

| Deliverable | Details |
|-------------|---------|
| **FSM in IR** | `state.fsm[]`: named states, initial, transitions |
| FSM codegen | `app_state_t` enum + `set_state()` dispatch function |
| **Derived state** | `model.derived[]`: expression → inline or cached C function |
| Visibility rules | Widget show/hide driven by FSM or derived state |
| **Actions system** | `actions[]`: trigger + typed sequence (navigate, set_property, set_state, call_function) |
| Timer triggers | `every(ms)` and `after(ms)` triggers in actions |
| FSM entry/exit triggers | Actions fire on state transitions |
| **Generated Framework** | `embf_app.c/h`: `embf_app_init`, `embf_app_tick`, `embf_dispatch_event` |
| Navigation stack | push/pop/back generated as static call sequences |

---

## Phase 4 — Protocol Bindings

**Identity:** Protocol data flows into properties; UI updates automatically

**Exit criteria:**
- MQTT topic declared in `.embf`, value arrives at `lbl_temp` without firmware touching LVGL
- Adapter wiring is one-time per platform (`embf_publish = my_fn`)

| Deliverable | Details |
|-------------|---------|
| **Protocol interface** | `embf_protocol.h`: publish/subscribe function pointer typedefs |
| `protocol[]` IR section | Topic → property bindings, subscribe-on-init |
| Protocol action | `publish` action type wired to `embf_publish` |
| Adapter pattern docs | How to implement adapter for any stack |
| Optional ESP-IDF MQTT adapter | Sidecar file, not core codegen |
| Optional Zephyr / Modbus adapters | Same pattern, separate distribution |

---

## Version strategy

| Version | Phase | Description |
|---------|-------|-------------|
| v1.1.x | 0 | Foundation release (current) |
| v1.2 | 1 | Navigation Graph + Property System |
| v1.3 | 2 | Symbol Discovery + Binding |
| v2.0 | 3 | State + Actions + Generated Framework |
| v2.x | 4 | Protocol Bindings |

---

## Decision log

| Date | Decision |
|------|----------|
| 2026-06-04 | System identity: compile-time dataflow compiler, not runtime framework |
| 2026-06-04 | IR = single `.embf` file through Phase 1–3; physical split only when scale forces it |
| 2026-06-04 | Property System = IR metadata only in Phase 1; no codegen until Phase 2 |
| 2026-06-04 | Navigation Graph = integrated overlay on designer; static calls only in Phase 1–2 |
| 2026-06-04 | Symbol discovery = EmbeddedFlow-owned clangd instance; headless, not user-IDE-dependent |
| 2026-06-04 | Binding direction = compiler decision from IR field; push → setter, pull → extern+apply |
| 2026-06-04 | State = two strict layers: FSM (modes) + Derived (conditions); never merged |
| 2026-06-04 | Actions = typed IR nodes; sequential composition flattened to one C function at compile time |
| 2026-06-04 | Generated Framework = thin orchestration glue (`embf_app_init/tick/dispatch`); zero runtime logic |
| 2026-06-04 | Protocol = EmbeddedFlow owns interface contract only; adapters are optional sidecars |
| 2026-06-04 | Output = pure C; LVGL is the only dependency in generated code; no interpreter ever |
