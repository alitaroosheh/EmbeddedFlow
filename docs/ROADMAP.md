# EmbeddedFlow — Product Roadmap

**Status:** Planning (pre-release)  
**Companion:** [VISION.md](./VISION.md), [REQUIREMENTS.md](./REQUIREMENTS.md)

Phases are ordered by **framework value**, not only by designer polish.

---

## Phase 0 — Foundation (shipped / v1.1.x)

**Theme:** Credible LVGL screen designer + binding prototype

| Deliverable | Status |
|-------------|--------|
| Visual editor, inspector, preview (WASM) | Done |
| Multi-page, navigation, swipe, animations | Done |
| Codegen LVGL 8/9 (`ui_*.c`, bindings scaffold) | Done |
| `dataModel` + `{{field}}` + numeric bindings | Done |
| Sample projects (station, settings page) | Done |
| VS Code extension packaging | Done |

**Honest label for release notes:** *“LVGL UI designer with early data binding — foundation for the EmbeddedFlow framework.”*

**Do not claim:** full application framework yet.

---

## Phase 1 — Binding that firmware trusts (P0)

**Theme:** Model ↔ View without hand-written `lv_*_set_*`

| Deliverable | Outcome |
|-------------|---------|
| Symbol-backed properties (clangd/LSP) | Pick real C globals/structs |
| Binding validation at design time | Catch errors before flash |
| Transforms (map, format, enum) | RSSI, units, icons |
| Stable `ui_refresh` / dirty model | One entry to update UI |
| Preview mocks from scenario files | Test without hardware |
| Documentation + migration guide | From imperative to declarative |

**Exit criteria:** Station (or similar) sample driven by **firmware updating properties only**; UI follows automatically.

---

## Phase 2 — State, visibility, lists (P0–P1)

**Theme:** Application state drives UI

| Deliverable | Outcome |
|-------------|---------|
| `states` + visibility rules | Hide/show without C flags in callbacks |
| List repeaters | WiFi / log / menu lists |
| Named actions | Reuse behavior across widgets |
| Navigation stack | push/pop/back |

---

## Phase 3 — Settings & persistence (P1)

**Theme:** Device settings as first-class framework feature

| Deliverable | Outcome |
|-------------|---------|
| Settings schema in `.embf` | Single source of truth |
| Generated load/save adapters | NVS/EEPROM hooks |
| Settings screens bind automatically | Designer + runtime |

---

## Phase 4 — Communication bindings (P1–P2)

**Theme:** Bus/protocol → properties → UI

| Deliverable | Outcome |
|-------------|---------|
| MQTT topic → property (declarative) | Telemetry-driven UI |
| BLE / Modbus templates | Same pattern |
| Actions publish outbound | Commands from UI |

---

## Phase 5 — Framework runtime & polish (P2)

**Theme:** Thin shared runtime where codegen is not enough

| Deliverable | Outcome |
|-------------|---------|
| Optional `libembeddedflow` | Navigation, refresh scheduler |
| Expression/derived properties (limited) | Without full scripting |
| State machine tooling | Complex HMIs |

---

## Release strategy (recommended)

| Release | Audience message |
|---------|------------------|
| **v1.1.x** (now) | Designer + early bindings; GPL; foundation |
| **v1.2** | Symbol bindings + transforms + refresh API |
| **v1.3** | States, visibility, repeaters, nav stack |
| **v2.0** | “Framework beta” — settings + comm bindings |

Adjust version numbers after [OPEN_QUESTIONS.md](./OPEN_QUESTIONS.md) decisions.

---

## What we defer (explicitly)

- Competing with Figma-like tools on pure design
- Non-LVGL renderers
- On-device scripting languages
- Full WYSIWYG logic/block programming

---

## Decision log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-05 | Vision = framework, not designer-only | User direction pre-release |
| 2026-05 | LVGL remains v1 backend | Pragmatic delivery |
| 2026-05 | Codegen-first, thin runtime later | MCU constraints |
