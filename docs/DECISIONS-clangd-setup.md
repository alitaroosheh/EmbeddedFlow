# Decision — Optional requirements wizard (clangd)

**Status:** Decided — **M1.5 wizard implemented** (command `embeddedflow.installRequirements`)  
**Date:** 2026-06-04  
**Context:** Phase 2 symbol discovery needs a C language engine. Requiring users to install `clangd` manually is poor UX.

---

## Summary

EmbeddedFlow will offer an **optional setup wizard** (similar in spirit to **ESP-IDF: Install tools**) that installs symbol-discovery requirements when the user wants them.

**Preview, design, and C codegen from `.embf` work without this wizard.**  
The wizard is only for **firmware symbol discovery / binding** (Phase 2+).

---

## What we decided

### 1. Optional wizard — not mandatory

- User **chooses** to run setup (command: **EmbeddedFlow: Install requirements** — planned).
- First use of symbol features may **suggest** the wizard but must **not block** preview or codegen.
- User can skip and use **manual symbol paths** (expert mode) if they prefer.

### 2. What the wizard installs

| Requirement | Installed by wizard? | Notes |
|-------------|----------------------|--------|
| **clangd** | Yes (primary) | Reads firmware C symbols via `compile_commands.json` |
| **WASM preview runtime** | No | Already bundled in the VSIX |
| **Firmware build / `compile_commands.json`** | No | User builds firmware (e.g. `idf.py build`); wizard may **check** and remind |

### 3. How clangd is delivered

- **Default:** download from **official clangd releases** (mainline), **not** bundled in the VSIX (keeps VSIX small; one package for Windows / Linux / macOS).
- Cache under extension-managed storage (user does not manage PATH).
- **Pin a tested clangd version** per EmbeddedFlow release.
- **Optional later:** offline / enterprise VSIX with bundled clangd.

### 4. User must be informed

Before the first download, show a simple message:

- What is being installed (**clangd**, approximate size, one-time).
- Where it comes from (**official LLVM / clangd project**).
- License (**Apache-2.0** — see third-party notices in docs).
- Actions: **Install** / **Use my own clangd** / **Not now**.

Show progress during download. Allow **reinstall / repair** from the command palette.

### 5. Which clangd is used (priority)

1. User setting `embeddedflow.clangdPath` (explicit path) — **user’s choice**
2. **EmbeddedFlow-managed clangd** (installed by wizard) — **default after setup**
3. System `clangd` on PATH — **optional fallback only**, with a warning if version is old or untested

After setup, do **not** silently prefer a random system clangd over the managed one.

### 6. Version mismatch

- Different clangd versions usually still work; ESP-IDF projects may be slow or flaky on very old clangd.
- Prefer **one known-good pinned version** from the wizard.
- If system clangd is used, **show the version** in status / output.

### 7. License

- **clangd / LLVM:** Apache License 2.0 — OK to use and to help users obtain official binaries; include **third-party notices** in repo / docs if we redistribute or document download.
- **EmbeddedFlow (GPL-3.0)** runs clangd as a **separate process** (not linked into GPL code) — standard language-server pattern.
- Not legal advice; review before marketplace publication if needed.

### 8. Engine choice (what we are *not* doing)

- **Not** requiring manual `clangd` install as the only path.
- **Not** using Python libclang as the primary path (extra runtime, same native dependency).
- **Not** replacing clangd with ctags/tree-sitter for core binding (insufficient types / members); those remain possible **degraded** fallbacks only.

**Keep clangd as the semantic engine; fix UX with the wizard + managed install.**

---

## User flow (simple)

1. Install EmbeddedFlow extension from Marketplace.
2. Open `.embf` → preview works immediately.
3. When user wants symbols / binding → run **Install requirements** (or accept prompt once).
4. Wizard downloads clangd, verifies it, optionally checks firmware path + `compile_commands.json`.
5. Symbol index / binding features use managed clangd.

---

## Commands (planned)

| Command | Purpose |
|---------|---------|
| `embeddedflow.installRequirements` | Run optional setup wizard ✅ |
| `embeddedflow.refreshSymbolIndex` | Uses managed or configured clangd (M1) |

---

## Settings (planned)

| Setting | Purpose |
|---------|---------|
| `embeddedflow.clangdPath` | Override: use user’s clangd (exists in M1) |
| `embeddedflow.clangd.useSystem` | Optional: allow PATH clangd as fallback |
| `embeddedflow.requirements.installed` | Internal / UI: wizard completed |

Exact setting names TBD at implementation.

---

## Related docs

- [OPEN_QUESTIONS.md](./OPEN_QUESTIONS.md) — Q3 (clangd lifecycle), Q8 (requirements wizard)
- [REQUIREMENTS.md](./REQUIREMENTS.md) — SD1–SD5 symbol discovery
- [wiki/19-code-binding-and-data-model.md](../wiki/19-code-binding-and-data-model.md) — FR-LINK / FR-SYM
