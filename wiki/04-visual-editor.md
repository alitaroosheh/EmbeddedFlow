# 04 — Visual Editor

The visual editor is a WebviewPanel canvas that allows drag-and-drop design of LVGL UIs
without manually editing JSON. It is the primary design surface of EmbeddedFlow.

## 4.1 Editor Canvas

- [ ] Design canvas renders the current page at exact display resolution
- [ ] Canvas is scalable (zoom in/out) while keeping pixel-accurate display size
- [ ] Grid overlay toggle (configurable grid size in px)
- [ ] Rulers on canvas edges (horizontal + vertical)
- [ ] Canvas background shows simulated device bezel (configurable)
- [ ] Page background color shown correctly

## 4.2 Widget Palette

- [ ] Sidebar panel listing all supported widgets grouped by category
- [ ] Each widget has an icon and label
- [ ] Drag a widget from palette and drop onto the canvas to create it
- [ ] Click on canvas (without dragging) opens a "insert widget here" picker
- [ ] Palette is searchable

## 4.3 Selection & Manipulation

- [ ] Single-click selects a widget (highlights it with selection handles)
- [ ] Drag a selected widget to reposition it
- [ ] Drag resize handles to change width/height
- [ ] Multi-select: Shift+click or rubber-band drag
- [ ] Multi-select allows bulk move and bulk delete
- [ ] Alt+drag duplicates a widget
- [ ] Escape deselects

## 4.4 Snapping & Alignment

- [ ] Snap to grid (toggle, configurable grid size)
- [ ] Snap to other widget edges (smart guides)
- [ ] Snap to parent edges and center lines
- [ ] Alignment toolbar: align left/right/top/bottom/center horizontally/vertically
- [ ] Distribute evenly (horizontal / vertical spacing)
- [ ] Visible guide lines while dragging

## 4.5 Widget Tree (Hierarchy Panel)

- [ ] Tree view listing all pages and their widget hierarchy
- [ ] Drag items in the tree to reparent widgets
- [ ] Click a tree node to select the widget on canvas
- [ ] Right-click context menu: rename, duplicate, delete, move up/down
- [ ] Toggle widget visibility from tree

## 4.6 Property Inspector Panel

- [ ] Opens when a widget is selected
- [ ] Grouped sections: Position & Size, Widget Properties, Styles, Events, Animations
- [ ] All `.embf` properties editable inline
- [ ] Color pickers for color values
- [ ] Dropdowns for enum properties (align, longMode, etc.)
- [ ] Number inputs with increment/decrement arrows
- [ ] Toggle switches for boolean properties
- [ ] Changes are written back to the `.embf` JSON immediately
- [ ] Property values show live in the preview as you change them

## 4.7 Undo / Redo

- [ ] Ctrl+Z / Ctrl+Y (or Cmd on macOS) undo/redo
- [ ] History depth: ≥ 50 operations
- [ ] History tracks: move, resize, property change, add widget, delete widget, reparent
- [ ] History is cleared on file reload from disk

## 4.8 Copy / Paste

- [ ] Ctrl+C / Ctrl+V copies selected widget(s) including all children
- [ ] Paste places the copy offset by +10px to avoid exact overlap
- [ ] Ctrl+D duplicates in place (same as copy + paste)
- [ ] Copy/paste works across pages within the same project
- [ ] Clipboard format is self-contained JSON (can be pasted across projects)

## 4.9 Z-Order Management

- [ ] Bring to Front / Send to Back commands
- [ ] Bring Forward / Send Backward (one step)
- [ ] Available from right-click context menu and keyboard shortcuts
- [ ] Reflected immediately in the widget tree order

## 4.10 Zoom & Pan

- [ ] Ctrl+scroll to zoom in/out
- [ ] Zoom percentage shown in toolbar (fit, 50%, 100%, 200%, ...)
- [ ] "Fit to window" button / Ctrl+Shift+0
- [ ] Middle-mouse-drag or Space+drag to pan the canvas
- [ ] Zoom is per-panel state, not saved to the project file

## 4.11 Page Management in Editor

- [ ] Page tabs at the top of the editor (switch pages by clicking)
- [ ] Add new page button (+ tab)
- [ ] Rename page (double-click tab)
- [ ] Delete page (right-click tab)
- [ ] Drag tabs to reorder pages
- [ ] Page thumbnail previews in the page list

## 4.12 Canvas vs Preview Split View

- [ ] Toggle between "editor mode" (interactive drag-and-drop) and "preview mode" (running WASM)
- [ ] Side-by-side split: editor left, live preview right
- [ ] Preview panel auto-reloads when editor changes are saved
