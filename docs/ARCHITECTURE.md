# EmbeddedFlow — Architecture

**Status:** Locked decisions (confirmed 2026-06-04)  
**Companion:** [VISION.md](./VISION.md), [REQUIREMENTS.md](./REQUIREMENTS.md)

---

## System identity

EmbeddedFlow is a **compile-time embedded UI dataflow compiler**, not a UI generator and not a runtime framework.

The output is always **pure C** with **LVGL as the only dependency**. No interpreter, no runtime engine, no dynamic dispatch exists on the device.

---

## Compiler pipeline

```
.embf (single IR file)
        │
        ▼
EmbeddedFlow Compiler (VS Code extension)
        │
        ├── clangd instance (Phase 2+)
        │     owned by EmbeddedFlow, headless
        │     pointed at firmware project via compile_commands.json
        │     invisible to developer
        │
        ├── IR validation
        │     schema check, binding direction analysis,
        │     symbol type resolution, action sequence validation
        │
        └── Codegen
              │
              ├── ui_page_*.c / .h       LVGL object trees
              ├── ui_styles.c / .h       named styles
              ├── ui_bindings.c / .h     push setters + pull apply
              ├── ui_fsm.c / .h          FSM enum + transitions + derived state
              ├── ui_actions.c / .h      flattened action functions
              ├── ui_nav.c / .h          static navigation calls
              ├── embf_app.c / .h        orchestration glue
              ├── embf_protocol.h        transport interface (Phase 4)
              ├── ui_strings_ids.h       string key X-Macro list
              ├── ui_strings_<locale>.def per-locale X(UI_STR_*, "…") list
              ├── ui_strings.h / .c      enum + ui_get_string() table (X-Macro)
              └── ui_page_*.c            labels use ui_get_string(UI_STR_*)
```

---

## IR file structure

Single `.embf` file through Phase 1–3. Logical top-level sections; no physical split until scale forces it.

```json
{
  "version": "1.x",
  "project": {
    "stringsPath": "i18n/strings.res"
  },
  "ui": {
    "pages": [],
    "styles": []
  },
  "model": {
    "properties": [],
    "derived": []
  },
  "state": {
    "fsm": []
  },
  "actions": [],
  "protocol": []
}
```

**String resources (`.res` file):** Translations live in `i18n/strings.res` (or `project.stringsPath`; **`.res` extension required**). The extension provides a **table editor** (keys × locales). Codegen emits **X-Macro** artifacts (`ui_strings_ids.h`, `ui_strings_<locale>.def`, `ui_strings.c`) so enum ids and `const char *` tables stay in sync; widgets call `ui_get_string(UI_STR_<key>)`. No `.res` parser on device. See [REQUIREMENTS.md](./REQUIREMENTS.md) § Internationalization.

**Why single-file:** IR must be atomic. Cross-file dependency resolution, version mismatch, and fragmented semantic graphs are rejected. One IR → one deterministic compiled artifact.

**When splitting is valid:** Only when IR size (`>10k lines` / `>500 bindings`) or team-scale collaboration forces it. Physical split always merges into one IR at compile time.

---

## Data model

### Properties (`model.properties`)

Phase 1: pure IR metadata only. Name, type, default, optional min/max, direction hint.  
Phase 2+: backed by firmware C symbols discovered via clangd.

```json
{
  "id": "temp_c",
  "type": "float",
  "default": 25.0,
  "min": -40,
  "max": 125,
  "direction": "push"
}
```

Properties are **never** generated as C variables in Phase 1. They exist only to drive preview mocks and prepare binding IR.

### Derived state (`model.derived`)

Pure computed expressions over properties. No storage, no transitions. Generated as inline or cached C functions.

```json
{
  "id": "is_alarm",
  "expression": "temp_c > 80.0"
}
```

Generated C:
```c
static inline bool is_alarm(float temp_c) { return temp_c > 80.0f; }
// or cached:
static bool is_alarm;
void update_derived_states(void) { is_alarm = (app_data.temp_c > 80.0f); }
```

---

## State machine (`state.fsm`)

Named application modes. Enum + transition functions in generated C. No state engine.

```json
{
  "states": ["idle", "connecting", "connected", "alarm"],
  "initial": "idle"
}
```

Generated C:
```c
typedef enum { STATE_IDLE, STATE_CONNECTING, STATE_CONNECTED, STATE_ALARM } app_state_t;
static app_state_t app_state = STATE_IDLE;

void set_state(app_state_t s) {
    app_state = s;
    switch (app_state) { /* dispatch ui_show_* calls */ }
}
```

**FSM vs Derived — strict separation:**
- FSM controls *what mode the system is in*
- Derived state controls *how UI behaves inside that mode*
- These two layers must never be merged

---

## Binding (code mapping)

Binding direction is a **compiler concern**, not a developer choice. The IR `direction` field determines generated strategy.

### Push (firmware-driven)
```json
{ "source": "app_data.temp_c", "target": "lbl_temp.text", "direction": "push" }
```
```c
void ui_set_temp_c(float value) {
    char buf[16];
    snprintf(buf, sizeof(buf), "%.1f", value);
    lv_label_set_text(ui_lbl_temp, buf);
}
```
Firmware calls `ui_set_temp_c(sensor.temp)`. No extern, no polling.

### Pull (state-driven refresh)
```json
{ "source": "app_data.temp_c", "target": "lbl_temp.text", "direction": "pull" }
```
```c
extern float app_data_temp_c;
void ui_bindings_apply(void) {
    char buf[16];
    snprintf(buf, sizeof(buf), "%.1f", app_data_temp_c);
    lv_label_set_text(ui_lbl_temp, buf);
}
```
Called from `embf_app_tick()` on each refresh cycle.

---

## Actions (`actions`)

Actions are typed IR instruction nodes compiled to flat C functions. Sequential composition is allowed in IR; the compiler flattens it to one function per trigger.

```json
{
  "trigger": "button_save.clicked",
  "sequence": [
    { "type": "set_property", "target": "settings.brightness", "value": "slider_brightness.value" },
    { "type": "call_function", "name": "nvs_save_settings" },
    { "type": "navigate", "target": "page_home" }
  ]
}
```

Generated C:
```c
void action_button_save_clicked(void) {
    settings.brightness = lv_slider_get_value(ui_slider_brightness);
    nvs_save_settings();
    ui_navigate_to_page_home();
}
```

**Valid action types:** `navigate`, `set_property`, `set_state`, `call_function`, `publish` (Phase 4 abstract only)  
**Valid triggers:** widget events, FSM entry/exit, timer (`every`, `after`), external events (Phase 4)  
**Forbidden:** runtime interpreter, dynamic dispatch, scripting, reflection

---

## Navigation

Navigation graph is an **integrated overlay** on the page designer — same IR nodes (pages), second visual layer showing edges (transitions). Not a separate canvas.

Phase 1–3 generates static LVGL calls only:
```c
void ui_navigate_to_page_settings(void) {
    lv_scr_load_anim(ui_page_settings, LV_SCR_LOAD_ANIM_MOVE_LEFT, 300, 0, false);
}
```

No navigation stack, no router, no history in Phase 1–3. Navigation stack is a Phase 3+ concern.

---

## Protocol bindings (`protocol`)

EmbeddedFlow owns the **abstraction contract only** — never a protocol stack.

Generated interface:
```c
// embf_protocol.h — generated
typedef void (*embf_publish_fn)(const char *topic, const char *payload);
typedef void (*embf_subscribe_fn)(const char *topic);

extern embf_publish_fn embf_publish;
extern embf_subscribe_fn embf_subscribe;
```

Firmware implements an adapter once per platform and wires it:
```c
embf_publish = my_mqtt_publish;   // developer-provided
```

Optional platform adapters (ESP-IDF MQTT, Zephyr BLE, etc.) ship as separate sidecar files — not part of core codegen.

---

## Generated orchestration layer (`embf_app`)

Thin deterministic wiring layer. Guarantees initialization order, update sequencing, and lifecycle consistency. Fully generated, zero runtime logic.

```c
// embf_app.c — generated
void embf_app_init(void) {
    ui_init();
    ui_styles_init();
    state_init();
    ui_bindings_init();
    actions_init();
}

void embf_app_tick(void) {
    update_derived_states();
    ui_bindings_apply();
    process_timers();
}

void embf_dispatch_event(ui_event_t *e) {
    switch (e->id) { /* generated action calls */ }
}
```

---

## Symbol discovery (Phase 2)

EmbeddedFlow spawns a **dedicated clangd instance** per firmware project. The firmware project path is configured in the `.embf` project section. clangd is treated as a headless analysis backend:

```
.embf project path
    └── firmware_root / compile_commands.json
              ↓
        clangd (owned by EmbeddedFlow)
              ↓
        LSP symbol queries (globals, struct members, functions)
              ↓
        IR Symbol Graph → binding picker + type validation
```

Binding UX: **tree picker** (primary, for discovery) + **IntelliSense autocomplete** (advanced, for speed). Both resolve to the same IR binding object.

---

## Decision filter (mandatory for all PRs)

1. **Compiler or designer?** Does it only help draw screens?
2. **Declarative?** Does it reduce hand-written `lv_*_set_*` in firmware?
3. **Compile-time?** Is it resolved at codegen, not at runtime?
4. **Embedded-fit?** Flash/RAM predictable? No heap, no interpreter?
5. **Incremental?** Can adopters use one screen without migrating entire app?

Reject or defer items that fail (3) or (4) regardless of other merits.

---

## Hard constraints — never violated

| Constraint | Rule |
|-----------|------|
| Output language | Pure C only |
| External dependency | LVGL only in generated code |
| Interpreter | None — ever |
| Runtime dynamic dispatch | None |
| IR compilation | One IR → one deterministic artifact |
| clangd | Headless tool, invisible to developer |
| Protocol stacks | Owned by firmware, never by EmbeddedFlow |

---

## Non-goals

- Replacing LVGL with a custom renderer
- General scripting runtime on MCU (Lua, JS, Python)
- Full visual logic editor (Blockly-style)
- Auto-generating driver stacks (WiFi, MQTT clients, BLE profiles)
- GDB / live RAM attach in preview
- Navigation runtime stack in Phase 1–2
