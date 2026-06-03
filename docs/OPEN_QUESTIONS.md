# EmbeddedFlow — Open Planning Questions

**Status:** Awaiting product decisions before release positioning  
**Purpose:** Capture decisions needed to align roadmap, README, and v1.x release messaging.

Please answer inline (issue, doc PR, or conversation). Answers should be recorded here with date and decision.

---

## Product & positioning

### Q1 — First public release message

What should the **Marketplace / GitHub** headline be?

- **A)** “LVGL UI designer” (accurate today, weaker vision)
- **B)** “LVGL UI designer — foundation for an embedded app framework” (honest bridge)
- **C)** “Embedded application framework (beta)” (aspirational — risk overclaim)

**Recommendation:** B until Phase 1 exit criteria met.

| Answer | |
|--------|---|
| Decision | |
| Date | |

---

### Q2 — Target platforms (v1)

Which SDKs must Phase 1 **officially** support?

- [ ] ESP-IDF (ESP32)
- [ ] Zephyr
- [ ] STM32Cube + bare metal
- [ ] Arduino (wrapper)
- [ ] Platform-agnostic C only (no official BSP)

| Answer | |
|--------|---|
| Decision | |
| Date | |

---

### Q3 — Language

Generated firmware code:

- **C only** (current)
- **C++** optional (classes for ViewModel?)
- **Both** with same `.embf` project

| Answer | |
|--------|---|
| Decision | |
| Date | |

---

## Architecture

### Q4 — Runtime library

Is an on-device **`libembeddedflow`** (navigation stack, property store) acceptable for flash budget?

- **Codegen-only** as long as possible
- **Thin runtime** required from Phase X
- **Runtime size budget:** ___ KB flash, ___ KB RAM

| Answer | |
|--------|---|
| Decision | |
| Date | |

---

### Q5 — Symbol discovery

Binding to firmware symbols via:

- **clangd / C++ extension only** (no parser in EmbeddedFlow)
- **EmbeddedFlow bundles lightweight indexer**
- **Manual entry** of symbol paths (validated at compile time only)

Wiki/19 assumes clangd. Confirm?

| Answer | |
|--------|---|
| Decision | |
| Date | |

---

### Q6 — Two-way binding default

For sliders, toggles, text fields:

- **Read-only** Model → UI first; writes via explicit actions only
- **Two-way** by default where widget allows

| Answer | |
|--------|---|
| Decision | |
| Date | |

---

## Communication & settings

### Q7 — Protocol priority

Order for Phase 4 implementation:

1. ___
2. ___
3. ___

Candidates: MQTT, BLE GATT, Modbus, CAN, HTTP/REST, custom UART.

| Answer | |
|--------|---|
| Decision | |
| Date | |

---

### Q8 — Settings persistence

Settings framework should:

- **Generate abstract API** only (`settings_load/save` — user implements)
- **Ship NVS adapter** for ESP-IDF first
- **Multiple adapters** in codegen (pick at project creation)

| Answer | |
|--------|---|
| Decision | |
| Date | |

---

## Business & legal

### Q9 — License strategy

Project is **GPL-3.0-or-later**.

- **GPL only** (community + copyleft products)
- **Dual license** (commercial OEM license later)
- **Library exception** for generated `ui_*.c` (clarify generated code license)

| Answer | |
|--------|---|
| Decision | |
| Date | |

---

### Q10 — Relationship to EEZ Studio / SquareLine / etc.

Public positioning:

- **Complementary** (import/export later?)
- **Replacement** (migration story)
- **No comparison** in marketing

| Answer | |
|--------|---|
| Decision | |
| Date | |

---

## Release timing

### Q11 — Block v1.1 Marketplace on Phase 1?

- **Ship now** — designer value, vision in docs
- **Delay** until symbol bindings land
- **Ship now as “early access”** with roadmap on README

| Answer | |
|--------|---|
| Decision | |
| Date | |

---

### Q12 — Reference application

Which demo proves the framework story?

- [ ] Temperature/humidity station (current)
- [ ] WiFi configuration HMI (lists + settings)
- [ ] Industrial dashboard (Modbus mock)
- [ ] New dedicated `framework_demo.embf`

| Answer | |
|--------|---|
| Decision | |
| Date | |

---

## Technical constraints

### Q13 — LVGL version policy

- Support **8.x and 9.x** indefinitely (current)
- **9.x only** from v2.0
- **LTS matrix** (which 9.x minors)

| Answer | |
|--------|---|
| Decision | |
| Date | |

---

### Q14 — `.embf` vs sidecar files

As framework grows, split project files?

- **Single `.embf`** (current)
- **`.embf` + `app.model.json` + `app.bindings.json`**
- **`.embf` + generated-only merge at build**

| Answer | |
|--------|---|
| Decision | |
| Date | |

---

## How to answer

Copy the table rows or reply with `Q1: B, Q2: ESP-IDF + bare metal, ...`. Decisions will be merged into this file and reflected in [ROADMAP.md](./ROADMAP.md) and README.
