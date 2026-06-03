# EmbeddedFlow — Vision

**Status:** Product direction (pre-release planning)  
**Audience:** Maintainers, contributors, and partners evaluating scope before public release.

---

## Positioning

EmbeddedFlow is **not** intended to be another LVGL UI designer.

The long-term vision is to become a **complete application framework for embedded graphical devices** — comparable in role to what **Flutter**, **React**, **WPF**, and **Qt** provide for desktop and mobile, but engineered for **MCU constraints**, **LVGL**, and **firmware workflows**.

Today, most embedded UI tools focus on:

- Drawing screens
- Placing widgets
- Generating LVGL object trees

That solves the **visual design** problem. It leaves developers with large amounts of manual work for:

- State management
- Data synchronization between UI and firmware
- Event handling beyond simple navigation
- Device settings and persistence
- Communication (MQTT, BLE, Modbus, CAN, etc.)
- Business logic integration

**EmbeddedFlow aims to close this gap.**

---

## North star

> **EmbeddedFlow should become the “Flutter for embedded systems” — not another screen designer.**

Every architectural decision should be evaluated with:

> **Does this move EmbeddedFlow closer to a complete embedded application framework, or does it only improve the screen designer?**

| Priority | Focus |
|----------|--------|
| **Strategic** | Reducing application complexity, state-management complexity, and UI–business-logic coupling |
| **Secondary** | Features that only improve drawing screens |

---

## Paradigm shift

Move embedded UI development from **imperative widget manipulation** to a **declarative, data-driven architecture**.

Developers describe **what the UI represents**, not **how every widget is updated**.

### Today (imperative — what we replace)

```c
/* Firmware scattered across modules */
void on_mqtt_message(...) {
    sensor.temp_c = parse_temp(payload);
    lv_label_set_text(lbl_temp, buf);
    lv_bar_set_value(bar_hum, sensor.humidity, LV_ANIM_OFF);
    if (settings.dark_mode)
        lv_obj_add_flag(panel_adv, LV_OBJ_FLAG_HIDDEN);
    ...
}
```

### Target (declarative — what EmbeddedFlow owns)

- **Properties** — `temp_c`, `humidity`, `wifi_connected`, `device_name`
- **States** — `connecting`, `alarm`, `settings.dirty`
- **Bindings** — widgets bound to properties with optional transforms
- **Actions** — events trigger named actions (navigate, set property, persist settings, publish MQTT)
- **Codegen + optional runtime** — framework applies changes; firmware updates the model only

---

## Target developer experience

1. **Design** screens visually (pages, widgets, styles, navigation).
2. **Define** application properties, states, and settings schemas.
3. **Bind** widgets to data sources (globals, struct fields, driver APIs, bus topics).
4. **Connect** actions to events (input, timers, protocol messages).
5. **Generate and run** — preview in VS Code; build firmware without hand-written widget sync for common cases.

**Success criterion:** For typical HMI use cases (gauges, labels, lists, settings screens, status visibility), **no manual per-widget LVGL update code** is required.

---

## Framework pillars (target architecture)

| Pillar | Role |
|--------|------|
| **Visual UI designer** | `.embf` project: pages, widgets, styles, layouts — the **View** |
| **Declarative data binding** | Model properties ↔ widget properties (read/write policies) |
| **State management** | Application state machines, derived state, visibility rules |
| **ViewModel generation** | Generated glue that applies bindings (today: partial `ui_bindings.c`) |
| **Event system** | Unified events: UI, timer, protocol, hardware — not only `clicked` |
| **Navigation framework** | Stack, tabs, modals, deep links — beyond one-off `navigate` |
| **Settings framework** | Typed settings, defaults, persistence hooks, settings UI binding |
| **Device communication bindings** | Map MQTT/BLE/Modbus/CAN (etc.) into properties and actions |
| **Code generation** | LVGL 8/9 C output aligned with project and target SDK |
| **Live preview** | WASM preview reflects bindings, mocks, and navigation |
| **Runtime synchronization** | On device: efficient refresh policies without full desktop-style overhead |

See [ARCHITECTURE.md](./ARCHITECTURE.md) and [REQUIREMENTS.md](./REQUIREMENTS.md) for detail.

---

## Relationship to LVGL

LVGL is the **primary rendering engine** for v1. The framework layer sits **above** LVGL:

- **View** → LVGL widgets (generated `ui_*.c`)
- **ViewModel** → generated update/refresh logic
- **Model** → developer-owned C (structs, drivers, protocols)

A future abstraction over multiple renderers is **out of scope** until the declarative stack is proven on LVGL.

---

## What v1.1.x is (honest scope)

The current VSIX is a **strong screen designer** with **early binding primitives**:

- Visual editor, preview, codegen, navigation, animations
- `dataModel.fields[]`, `{{field}}` labels, numeric widget bindings
- Partial `ui_bindings.c` / setters

It is a **foundation release**, not the full framework. Marketing and roadmap should not overclaim “complete Flutter for MCU” until pillars beyond the designer are delivered in sequence.

See [ROADMAP.md](./ROADMAP.md).

---

## Related documents

| Document | Purpose |
|----------|---------|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Layers, data flow, decision filter |
| [REQUIREMENTS.md](./REQUIREMENTS.md) | Functional requirements by pillar |
| [ROADMAP.md](./ROADMAP.md) | Phased delivery |
| [OPEN_QUESTIONS.md](./OPEN_QUESTIONS.md) | Planning decisions still open |
| [../wiki/19-code-binding-and-data-model.md](../wiki/19-code-binding-and-data-model.md) | Detailed binding PRD (Phase 2+) |
