# 19 — Code Binding & Application Data Model

**Status:** Requirements (not implemented)  
**Target users:** Firmware engineers using LVGL who maintain UI in C today and lose structure, testability, and iteration speed.  
**Depends on:** [04 Visual Editor](./04-visual-editor.md), [15 Code Generation](./15-code-generation.md), [18 `.embf` Format](./18-embf-format.md), [17 VSCode Integration](./17-vscode-integration.md)

---

## 1. Problem statement

### 1.1 What embedded developers suffer today

On typical LVGL projects:

1. **The UI is the C code.** Widget trees, styles, and update logic are scattered across `ui_*.c`, event callbacks, and application modules. There is no single declarative “screen definition” that firmware and designers share.
2. **The application model is invisible.** WiFi scan results, battery percentage, sensor readings, and machine state live in structs and APIs elsewhere. Labels and lists are updated with hand-written `lv_label_set_text()` / `lv_obj_add_flag()` calls. The link between **data** and **widgets** exists only in the developer’s head.
3. **Change is expensive.** Renaming a field, adding a column to a list row, or changing how RSSI maps to signal bars requires hunting through C, recompiling, and flashing hardware to see the result.
4. **Web/mobile patterns do not transfer literally.** MVVM, data binding, and reactive UI are normal in SwiftUI, Flutter, and React. C has no reflection, no runtime template engine, and tight flash/RAM budgets—but teams still need the **same separation of concerns**.

### 1.2 What EmbeddedFlow already solves (baseline)

- **View (layout & chrome):** `.embf` JSON describes pages, widgets, styles, navigation flows.
- **View construction:** Codegen emits LVGL object trees; WASM preview renders the same structure.
- **Partial “ViewModel”:** Declarative `events` / `navigate` / page swipes—behavior without custom C for simple cases.

### 1.3 Gap this document defines

**Bind widgets to real application data and functions in the developer’s firmware codebase**, with:

- Workspace-aware symbol discovery (IntelliSense-quality, not guesswork).
- Declarative bindings stored in `.embf` (or a sidecar file merged at build time).
- Generated **glue C** (the EmbeddedFlow ViewModel layer) that developers do not write by hand.
- Preview-time **mock data** so lists, signal bars, and battery icons are testable without hardware.

This is intentionally **niche and embedded-realistic**: no pretend JavaScript engine on the MCU; bindings compile to straight C calls and, where appropriate, LVGL 9 **observer** APIs.

---

## 2. Goals and non-goals

### 2.1 Goals

| ID | Goal |
|----|------|
| G1 | **Separation:** Application data (Model) stays in firmware modules; UI layout (View) stays in `.embf`; bindings + update logic (ViewModel) are generated. |
| G2 | **Discoverability:** Pick functions, globals, struct types, and members from the **actual workspace C project** (same symbols the developer sees in IntelliSense). |
| G3 | **Type-safe binding:** Invalid member names, type mismatches, and impossible widget targets are caught at **design time** in the extension, not only at firmware compile time. |
| G4 | **Dynamic lists:** One visual “row template” (group of widgets) bound to a C array or list API (e.g. WiFi AP scan results) with per-field mappings. |
| G5 | **Value transforms:** Map raw values to UI (RSSI dBm → 0–4 bars, battery mV → icon tier, enum → image) declaratively. |
| G6 | **Preview without flash:** Mock/stub data drives the preview; optional “attach to GDB/livedata” is out of scope for v1. |
| G7 | **Incremental adoption:** Projects can bind one label first; no all-or-nothing migration. Ungenerated hand code continues to work. |

### 2.2 Non-goals (v1)

| ID | Non-goal | Rationale |
|----|----------|-----------|
| NG1 | Full C parser maintained by EmbeddedFlow | Use clangd / Microsoft C++ extension via LSP. |
| NG2 | Calling arbitrary C from WASM preview | Preview uses **mock data**; firmware uses generated glue. |
| NG3 | Two-way binding for every widget | Start read-only **Model → View**; write paths are explicit actions. |
| NG4 | General-purpose scripting on device | No Lua/JS runtime; generated C only. |
| NG5 | Auto-discovery of RTOS tasks, DMA, drivers | Bind only symbols the user selects. |
| NG6 | Replacing the user’s WiFi/Battery drivers | User implements `wifi_get_scan_results()`; EmbeddedFlow wires UI to it. |

---

## 3. Concepts and glossary

| Term | Meaning in EmbeddedFlow |
|------|-------------------------|
| **Model** | Application data: structs, globals, return values from functions the firmware owns. |
| **View** | LVGL widgets defined in `.embf` (`pages[].components[]`). |
| **ViewModel (generated)** | `ui_bindings.c` / `ui_data.h`: refresh functions, formatters, list iterators, LVGL setter calls. |
| **Symbol** | A named C entity: function, variable, struct type, enum, macro (limited). |
| **Source** | Where binding reads data: `global`, `function_call`, `parameter`, `literal_mock` (preview only). |
| **Binding** | Rule: widget property ← Model path + optional transform. |
| **Path** | Member access chain: `ap.rssi`, `items[i].ssid`. |
| **Template row** | A grouped container in `.embf` representing one item in a list (e.g. WiFi row). |
| **Repeater** | Binds a template row to `count` items from a source array/API. |
| **Transform** | Maps Model value → View value (ranges, format, enum→resource). |
| **Refresh policy** | When ViewModel runs: `on_screen_load`, `timer_ms`, `on_event`, `manual`. |

---

## 4. User personas and stories

### 4.1 Persona A — ESP-IDF application developer

Maintains `main/wifi.c` with `esp_wifi_scan_get_ap_records()`. Wants a scrollable list on `page_wifi` without writing 200 lines of `lv_label_set_text`.

**Story A1:** Select the list template group → Bind source to `wifi_scan_get_entries()` returning `wifi_ap_info_t *` + count → Map `ssid`, `rssi`, `authmode` to row widgets → Generate code → Call `ui_bindings_refresh_wifi_list()` on screen load.

### 4.2 Persona B — STM32 HMI engineer

Has `typedef struct { uint8_t percent; bool charging; } battery_state_t;` updated in `app_battery_poll()`.

**Story B1:** Bind arc widget `value` to `g_battery.percent` (0–100). Bind charger icon `hidden` to `!g_battery.charging`. Define transform: percent &lt; 20 → red style (optional style binding v2).

### 4.3 Persona C — Team lead / reviewer

Wants reviewers to open `.embf` and see **which firmware API** feeds each widget without reading all C files.

**Story C1:** Inspector shows `Binding: wifi_scan_get_entries() → row.ssid_label.text` with jump-to-definition in C.

---

## 5. Functional requirements

### 5.1 Firmware project linkage

| Req ID | Requirement | Priority |
|--------|-------------|----------|
| FR-LINK-01 | `.embf` may declare `project.firmwareRoot` (folder) and optional `project.compileCommands` path to `compile_commands.json`. | P0 |
| FR-LINK-02 | If not set, EmbeddedFlow prompts to select the firmware folder or uses the VS Code workspace folder that contains `compile_commands.json`. | P0 |
| FR-LINK-03 | User can add **include paths** and **defines** overrides when compile DB is missing (degraded mode). | P2 |
| FR-LINK-04 | Multiple `.embf` projects may share one firmware tree; bindings reference symbols by stable ID (TU + name + signature hash). | P2 |

### 5.2 C symbol discovery (“IntelliSense for bindings”)

| Req ID | Requirement | Priority |
|--------|-------------|----------|
| FR-SYM-01 | Extension queries **Language Server Protocol** (clangd or Microsoft C/C++) for: document symbols, workspace symbol search, type definition, member completion. | P0 |
| FR-SYM-02 | Supported pick kinds: **functions** (with signature), **global variables**, **struct/union** types, **enum** types, **typedef** aliases (resolved to underlying type). | P0 |
| FR-SYM-03 | For a selected function, show return type and parameter list; allow binding to **return value** only when return type is scalar or pointer-to-struct/array per rules. | P0 |
| FR-SYM-04 | Member picker: given struct type `T`, list fields with types; support nested access to depth N (configurable max, default 6). | P0 |
| FR-SYM-05 | Arrays: support `T[]`, `T *`, and known-length arrays; pointer+length pattern via paired symbols (`items`, `items_count`) declared in binding config. | P0 |
| FR-SYM-06 | Const correctness: model paths may be read-only; codegen uses `const` where source is const. | P1 |
| FR-SYM-07 | When LSP unavailable, show clear error: “Install C/C++ extension and generate compile_commands.json”; allow **manual symbol entry** (string) without validation (expert mode). | P1 |
| FR-SYM-08 | Cache symbol index per firmware root; invalidate on `compile_commands.json` change or file watcher on referenced headers. | P1 |

### 5.3 Binding model in `.embf` (schema)

New top-level section recommended (exact shape subject to schema design):

```json
"dataModel": {
  "sources": [
    {
      "id": "wifi_scan",
      "kind": "function",
      "symbol": "wifi_get_scan_results",
      "headers": ["wifi_manager.h"],
      "returns": { "type": "wifi_ap_info_t*", "countSymbol": "wifi_get_scan_count" }
    },
    {
      "id": "battery",
      "kind": "global",
      "symbol": "g_battery_state",
      "type": "battery_state_t",
      "headers": ["app_battery.h"]
    }
  ],
  "bindings": [ ... ],
  "repeaters": [ ... ]
}
```

| Req ID | Requirement | Priority |
|--------|-------------|----------|
| FR-SCH-01 | `dataModel.sources[]` declares every external symbol EmbeddedFlow did not generate. | P0 |
| FR-SCH-02 | Each binding references `sourceId`, `path` (member chain or `.` for root scalar), `target` (widget id + property). | P0 |
| FR-SCH-03 | JSON Schema validation: target property must exist for widget type; path must match resolved field types. | P0 |
| FR-SCH-04 | Version field `dataModel.version` for forward-compatible migrations. | P0 |
| FR-SCH-05 | Optional sidecar `project.embf.bindings.json` merged at load time for teams that want data out of main `.embf` (FR-SCH-05 = P2). | P2 |

### 5.4 Scalar bindings (Model → View)

| Req ID | Requirement | Priority |
|--------|-------------|----------|
| FR-BIND-01 | **Label** `text` ← `int8_t|int16_t|int32_t|uint*|float|double|string(char*)` with `format` (printf-style subset). | P0 |
| FR-BIND-02 | **Bar / slider / arc** `value` ← integral or float with optional `min`/`max` clamp in transform. | P0 |
| FR-BIND-03 | **Image** `src` ← enum or int mapped via transform to asset id (e.g. battery 0–4 → `battery_0`…`battery_4`). | P1 |
| FR-BIND-04 | **Hidden / disabled** ← `bool` or comparison transform (`percent < 20`). | P1 |
| FR-BIND-05 | **Dropdown / roller** options from `const char *const *` or generated static table (P2). | P2 |
| FR-BIND-06 | Binding may target **style property** (e.g. bg_color from temperature) in v2. | P3 |

### 5.5 Transforms

| Req ID | Requirement | Priority |
|--------|-------------|----------|
| FR-XF-01 | **Format:** `"%d %%"`, `"%s"`, fixed locale=C. | P0 |
| FR-XF-02 | **Range map:** ordered ranges `[{max, value}, …]` for int/float → int (signal bars). Example: RSSI −90..−70 → 1 bar. | P0 |
| FR-XF-03 | **Enum map:** `WPA2` → show lock icon; `OPEN` → hide lock. | P1 |
| FR-XF-04 | **Scale:** linear map from `[inMin, inMax]` to `[outMin, outMax]`. | P1 |
| FR-XF-05 | **Clamp / abs / divide** pipeline as composable steps (v2). | P2 |
| FR-XF-06 | Transforms are evaluated in **generated C** (no float code in JSON interpreter on device). | P0 |

Example (WiFi signal strength):

```json
{
  "transform": {
    "kind": "rangeMap",
    "input": "item.rssi",
    "ranges": [
      { "max": -85, "out": 0 },
      { "max": -70, "out": 1 },
      { "max": -55, "out": 2 },
      { "max": -40, "out": 3 },
      { "out": 4 }
    ]
  }
}
```

### 5.6 List repeaters (template rows)

| Req ID | Requirement | Priority |
|--------|-------------|----------|
| FR-REP-01 | User marks a **container/panel** as `role: "listItemTemplate"` (or via repeater config referencing template id). | P0 |
| FR-REP-02 | Repeater config: `sourceId`, `itemType` (struct), `maxVisible` (pool size), parent list container id. | P0 |
| FR-REP-03 | Codegen creates **N LVGL row instances** (object pool) or reuses LVGL list widget patterns; default pool `maxVisible = 12` user-editable. | P0 |
| FR-REP-04 | Per-field bindings inside template use `item.<member>` path. | P0 |
| FR-REP-05 | `refresh` clears unused rows (hidden) when `count < maxVisible`. | P0 |
| FR-REP-06 | Variable row height deferred; fixed height from template required in v1. | P0 |
| FR-REP-07 | Scrollable parent: generate `lv_obj_set_scroll_dir` / flex column layout as needed. | P1 |

Example (WiFi list):

```json
{
  "repeaters": [
    {
      "id": "wifi_list",
      "templateComponentId": "wifi_row",
      "parentId": "wifi_list_panel",
      "sourceId": "wifi_scan",
      "itemPath": "",
      "bindings": [
        { "target": "wifi_row.ssid_label.text", "path": "ssid", "format": "%s" },
        { "target": "wifi_row.lock_icon.hidden", "path": "authmode", "transform": { "kind": "enumMap", "map": { "OPEN": true } } },
        { "target": "wifi_row.signal_bars.value", "path": "rssi", "transform": { "kind": "rangeMap", "ranges": [ ... ] } }
      ]
    }
  ]
}
```

### 5.7 Refresh and lifecycle

| Req ID | Requirement | Priority |
|--------|-------------|----------|
| FR-REF-01 | `on_screen_load`: call page-level `ui_<page>_bindings_refresh()` from existing screen init. | P0 |
| FR-REF-02 | `timer_ms`: optional `lv_timer` per page or per source (minimum 100 ms enforced). | P1 |
| FR-REF-03 | `manual`: export `void ui_bindings_refresh_<id>(void)` for app to call after WiFi scan completes. | P0 |
| FR-REF-04 | Document thread safety: all generated refresh must run on **LVGL thread** (same as existing LVGL rules). | P0 |
| FR-REF-05 | Fail-safe: if source function returns error code, hide list / show error label binding (P2). | P2 |

### 5.8 Inspector and preview UX

| Req ID | Requirement | Priority |
|--------|-------------|----------|
| FR-UX-01 | Inspector **Bindings** section on each widget: add / edit / remove binding. | P0 |
| FR-UX-02 | **Pick symbol** button opens searchable quick-pick fed by LSP workspace symbols. | P0 |
| FR-UX-03 | **Pick member** cascaded UI after struct type known. | P0 |
| FR-UX-04 | **Transform editor** for range map (visual bar thresholds) and format string. | P1 |
| FR-UX-05 | Preview panel: **Data** toggle — use `mockData` from `.embf` or recorded snapshot JSON. | P0 |
| FR-UX-06 | Repeater preview: duplicate template visually up to `mockCount` (e.g. 5 fake WiFi rows). | P0 |
| FR-UX-07 | Broken binding shows inline warning icon (symbol not found, type mismatch). | P0 |
| FR-UX-08 | Code lens or link: **Go to C definition** on bound symbol. | P1 |
| FR-UX-09 | Command palette: **embeddedflow: Validate All Bindings**. | P1 |

### 5.9 Code generation (ViewModel output)

| Req ID | Requirement | Priority |
|--------|-------------|----------|
| FR-GEN-01 | Emit `ui_bindings.h` / `ui_bindings.c` (or per-page `ui_<page>_bindings.c`). | P0 |
| FR-GEN-02 | Emit `ui_data.h` with `extern` declarations for user symbols (includes user headers). | P0 |
| FR-GEN-03 | User implements firmware; EmbeddedFlow **never overwrites** user files—only generated output directory. | P0 |
| FR-GEN-04 | Generated refresh functions are idempotent (safe to call repeatedly). | P0 |
| FR-GEN-05 | LVGL 9.x: optional codegen path using **lv_observer** / `lv_subject` where binding is a simple scalar (FR-GEN-05 = P2). | P2 |
| FR-GEN-06 | LVGL 8.x: emit direct `lv_*_set_*` calls only. | P0 |
| FR-GEN-07 | Generated file banner: “DO NOT EDIT — generated by EmbeddedFlow”. | P0 |
| FR-GEN-08 | `ui_init()` calls `ui_bindings_init()` after objects created. | P0 |

### 5.10 Validation and diagnostics

| Req ID | Requirement | Priority |
|--------|-------------|----------|
| FR-VAL-01 | Parse-time: binding target widget must exist on same page (or library instance rules). | P0 |
| FR-VAL-02 | Type check: `int` → label OK; `struct` → label without format path error. | P0 |
| FR-VAL-03 | Firmware compile hook (optional): run `clang` on generated bindings TU in CI (P2). | P2 |
| FR-VAL-04 | Output channel **EmbeddedFlow Bindings** lists all issues with file/line jump to `.embf` binding entry. | P1 |

### 5.11 Security and safety

| Req ID | Requirement | Priority |
|--------|-------------|----------|
| FR-SEC-01 | Generated code never calls arbitrary function pointers from `.embf`—only symbols explicitly listed in `dataModel.sources`. | P0 |
| FR-SEC-02 | No `eval` or string-to-code in extension host beyond codegen templates. | P0 |
| FR-SEC-03 | String bindings require user to assert NUL-terminated `char*` (documented). | P0 |

---

## 6. Reference examples (acceptance scenarios)

### 6.1 WiFi scan list (struct array via API)

**Firmware (user-written):**

```c
typedef struct {
    char ssid[33];
    int8_t rssi;
    wifi_auth_mode_t authmode;
} wifi_ap_info_t;

int wifi_get_scan_results(const wifi_ap_info_t **out_ap);
```

**EmbeddedFlow:**

- Template row `wifi_row`: `ssid_label`, `lock_icon`, `signal_bars` (bar 0–4).
- Source `wifi_scan` → function `wifi_get_scan_results`.
- Repeater binds to `wifi_list_panel`, pool 10.
- Transforms: RSSI → bars; authmode → lock hidden when OPEN.
- Mock data: 3 APs in `.embf` for preview.

**Generated (conceptual):**

```c
void ui_page_wifi_bindings_refresh(void) {
    const wifi_ap_info_t *ap;
    int n = wifi_get_scan_results(&ap);
    if (n > WIFI_ROW_POOL) n = WIFI_ROW_POOL;
    for (int i = 0; i < n; i++) {
        lv_label_set_text(ui_wifi_row_ssid_label[i], ap[i].ssid);
        lv_bar_set_value(ui_wifi_row_signal_bars[i], embf_map_rssi_to_bars(ap[i].rssi), LV_ANIM_OFF);
        ...
    }
    for (int i = n; i < WIFI_ROW_POOL; i++)
        lv_obj_add_flag(ui_wifi_row[i], LV_OBJ_FLAG_HIDDEN);
}
```

**Acceptance:** Changing mock RSSI in preview updates bar widgets without reflash. After codegen, firmware compiles when user provides stub implementation.

### 6.2 Battery indicator (global struct)

**Firmware:**

```c
typedef struct { uint8_t percent; bool charging; } battery_state_t;
extern battery_state_t g_battery;
```

**Bindings:**

- Arc `value` ← `g_battery.percent`.
- Image `src` ← transform range map percent → `battery_0`…`battery_4` assets.
- Label `hidden` ← `!g_battery.charging` for lightning icon.

**Acceptance:** Inspector shows struct members picked from LSP; preview uses mock `{percent: 15, charging: false}`.

### 6.3 Single temperature label (MVP slice)

**Binding:** `lbl_temp.text` ← `g_sensors.temp_c` with format `"%.1f C"`.

**Acceptance:** Smallest end-to-end demo; ships in Phase 1.

---

## 7. Technical architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  VS Code / Cursor                                               │
│  ┌──────────────┐    LSP     ┌─────────────┐                    │
│  │ EmbeddedFlow │◄──────────►│ clangd /    │                    │
│  │ Extension    │            │ C/C++ ext   │                    │
│  └──────┬───────┘            └─────────────┘                    │
│         │ reads compile_commands.json                           │
│         ▼                                                       │
│  ┌──────────────┐     postMessage    ┌──────────────┐           │
│  │ Binding      │◄──────────────────►│ Preview      │           │
│  │ Validator    │     mockData       │ Webview      │           │
│  └──────┬───────┘                    └──────────────┘           │
│         │                                                       │
│         ▼                                                       │
│  ┌──────────────┐                                               │
│  │ Binding      │──► ui_bindings.c, ui_data.h                   │
│  │ Codegen      │    (extends existing ui_*.c generator)        │
│  └──────────────┘                                               │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  User firmware (ESP-IDF, STM32, …)                              │
│  app_wifi.c, app_battery.c  ◄── user owns Model                 │
│  ui_output/ui_*.c           ◄── EmbeddedFlow View + ViewModel   │
└─────────────────────────────────────────────────────────────────┘
```

### 7.1 LSP integration (feasibility)

- Use `vscode.executeWorkspaceSymbolProvider`, `executeDefinitionProvider`, `executeCompletionProvider` scoped to firmware root URI.
- Resolve type of expression via clangd `textDocument/hover` or completion item `detail` where available.
- **Fallback:** libclang Python subprocess or `clang -Xclang -ast-dump` on saved temp file (slower, P2).

### 7.2 Preview mock engine (feasibility)

- Webview already receives full project JSON on load; extend payload with `mockData` keyed by `sourceId`.
- WASM path: either extend embf_runtime with “inject property” API (P1) or overlay HTML for list rows only in design mode (P0 minimal).
- Mock data edited in **Data** sidebar table (CSV/JSON) or imported from captured firmware log (P2).

### 7.3 Codegen (feasibility)

- Template-based C emission (existing codegen style in `src/codeGen/`).
- One helper per transform type: `embf_map_range_int()`, `embf_format_float()` in `ui_bindings_util.h` (generated once, static inline).

---

## 8. Phased delivery plan

### Phase 1 — MVP (“one label, one truth”) — ~4–6 weeks engineering estimate

- FR-LINK-01/02, FR-SYM-01/02/04 (manual path entry OK if LSP flaky)
- FR-SCH-01/02, FR-BIND-01, FR-XF-01
- FR-GEN-01/02/03/04/08, FR-REF-01/03
- FR-UX-01/02/05, FR-VAL-01/02
- **Deliverable:** Temperature label bound to global; generated refresh on screen load.

### Phase 2 — Transforms & visibility — ~3–4 weeks

- FR-XF-02/03/04, FR-BIND-03/04, FR-UX-04
- Battery icon scenario end-to-end.

### Phase 3 — List repeaters — ~6–8 weeks

- FR-REP-01…05, FR-SYM-05, WiFi scenario end-to-end.
- FR-UX-06, mock list in preview.

### Phase 4 — Polish & LVGL 9 observers — optional

- FR-GEN-05, FR-REF-02, sidecar JSON, CI clang check.

---

## 9. Schema sketch (informative)

Widget-level binding reference (alternative to central `bindings[]`):

```json
{
  "id": "lbl_temp",
  "type": "label",
  "text": "—",
  "binding": {
    "sourceId": "sensors",
    "path": "temp_c",
    "format": "%.1f °C"
  }
}
```

Central registry remains required for repeaters and shared sources.

**Mock data:**

```json
"mockData": {
  "wifi_scan": {
    "count": 3,
    "items": [
      { "ssid": "Home", "rssi": -42, "authmode": "WPA2" },
      { "ssid": "Guest", "rssi": -68, "authmode": "OPEN" },
      { "ssid": "IoT", "rssi": -81, "authmode": "WPA2" }
    ]
  },
  "battery": { "percent": 72, "charging": true }
}
```

---

## 10. Success metrics

| Metric | Target |
|--------|--------|
| Time to add a new list column | &lt; 5 minutes (bind member, no new hand C) |
| Preview iteration | 0 flashes for layout + mock data |
| Binding validation | 95% of type errors caught before firmware build |
| Adoption | Works with ESP-IDF `compile_commands.json` without extra config |

---

## 11. Risks and mitigations

| Risk | Mitigation |
|------|------------|
| LSP not configured in embedded projects | Document ESP-IDF / CMake compile_commands; expert manual entry |
| Struct layout differs across builds (`#pragma pack`) | Bind via generated offsetof only when type from same compile DB; warn on mismatch |
| RAM cost of row pools | User sets `maxVisible`; document tradeoff |
| wchar_t / fancy strings | v1: `char*` UTF-8 only |
| C++ name mangling | v1: `extern "C"` symbols only in picker |

---

## 12. Relation to LVGL Pro / Squareline

LVGL’s commercial XML editor and **observer** APIs solve similar problems inside their toolchain. EmbeddedFlow differentiates by:

- Living in **VS Code** next to real firmware sources.
- Binding to **user’s existing C** (not a vendor SDK).
- **Open** `.embf` JSON and generated C the team owns.

Where LVGL 9 `lv_subject` fits, prefer generating thin observer wrappers in Phase 4 instead of reinventing notification.

---

## 13. Open questions (to resolve before implementation)

1. Single `dataModel` in `.embf` vs mandatory sidecar for large apps?
2. Per-page vs global `ui_bindings.c` for linker granularity?
3. Allow bindings to **generated** widget globals (`ui_main_lbl_title`) vs only abstract widget ids?
4. How to handle **FreeRTOS** queue updates → `lv_async_call` wrapper in generated code?
5. Licensing: clangd (Apache-2.0) — see [docs/DECISIONS-clangd-setup.md](../docs/DECISIONS-clangd-setup.md); generated code license still open (Q5 in OPEN_QUESTIONS).

---

## 14. Summary

Embedded developers should not reverse-engineer their own UI from scattered C. **embeddedflow** already owns the View; this feature adds a **declarative, type-checked bridge** to the firmware Model, with list repeaters and transforms tailored to real embedded cases (WiFi lists, battery tiers, sensor formatting). Implementation is feasible by **reusing LSP for discovery**, **mock data for preview**, and **template codegen for the ViewModel**—no runtime reflection on the MCU.

---

## Progress (implementation tracking)

- [ ] Phase 1 — Scalar global binding + codegen
- [ ] Phase 2 — Transforms (range, enum, format)
- [ ] Phase 3 — List repeaters + mock list preview
- [ ] Phase 4 — LVGL 9 observers, timers, CI validation
