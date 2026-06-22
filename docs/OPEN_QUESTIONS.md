# EmbeddedFlow — Open Questions

**Status:** Tracking remaining decisions  
**Last updated:** 2026-06-04

---

## Resolved (2026-06-04 planning session)

All core architecture questions were resolved. See [ARCHITECTURE.md](./ARCHITECTURE.md) for full decisions and [ROADMAP.md](./ROADMAP.md) for the decision log.

---

## Open — Phase 1 implementation

### Q1 — Navigation Graph visual design

The overlay approach is confirmed. Still open: exact interaction design.

- How are edges created? (drag from page node, or select source + target + click "add transition")
- How are edge properties (animation, duration, trigger) edited? (inline on edge label, or side panel)
- How are orphan pages (no edges) displayed?

### Q2 — Property direction default

When a developer adds a property without specifying direction:

- Default to `push`?
- Default to `pull`?
- Require explicit selection?

---

## Open — Phase 2 implementation

### Q3 — clangd session lifecycle

✔ **Decision (2026-06-04):** clangd starts **lazily** on the first symbol-index request — when the preview loads with `project.firmwarePath` set, or when the user runs **Refresh Symbol Index** / clicks refresh in the page inspector. One dedicated clangd process per resolved firmware root (SD1). If `compile_commands.json` is missing, show a clear error (build firmware first); no header-only fallback in M1. Firmware path: `project.firmwarePath` in `.embf` (SD2), with workspace auto-discovery (FR-LINK-02) and folder picker when unset.

### Q8 — clangd installation UX (requirements wizard)

✔ **Decision (2026-06-04):** Do **not** require users to install clangd manually. Provide an **optional setup wizard** (ESP-IDF–style) that downloads and caches official clangd when the user chooses. Preview and codegen work without it; symbol/binding features use managed clangd after setup. User must be **informed and consent** before download. Full spec: **[DECISIONS-clangd-setup.md](./DECISIONS-clangd-setup.md)**.

**Status:** Decided — implemented (`embeddedflow.installRequirements`, M1.5).

### Q4 — Binding transforms design

Transforms confirmed for Phase 2. Syntax not yet decided:

```json
// Option A — simple inline
{ "transform": "map(0, 100, -40, 125)" }
// Option B — named transform with params
{ "transform": { "type": "range_map", "in": [0, 100], "out": [-40, 125] } }
// Option C — format string only (no range)
{ "transform": "%.1f °C" }
```

---

## Open — Business

### Q5 — Generated code license

The extension is GPL-3.0-or-later. The generated `ui_*.c` / `embf_app.c` files are produced by the tool and embedded in firmware. What license applies to those files?

Options:
- GPL propagates to generated code (strict)
- Generated files carry no license restriction (permissive output)
- Generated files carry an explicit permissive header (MIT or Apache-2.0 exception)

### Q6 — Marketplace release timing

- Ship v1.1.x now as foundation?
- Wait for Phase 1 (Navigation Graph) before first public release?

---

## How to answer

Comment on an issue, reply in chat, or edit this file directly with `✔ Decision: ...` and date.
