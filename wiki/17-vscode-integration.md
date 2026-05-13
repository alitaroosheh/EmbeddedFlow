# 17 — VSCode Integration

## 17.1 Extension Activation

- [x] Activates on `onLanguage:embf` and `workspaceContains:**/*.embf`
- [x] `.embf` registered as a language with `language-configuration.json`
- [ ] File type icon for `.embf` files in the Explorer sidebar
- [ ] File type icon for `.embf` in open tabs

## 17.2 Commands (Command Palette)

- [x] `EmbeddedFlow: Open UI Preview` — open/reveal the preview panel
- [x] `EmbeddedFlow: New Project` — project creation wizard
- [ ] `EmbeddedFlow: Generate C Code` — run code generation
- [ ] `EmbeddedFlow: Preview C Output` — dry-run codegen in diff editor
- [ ] `EmbeddedFlow: Watch & Export` — live export mode
- [ ] `EmbeddedFlow: Validate Project` — run semantic validation
- [ ] `EmbeddedFlow: Take Screenshot` — snapshot the current preview frame
- [ ] `EmbeddedFlow: Open Visual Editor` — open the drag-and-drop canvas editor

## 17.3 Editor Title Bar Button

- [x] Preview icon button (👁) in editor title bar when a `.embf` file is active

## 17.4 Context Menu Integration

- [ ] Right-click `.embf` in Explorer → "Open EmbeddedFlow Preview"
- [ ] Right-click `.embf` in Explorer → "Generate C Code"
- [ ] Right-click `.embf` in Explorer → "Open Visual Editor"

## 17.5 Status Bar

- [ ] Status bar item showing the active project name + LVGL version when a `.embf` is open
- [ ] Click the status bar item to open the project settings
- [ ] Error badge on the status bar item when validation fails

## 17.6 Diagnostics (Problems Panel)

- [x] JSON Schema errors shown inline in the `.embf` editor via `jsonValidation`
- [ ] Semantic errors (duplicate IDs, missing references) shown as VSCode `Diagnostic` entries
- [ ] Warnings for deprecated properties (e.g. `recolor` in LVGL 9.3+)
- [ ] Quick Fix actions for common errors (e.g. "Rename duplicate ID")

## 17.7 IntelliSense for .embf Files

- [x] JSON Schema autocomplete (widget types, enum values, required fields)
- [ ] Hover documentation: hovering over a property shows its LVGL equivalent + link to LVGL docs
- [ ] Widget ID completion in `events[].target` and animation `target` fields
- [ ] Page ID completion in `navigate` action `target` field

## 17.8 Settings

- [x] `embeddedflow.defaultLvglVersion` — default for new projects
- [ ] `embeddedflow.outputDirectory` — default export output path
- [ ] `embeddedflow.autoOpenPreview` — auto-open preview when `.embf` is opened (default: true)
- [ ] `embeddedflow.liveExport` — auto-export on save (default: false)
- [ ] `embeddedflow.gridSize` — editor canvas grid size in px (default: 8)
- [ ] `embeddedflow.showBezel` — show device bezel in preview (default: false)

## 17.9 Panels / Views

- [ ] **EmbeddedFlow: Widget Palette** — tree view of all available widgets, drag onto canvas
- [ ] **EmbeddedFlow: Widget Tree** — hierarchy of current page, click to select
- [ ] **EmbeddedFlow: Property Inspector** — properties of selected widget
- [ ] **EmbeddedFlow: Assets** — fonts + images registered in the project

## 17.10 Keyboard Shortcuts

- [ ] `Ctrl+Shift+P` → command palette (VSCode standard)
- [ ] `Ctrl+Z` / `Ctrl+Y` — undo/redo in visual editor
- [ ] `Ctrl+C` / `Ctrl+V` / `Ctrl+D` — copy/paste/duplicate in visual editor
- [ ] `Delete` / `Backspace` — delete selected widget(s)
- [ ] `Ctrl+G` — toggle grid snap
- [ ] `Ctrl+0` — fit canvas to window
- [ ] `Ctrl+=` / `Ctrl+-` — zoom in / out
- [ ] `F5` — reload preview (force WASM restart)
- [ ] `Ctrl+Shift+B` — generate C code

## 17.11 Walkthrough / Welcome Page

- [ ] VSCode walkthrough ("Getting Started with EmbeddedFlow"):
  - [ ] Step 1: Create a new project
  - [ ] Step 2: Open the visual editor
  - [ ] Step 3: Add widgets
  - [ ] Step 4: Preview on WASM
  - [ ] Step 5: Generate C code
