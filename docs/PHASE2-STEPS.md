# Phase 2 — Step-by-step plan

**Goal:** Bind UI widgets to real firmware C symbols with validation and codegen.

Preview and C codegen from `.embf` work **without** completing every step. Symbol/binding features unlock progressively.

---

## Milestone 1 — Symbol discovery ✅

| Step | Requirement | Status |
|------|-------------|--------|
| 1.1 | SD1 — dedicated clangd per firmware project | ✅ |
| 1.2 | SD2 — `project.firmwarePath` in inspector | ✅ |
| 1.3 | SD3 — `compile_commands.json`, headless | ✅ |
| 1.4 | SD4 — LSP: globals, members, signatures | ✅ |
| 1.5 | SD5 — symbol graph cached per session | ✅ |

---

## Milestone 1.5 — Requirements wizard (clangd UX)

| Step | Deliverable | Status |
|------|-------------|--------|
| 2.1 | Command **EmbeddedFlow: Install requirements** | ✅ |
| 2.2 | Consent before download; progress UI | ✅ |
| 2.3 | Download official clangd 22.1.6 → global storage | ✅ |
| 2.4 | Resolve: setting → managed → system (optional) | ✅ |
| 2.5 | Suggest wizard when symbol index runs without clangd | ✅ |

Spec: [DECISIONS-clangd-setup.md](./DECISIONS-clangd-setup.md)

---

## Milestone 2 — Binding UX

| Step | Requirement | Status |
|------|-------------|--------|
| 3.1 | Wire symbol graph to preview (search API) | ✅ |
| 3.2 | Schema: `dataModel.sources[]` + binding IR (FR-SCH-01/02) | ✅ |
| 3.3 | **BU1** — “Bind Data” symbol tree picker | ✅ |
| 3.4 | **BU2** — autocomplete for manual symbol path | ⬜ |
| 3.5 | **BU3** — tree + manual → same IR object | ⬜ |
| 3.6 | **BU4** — type validation at bind time | ⬜ |
| 3.7 | FR-UX-07 — inline warning on broken binding | ⬜ |

---

## Milestone 3 — Code mapping

| Step | Requirement | Status |
|------|-------------|--------|
| 4.1 | **CM1** — binding `direction`: push / pull | ⬜ |
| 4.2 | **CM2** — push → `ui_set_<id>()` | ⬜ |
| 4.3 | **CM3** — pull → `extern` + `ui_bindings_apply()` | ⬜ |
| 4.4 | **CM4** — direction from IR (compiler decides) | ⬜ |
| 4.5 | **CM5** — transforms (format, range map) | ⬜ |

**Exit criteria (ROADMAP):** Label bound to `app_data.temp_c` from picker; push/pull codegen; type mismatch at bind time.

---

## What to do next

1. ~~Finish **Step 2**: requirements wizard.~~ ✅
2. ~~**Step 3.1**: expose symbols to webview.~~ ✅
3. ~~**Step 3.3**: Bind Data picker (BU1).~~ ✅
4. **Step 3.4**: manual symbol path autocomplete (BU2).

---

## Related docs

- [REQUIREMENTS.md](./REQUIREMENTS.md) — SD / BU / CM IDs
- [ROADMAP.md](./ROADMAP.md) — Phase 2 exit criteria
- [wiki/19-code-binding-and-data-model.md](../wiki/19-code-binding-and-data-model.md) — FR-* detail
