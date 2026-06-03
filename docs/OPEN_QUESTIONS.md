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

- When is the clangd instance started? (on project open, on first bind action, on demand)
- What happens if `compile_commands.json` is missing? (fallback to header-only, or error)
- How is the firmware path configured? (`.embf` `project.firmwarePath` field, or separate config)

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
