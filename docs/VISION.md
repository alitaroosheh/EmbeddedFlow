# EmbeddedFlow — Vision

**Status:** Locked (confirmed 2026-06-04)  
**Companion:** [ARCHITECTURE.md](./ARCHITECTURE.md), [REQUIREMENTS.md](./REQUIREMENTS.md), [ROADMAP.md](./ROADMAP.md)

---

## System identity

> **EmbeddedFlow is a compile-time embedded UI dataflow compiler.**

It is not another LVGL screen designer.  
It is not a runtime framework.  
It is not "Flutter for embedded" — there is no rendering engine, no widget reconciler, no virtual tree.

It is a **compiler**: takes a declarative `.embf` IR as input, produces deterministic pure C as output, with LVGL as the only dependency.

---

## The problem it solves

Every modern UI platform (React, Flutter, WPF, Qt) separates **what the UI represents** from **how it updates**. Developers declare bindings and state; the platform handles synchronization.

Embedded UI has no equivalent. LVGL developers write:

```c
void on_sensor_update(float temp, float hum) {
    char buf[16];
    snprintf(buf, sizeof(buf), "%.1f °C", temp);
    lv_label_set_text(lbl_temp, buf);
    lv_bar_set_value(bar_hum, (int)hum, LV_ANIM_OFF);
    if (temp > 80.0f)
        lv_obj_clear_flag(panel_alarm, LV_OBJ_FLAG_HIDDEN);
    else
        lv_obj_add_flag(panel_alarm, LV_OBJ_FLAG_HIDDEN);
    // ... 20 more lines
}
```

This code is:
- **Manually written** for every sensor, every widget, every screen
- **Tightly coupled** — firmware knows widget IDs
- **Fragile** — changing a widget name breaks firmware
- **Unscalable** — every new property requires new glue code

EmbeddedFlow eliminates this class of code.

---

## The compiler model

### Input — `.embf` IR (single file)

Declares:
- Pages and widgets (View)
- Properties and derived conditions (Model metadata)
- Application states (FSM)
- Binding direction per property (push or pull)
- Action sequences per trigger
- Protocol binding declarations

### Output — deterministic pure C

```
ui_page_*.c          LVGL object trees
ui_styles.c          named styles
ui_bindings.c        push setters + pull apply functions
ui_fsm.c             FSM enum + transition + derived state functions
ui_actions.c         compiled action functions (one per trigger)
ui_nav.c             static navigation calls
embf_app.c           orchestration glue (init, tick, dispatch)
embf_protocol.h      transport interface (Phase 4)
```

All composition in the IR flattens at compile time. The MCU sees only plain functions and enums. No interpreter, no reflection, no dynamic dispatch.

---

## The target developer experience

**Before EmbeddedFlow (today):**

1. Draw UI manually with LVGL calls
2. Write update code for every widget
3. Wire events to callbacks by hand
4. Manage navigation manually
5. Debug state sync bugs

**With EmbeddedFlow (target):**

1. Design screens visually
2. Declare properties and states in the designer
3. Bind widgets to properties (picker + validation)
4. Declare action sequences for events
5. Run codegen — firmware calls `embf_app_init()` + `embf_app_tick()`

**For common HMI use cases, no manual per-widget LVGL update code is required.**

---

## Architectural boundaries (non-negotiable)

| Boundary | Rule |
|----------|------|
| Output | Pure C, LVGL only |
| Runtime | None — everything resolves at compile time |
| Protocol stacks | Owned by firmware; EmbeddedFlow defines interface contract only |
| Interpreter | Never — not Lua, not JS, not bytecode |
| Symbol discovery | clangd, owned by EmbeddedFlow, headless, not user-visible |
| IR file | Single `.embf` through Phase 1–3; split only when scale forces it |

---

## What v1.1.x is (honest scope)

The current VSIX is a **strong LVGL screen designer** with **early binding primitives**. It is a valid foundation release, not the complete compiler vision.

**Implemented:** Visual editor, preview, codegen, navigation, styles, animations, `dataModel` + `{{field}}` + numeric bindings.  
**Not yet implemented:** Symbol-backed properties, FSM, action system, generated framework, protocol interface.

---

## Phased delivery summary

| Phase | Identity |
|-------|---------|
| 0 (v1.1.x) | Screen designer + binding prototype (current) |
| 1 (v1.2) | Navigation Graph overlay + Property System in IR |
| 2 (v1.3) | Symbol Discovery + Binding (push/pull compiler) |
| 3 (v2.0) | State + Actions + Generated Framework |
| 4 (v2.x) | Protocol Bindings + Adapter ecosystem |

See [ROADMAP.md](./ROADMAP.md) for exit criteria per phase.

---

## Related documents

| Document | Purpose |
|----------|---------|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Compiler pipeline, data flow, all locked decisions |
| [REQUIREMENTS.md](./REQUIREMENTS.md) | Requirements by phase and pillar |
| [ROADMAP.md](./ROADMAP.md) | Phases, exit criteria, version strategy |
| [OPEN_QUESTIONS.md](./OPEN_QUESTIONS.md) | Remaining decisions |
| [../wiki/19-code-binding-and-data-model.md](../wiki/19-code-binding-and-data-model.md) | Detailed binding PRD |
