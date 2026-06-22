// @ts-check
/// <reference lib="dom" />
"use strict";

/**
 * EmbeddedFlow Webview — LVGL canvas renderer
 *
 * Communication protocol (host → webview):
 *   { type: "load",  payload: WebviewLoadPayload }
 *       — includes project (see `EmbfProject`; `display.round` enables circular preview clip), layout, WASM URIs;
 *       — optional suppressLoadingSpinner (soft JSON-only refresh),
 *       — optional selectedComponentIds: string[] (or legacy selectedComponentId) to restore overlay selection after reload
 *   { type: "error", message: string }
 *   { type: "historyState", canUndo: boolean, canRedo: boolean }
 *   { type: "symbolIndexUpdate", status, summary }
 *   { type: "symbolSearchResult", requestId, status, summary, message?, nodes[] }
 *   { type: "symbolMembersResult", requestId, status, summary, message?, members[] }
 *
 * Communication protocol (webview → host):
 *   …
 *   { type: "searchSymbols", requestId, query?, limit? }
 *   { type: "getSymbolMembers", requestId, name, filePath?, line? }
 *   { type: "ready" }
 *   { type: "log", level: "info"|"warn"|"error", text: string }
 *   { type: "addWidget", pageIndex: number, widgetType: string }
 *   { type: "moveWidget", pageIndex: number, componentId: string, x: number, y: number } — single widget (parent-relative)
 *   { type: "bulkMoveWidgets", pageIndex: number, moves: [{ componentId, absX, absY }, ...] } — design overlay absolute canvas coords
 *   { type: "updateWidget", pageIndex: number, componentId: string, patch: object }
 *   { type: "bulkPatchWidgets", pageIndex: number, updates: [{ componentId, patch }, ...] }
 *   { type: "updatePage", pageIndex: number, patch: object }
 *   { type: "pickCodegenOutputFolder", pageIndex: number }
 *   { type: "pickImageSource", pageIndex: number, componentId: string }
 *   { type: "deleteWidget", pageIndex: number, componentId: string }
 *   { type: "bulkDeleteWidgets", pageIndex: number, componentIds: string[] }
 *   { type: "duplicateWidgets", pageIndex: number, componentIds: string[] }
 *   { type: "pasteWidgets", pageIndex: number, components: object[] }
 *   { type: "combineWidgets", pageIndex: number, componentIds: string[] } — sibling widgets → one container
 *   { type: "ungroupWidget", pageIndex: number, componentId: string } — container/panel → children lifted to parent
 *   { type: "saveGroupToLibrary", pageIndex: number, componentId: string }
 *   { type: "insertLibraryComponent", pageIndex: number, libraryId: string }
 *   { type: "removeLibraryEntry", libraryId: string }
 *   { type: "undo", pageIndex: number, selectedComponentIds?: string[] }
 *   { type: "redo", pageIndex: number, selectedComponentIds?: string[] }
 *
 * Design overlay UX: rubber-band marquee on empty-canvas drag (replace selection; Shift = union;
 * Ctrl/Cmd = toggle hits vs selection). Movement below threshold: plain ⇒ page inspector; with modifiers ⇒ noop.
 * Grouped widgets (container/panel with children): single click selects the whole group; double-click or
 * inspector “Edit contents” enters group-edit mode to select/move children independently (Esc or Done to exit).
 */

// ── VSCode API ────────────────────────────────────────────────────────────────
const vscode = acquireVsCodeApi();

function log(level, text) {
    vscode.postMessage({ type: "log", level, text });
}

// ── DOM refs ──────────────────────────────────────────────────────────────────
const canvas = /** @type {HTMLCanvasElement | null} */ (document.getElementById("lvgl-canvas"));
const ctx = canvas?.getContext("2d") ?? null;
const designOverlay = /** @type {HTMLCanvasElement | null} */ (document.getElementById("design-overlay"));
const designCtx = designOverlay?.getContext("2d") ?? null;
const designModeCheck = /** @type {HTMLInputElement | null} */ (document.getElementById("design-mode"));
const errorOverlay = document.getElementById("error-overlay");
const loadingOverlay = document.getElementById("loading-overlay");
const pageSelect = document.getElementById("page-select");
const leftSidebar = document.getElementById("left-sidebar");
const sidebarRail = document.getElementById("sidebar-rail");
const sidebarPanel = document.getElementById("sidebar-panel");
const sidebarPanelTitle = document.getElementById("sidebar-panel-title");
const sidebarPanelComponents = document.getElementById("sidebar-panel-components");
const pageListEl = document.getElementById("page-list");
const btnPageAdd = document.getElementById("btn-page-add");
const btnPageRemove = document.getElementById("btn-page-remove");
const btnPageRename = document.getElementById("btn-page-rename");
const canvasContainer = document.getElementById("canvas-container");
const statusEl = document.getElementById("status");
const inspectorEmpty = document.getElementById("inspector-empty");
const inspectorForm = document.getElementById("inspector-form");
const inspectorDelete = document.getElementById("inspector-delete");
const btnUndo = document.getElementById("btn-undo");
const btnRedo = document.getElementById("btn-redo");
const btnGenerateCode = document.getElementById("btn-generate-code");
const btnNewProject = document.getElementById("btn-new-project");
const previewZoomSelect = /** @type {HTMLSelectElement | null} */ (
    document.getElementById("preview-zoom")
);
const toolbarWidgetSelect = /** @type {HTMLSelectElement | null} */ (
    document.getElementById("toolbar-widget-select")
);
const previewLocaleSelect = /** @type {HTMLSelectElement | null} */ (
    document.getElementById("preview-locale")
);
const designGridCheck = /** @type {HTMLInputElement | null} */ (document.getElementById("design-grid"));
const designRulersCheck = /** @type {HTMLInputElement | null} */ (document.getElementById("design-rulers"));
const rulerTop = /** @type {HTMLCanvasElement | null} */ (document.getElementById("ruler-top"));
const rulerLeft = /** @type {HTMLCanvasElement | null} */ (document.getElementById("ruler-left"));
const btnThemeToggle = document.getElementById("btn-theme-toggle");
const btnPlayAnimations = document.getElementById("btn-play-animations");
const widgetTreeEl = document.getElementById("widget-tree");
const paletteSearch = /** @type {HTMLInputElement | null} */ (document.getElementById("palette-search"));
const previewBezelCheck = /** @type {HTMLInputElement | null} */ (document.getElementById("preview-bezel"));
const insertWidgetPicker = document.getElementById("insert-widget-picker");
const btnOpenProjectSettings = document.getElementById("btn-open-project-settings");

const PALETTE_DRAG_MIME = "application/x-embeddedflow-widget";

/** @type {number} */
const displayWrapper = document.getElementById("display-wrapper");
const imagePreviewLayer = document.getElementById("image-preview-layer");
const toolbarShell = document.getElementById("toolbar-shell");
const btnToggleToolbar = document.getElementById("btn-toggle-toolbar");
const propertyInspector = document.getElementById("property-inspector");
const btnToggleInspector = document.getElementById("btn-toggle-inspector");
const btnToggleLeftSidebar = document.getElementById("btn-toggle-left-sidebar");

/**
 * Sidebar category rail → parallel panel.
 * MUST stay in sync with `SIDEBAR_CATEGORIES` in `src/sidebarCategories.ts`.
 * `setSidebarCategory` early-returns on any id missing from this map, so unlisted
 * categories silently render dead rail buttons.
 */
const SIDEBAR_PANEL_LABELS = {
    components: "Components",
    hierarchy: "Tree",
    pages: "Pages",
    settings: "Settings",
    flow: "Flow"
};
const SIDEBAR_PANEL_WIDE = new Set(["pages", "settings", "hierarchy"]);
const SIDEBAR_PANEL_MEDIUM = "components";
const flowKind = /** @type {HTMLSelectElement | null} */ (document.getElementById("flow-kind"));
const flowFromPage = /** @type {HTMLSelectElement | null} */ (document.getElementById("flow-from-page"));
const flowComponentFields = document.getElementById("flow-component-fields");
const flowSwipeFields = document.getElementById("flow-swipe-fields");
const flowComponent = /** @type {HTMLSelectElement | null} */ (document.getElementById("flow-component"));
const flowTrigger = /** @type {HTMLSelectElement | null} */ (document.getElementById("flow-trigger"));
const flowSwipeDirection = /** @type {HTMLSelectElement | null} */ (document.getElementById("flow-swipe-direction"));
const flowToPage = /** @type {HTMLSelectElement | null} */ (document.getElementById("flow-to-page"));
const flowAnim = /** @type {HTMLSelectElement | null} */ (document.getElementById("flow-anim"));
const flowTime = /** @type {HTMLInputElement | null} */ (document.getElementById("flow-time"));
const btnFlowAdd = document.getElementById("btn-flow-add");
const btnFlowCancelEdit = document.getElementById("btn-flow-cancel-edit");
const flowGraphWrap = document.getElementById("flow-graph-wrap");
const flowGraphCanvas = /** @type {HTMLCanvasElement | null} */ (document.getElementById("flow-graph-canvas"));
const btnFlowAddLink = document.getElementById("btn-flow-add-link");
const flowLinkHint = document.getElementById("flow-link-hint");
const flowPageInspector = document.getElementById("flow-page-inspector");
const flowPageInspectorTitle = document.getElementById("flow-page-inspector-title");
const btnFlowInspectorClose = document.getElementById("btn-flow-inspector-close");
const flowPageTransitionsEl = document.getElementById("flow-page-transitions");
const btnFlowNewTransition = document.getElementById("btn-flow-new-transition");
const flowTransitionEditor = document.getElementById("flow-transition-editor");
const flowTransitionEditorTitle = document.getElementById("flow-transition-editor-title");
const btnFlowOpenPagePreview = document.getElementById("btn-flow-open-page-preview");
const workspacePanelPreview = document.getElementById("workspace-panel-preview");
const workspacePanelFlow = document.getElementById("workspace-panel-flow");
const workspaceTabsListEl = document.getElementById("workspace-tabs-list");
const btnWorkspaceTabAdd = document.getElementById("btn-workspace-tab-add");

/** Minimum pointer travel (px) to treat as a page swipe in preview. */
const PAGE_SWIPE_MIN_PX = 48;
/** @type {ReturnType<typeof setTimeout> | null} */
let inspectorDebounce = null;
let inspectorSyncing = false;
/** Absolute codegen output dir from host (project.outputPath / workspace / ui_output). */
let codegenOutputResolved = "";
/** Absolute firmware root from host. */
let firmwarePathResolved = "";
/** compile_commands.json path when linked. */
let compileCommandsPath = "";
/** clangd connection status for firmware symbol search (Phase 2). */
let symbolIndexStatus = "idle";
let symbolIndexSummary = "";
/** Pending symbol search / member requests (requestId → resolver). */
let symbolRequestSeq = 0;
/** @type {Map<string, (msg: object) => void>} */
const symbolRequestWaiters = new Map();

/**
 * Search firmware symbols via extension host (clangd index). Phase 2 step 3.1.
 * @param {string} query
 * @param {{ limit?: number; kinds?: string[] }} [opts]
 * @returns {Promise<{ nodes: object[]; status: string; summary: string; message?: string }>}
 */
function searchFirmwareSymbols(query, opts = {}) {
    const requestId = String(++symbolRequestSeq);
    const limit = opts.limit ?? 80;
    const kinds = Array.isArray(opts.kinds) && opts.kinds.length ? opts.kinds : undefined;
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            symbolRequestWaiters.delete(requestId);
            reject(new Error("Symbol search timed out"));
        }, 60_000);
        symbolRequestWaiters.set(requestId, msg => {
            clearTimeout(timer);
            resolve({
                nodes: Array.isArray(msg.nodes) ? msg.nodes : [],
                status: typeof msg.status === "string" ? msg.status : "error",
                summary: typeof msg.summary === "string" ? msg.summary : "",
                message: typeof msg.message === "string" ? msg.message : undefined
            });
        });
        vscode.postMessage({ type: "searchSymbols", requestId, query, limit, kinds });
    });
}

/**
 * Struct / union / class members for a symbol (clangd documentSymbol + completion).
 * @param {{ name: string; filePath?: string; line?: number }} target
 * @returns {Promise<{ members: object[]; status: string; summary: string; message?: string }>}
 */
function fetchFirmwareSymbolMembers(target) {
    const requestId = String(++symbolRequestSeq);
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            symbolRequestWaiters.delete(requestId);
            reject(new Error("Symbol members timed out"));
        }, 60_000);
        symbolRequestWaiters.set(requestId, msg => {
            clearTimeout(timer);
            resolve({
                members: Array.isArray(msg.members) ? msg.members : [],
                status: typeof msg.status === "string" ? msg.status : "error",
                summary: typeof msg.summary === "string" ? msg.summary : "",
                message: typeof msg.message === "string" ? msg.message : undefined
            });
        });
        vscode.postMessage({
            type: "getSymbolMembers",
            requestId,
            name: target.name,
            filePath: target.filePath,
            line: target.line
        });
    });
}

function dispatchSymbolRequestResult(msg) {
    const requestId = typeof msg.requestId === "string" ? msg.requestId : "";
    const waiter = symbolRequestWaiters.get(requestId);
    if (!waiter) {
        return;
    }
    symbolRequestWaiters.delete(requestId);
    waiter(msg);
}

// ── Runtime state ─────────────────────────────────────────────────────────────
/** @type {any} Current Emscripten module instance */
let WasmModule = null;
/** @type {number} rAF handle for the main loop */
let rafHandle = null;
/** @type {boolean} */
let wasmReady = false;
/** @type {number} */
let displayWidth = 0;
/** @type {number} */
let displayHeight = 0;
/** @type {Record<string, string>} image asset id → webview URI from host */
let imageAssetUris = {};

/** Circular panel clip when `project.display.round` is true — preview `#display-wrapper` only. */
let displayRound = false;

/**
 * Preview-only rendering (WASM stays at logical panel size).
 * Device bit depth / color format from JSON apply to generated firmware, not here.
 */
/** @type {HTMLCanvasElement | null} 1:1 LVGL framebuffer */
let frameCanvas = null;
/** @type {CanvasRenderingContext2D | null} */
let frameCtx = null;
/** CSS pixels per logical LVGL pixel (0.1–4). */
let previewZoom = 1;
/** @type {"auto" | number} */
let previewZoomMode = "auto";

const PREVIEW_ZOOM_MIN = 0.1;
const PREVIEW_ZOOM_MAX = 4;

function formatPreviewZoomPct(zoom) {
    return `${Math.round(zoom * 100)}%`;
}
/** @type {ResizeObserver | null} */
let previewLayoutObserver = null;
/** @type {number} */
let previewLayoutResizeRaf = 0;
/** @type {import("../src/types/embf").EmbfProject | null} */
let currentProject = null;
/** @type {{ defaultLocale: string, locales: Record<string, Record<string, string>>, keys?: string[], localeMeta?: Record<string, { direction?: string }> } | null} */
let currentStringsRes = null;
/** @type {string[]} */
let stringResourceKeys = [];
/** @type {string} */
let stringsResLoadError = "";
/** Preview locale override (empty = use strings.res defaultLocale). */
let previewLocale = "";
/** Avoid stacking locale refresh work on the main thread (prevents UI freeze). */
let previewLocaleRefreshScheduled = false;
/** @type {Map<string, string>} groupKey → active button id */
const previewButtonGroupState = new Map();
/** Navigation stack for nav_push / nav_pop preview (N5). */
const previewNavStack = [];
/** Keep grid descriptor WASM buffers alive per container id. */
const gridDscStore = new Map();

/**
 * Closable workspace tabs (page previews + optional navigation flow).
 * Must be declared before early `ready` / `handleLoad`.
 * @typedef {{ id: string, kind: "page", pageId: string } | { id: string, kind: "flow" }} WorkspaceTabEntry
 */
/** @type {WorkspaceTabEntry[]} */
let workspaceTabs = [];
/** @type {string} */
let activeWorkspaceTabId = "";
let workspaceTabIdSeq = 0;

/** @type {Map<string, { screenPtr: number, idToObjPtr: Map<string, number>, objPtrToId: Map<number, string> }>} */
const pageScreenCache = new Map();

/** LVGL `lv_screen_load_anim_t` values (must match lv_display.h). */
const LV_SCREEN_LOAD_ANIM = {
    none: 0,
    over_left: 1,
    over_right: 2,
    over_top: 3,
    over_bottom: 4,
    move_left: 5,
    move_right: 6,
    move_top: 7,
    move_bottom: 8,
    fade_in: 9,
    fade_out: 10,
    out_left: 11,
    out_right: 12,
    out_top: 13,
    out_bottom: 14
};

function screenLoadAnimToLv(anim) {
    if (!anim || anim === "none") {
        return LV_SCREEN_LOAD_ANIM.none;
    }
    return LV_SCREEN_LOAD_ANIM[anim] ?? LV_SCREEN_LOAD_ANIM.none;
}

function clearPageScreenCache() {
    /* Drop JS handles only — never lv_obj_delete() the active screen (crashes LVGL/WASM). */
    pageScreenCache.clear();
    gridDscStore.clear();
}

function invalidatePageScreen(pageId) {
    pageScreenCache.delete(pageId);
}
/** @type {string | null} last loaded wasm js uri */
let loadedWasmJsUri = null;

/**
 * `null` = use JSON `project.theme.dark`; otherwise a transient preview-only dark override
 * set by the `set_theme` flow action (toolbar toggle persists to JSON instead, see below).
 */
let previewDarkOverride = null;

/** Last display size passed to `_embf_init` for the current WASM module. */
let lastWasmInitWidth = 0;
let lastWasmInitHeight = 0;

/** Max display width/height (matches embf.schema.json and preview WASM limits). */
const DISPLAY_DIMENSION_MAX = 4096;

/** Tear down LVGL and re-init the display (safe resize without reloading the WASM module). */
function resizeWasmPreview(width, height, darkTheme) {
    if (!WasmModule || !wasmReady) {
        return;
    }
    const w = Math.round(Number(width));
    const h = Math.round(Number(height));
    if (
        !Number.isFinite(w) ||
        !Number.isFinite(h) ||
        w < 1 ||
        h < 1 ||
        w > DISPLAY_DIMENSION_MAX ||
        h > DISPLAY_DIMENSION_MAX
    ) {
        log("warn", `resizeWasmPreview: ignored invalid size ${width}×${height}`);
        return;
    }
    stopLoop();
    cancelPreviewTransition();
    clearPageScreenCache();
    idToObjPtr.clear();
    objPtrToId.clear();
    frameCanvas = null;
    frameCtx = null;

    const theme = currentProject?.theme ?? {};
    const primaryArgb = theme.primaryColor ? parseColor(theme.primaryColor) : 0;
    const secondaryArgb = theme.secondaryColor ? parseColor(theme.secondaryColor) : 0;

    if (typeof WasmModule._embf_deinit === "function") {
        WasmModule._embf_deinit();
    }
    WasmModule._embf_init(w, h, darkTheme ? 1 : 0, primaryArgb, secondaryArgb);
    lastWasmInitWidth = w;
    lastWasmInitHeight = h;
    if (previewZoomMode === "auto") {
        updatePreviewZoom();
    }
    applyPreviewLayout();
}

/** Pump LVGL and refresh the RGBA framebuffer after screen build / resize. */
function pumpPreviewRedraw(frames = 4) {
    const wasm = WasmModule;
    if (!wasm || !wasmReady) {
        return;
    }
    if (typeof wasm._embf_force_redraw === "function") {
        wasm._embf_force_redraw();
    }
    const tick = wasm._embf_main_loop ?? wasm._mainLoop;
    if (typeof tick !== "function") {
        return;
    }
    for (let i = 0; i < frames; i++) {
        tick();
    }
}

/** Skip duplicate rebuild when `pageSelect.value` is set from code (navigate). */
let pageSelectProgrammatic = false;
let pageWidgetPickerProgrammatic = false;

/** While true, the main loop must not blit WASM (JS drives the transition frames). */
let previewJsTransition = false;
/** @type {number | null} */
let previewTransitionRaf = null;

/** Pointer trail for page-swipe detection in run mode (design overlay off). */
/** @type {{ ox: number, oy: number, x: number, y: number } | null} */
let canvasSwipeTrack = null;

/** Active page index (0-based); preserved across project reloads. */
let currentPageIndex = 0;

/** Design mode: select and drag widgets (updates .embf); off = LVGL interaction. */
let designMode = true;

/** Multi-select order (last clicked is “primary” for single-widget inspector). */
/** @type {string[]} */
let selectedComponentOrder = [];

/** When set, design overlay edits children inside this container/panel (Esc / Done to exit). */
/** @type {string | null} */
let groupEditContainerId = null;

/** When true, inspector edits the active page / project theme instead of a widget. */
let inspectorShowingPage = false;

/**
 * Group drag: screen-space delta applied to every selected widget’s absolute origin.
 * @type {{ pointerX: number; pointerY: number; dx: number; dy: number; items: { id: string; startAbsX: number; startAbsY: number; width: number; height: number }[] } | null}
 */
let dragState = null;

/**
 * Pointer down on a widget before movement exceeds threshold (selection only until then).
 * @type {{ pointerX: number; pointerY: number; items: { id: string; startAbsX: number; startAbsY: number; width: number; height: number }[] } | null}
 */
let pendingDrag = null;

/**
 * Rubber-band selection on empty overlay (logical display coords).
 * @type {{ ox: number; oy: number; x: number; y: number; shift: boolean; ctrl: boolean } | null}
 */
let marqueeState = null;

/** At least one axis must exceed this delta (logical px) to count as marquee vs empty click */
const MARQUEE_DRAG_THRESHOLD = 5;

/** Movement (logical px) before a pointer down becomes a drag instead of a click */
const DESIGN_DRAG_THRESHOLD = 3;

/** Design-mode magnetic snap: align edges/centers when within this distance (logical px). */
const DESIGN_SNAP_THRESHOLD = 8;

/** Snap positions/sizes to this grid when #design-grid is checked. */
const DESIGN_GRID_SIZE = 16;
let designGridEnabled = false;
let designRulersEnabled = false;
const RULER_THICKNESS = 20;
/** @type {object[] | null} Deep-cloned components for copy/paste */
let designClipboard = null;
/**
 * Resize drag (single selection): handle id + starting parent-relative box.
 * @type {{ id: string, handle: string, startX: number, startY: number, startW: number, startH: number, pointerX: number, pointerY: number, parentAbsX: number, parentAbsY: number } | null}
 */
let resizeState = null;
const RESIZE_HANDLE_PX = 7;
const MIN_WIDGET_SIZE = 12;

/**
 * Maps WASM object pointer (number) → component ID string.
 * Rebuilt every time a screen is constructed.
 * @type {Map<number, string>}
 */
let objPtrToId = new Map();

/**
 * Maps component ID → WASM object pointer.
 * @type {Map<string, number>}
 */
let idToObjPtr = new Map();
/** Reused WASM heap buffer for `embf_obj_get_screen_coords` (4 × int32). */
let imageOverlayBoundsBuf = 0;

/**
 * Cached pointer values for embf_poll_* result slots.
 * Resolved once after WASM loads.
 */
let pPollObj   = 0; // uint32 WASM pointer address of g_poll_obj
let pPollCode  = 0; // uint32 WASM pointer address of g_poll_code
let pPollValue = 0; // int32  WASM pointer address of g_poll_value

/** LVGL 9.x `lv_event_code_t` ordinals — must match `lvgl/src/misc/lv_event.h` (first member = 0). */
const LV_EVENT_CLICKED       = 10; /* after LONG_PRESSED_REPEAT */
const LV_EVENT_LONG_PRESSED  = 8;
const LV_EVENT_VALUE_CHANGED = 35; /* after DRAW_TASK_ADDED */

/** LVGL `lv_part_t` — `LV_PART_INDICATOR` for bar/slider fill (see lv_obj_style.h) */
const LV_PART_INDICATOR = 0x020000;

// ── Entry point ────────────────────────────────────────────────────────────────
/** Ignore stale async `handleLoad` when a newer project message arrives. */
let loadGeneration = 0;

window.addEventListener("message", event => {
    const msg = event.data;
    if (msg.type === "load") {
        const gen = ++loadGeneration;
        void handleLoad(msg.payload, gen).catch(e => {
            if (gen !== loadGeneration) {
                return;
            }
            showError(`Load failed: ${e?.message ?? e}`);
            log("error", `handleLoad unhandled: ${e}`);
            showLoading(false);
        });
    } else if (msg.type === "error") {
        showError(msg.message);
    } else if (msg.type === "historyState") {
        updateHistoryButtons(!!msg.canUndo, !!msg.canRedo);
    } else if (msg.type === "symbolIndexUpdate") {
        symbolIndexStatus = typeof msg.status === "string" ? msg.status : "idle";
        symbolIndexSummary = typeof msg.summary === "string" ? msg.summary : "";
        if (inspectorShowingPage) {
            renderInspector();
        }
    } else if (msg.type === "symbolSearchResult" || msg.type === "symbolMembersResult") {
        dispatchSymbolRequestResult(msg);
    }
});

function isBenignWebviewError(message) {
    const m = String(message ?? "");
    return (
        m.includes("ResizeObserver loop") ||
        m.includes("ResizeObserver loop limit")
    );
}

window.addEventListener("error", ev => {
    const text = ev.message || String(ev.error ?? "Unknown error");
    if (isBenignWebviewError(text)) {
        return;
    }
    log("error", `webview: ${text}`);
    showError(text);
});
window.addEventListener("unhandledrejection", ev => {
    const text = ev.reason?.message ?? String(ev.reason ?? "Unhandled promise rejection");
    if (isBenignWebviewError(text)) {
        return;
    }
    log("error", `webview: ${text}`);
    showError(text);
});

// Host queues `load` until this fires — do not wait for palette/flow/inspector wiring.
if (!canvas) {
    log("error", "Preview DOM missing #lvgl-canvas — reload the window");
}
showLoading(false);
vscode.postMessage({ type: "ready" });

function updateHistoryButtons(canUndo, canRedo) {
    if (btnUndo) {
        btnUndo.disabled = !canUndo;
    }
    if (btnRedo) {
        btnRedo.disabled = !canRedo;
    }
}

function postUndo() {
    vscode.postMessage({
        type: "undo",
        pageIndex: currentPageIndex,
        selectedComponentIds: selectedComponentOrder.length ? [...selectedComponentOrder] : undefined
    });
}

function postRedo() {
    vscode.postMessage({
        type: "redo",
        pageIndex: currentPageIndex,
        selectedComponentIds: selectedComponentOrder.length ? [...selectedComponentOrder] : undefined
    });
}

if (btnUndo) {
    btnUndo.addEventListener("click", () => postUndo());
}
if (btnGenerateCode) {
    btnGenerateCode.addEventListener("click", () => {
        vscode.postMessage({ type: "generateCode" });
    });
}
if (btnNewProject) {
    btnNewProject.addEventListener("click", () => {
        vscode.postMessage({ type: "newProject" });
    });
}
if (btnRedo) {
    btnRedo.addEventListener("click", () => postRedo());
}

function applyEmbfThemeFromProject(project) {
    if (!wasmReady || !WasmModule) return;
    const theme = project.theme ?? {};
    const dark =
        previewDarkOverride !== null ? (previewDarkOverride ? 1 : 0) : (theme.dark ? 1 : 0);
    const primaryArgb   = theme.primaryColor   ? parseColor(theme.primaryColor)   : 0;
    const secondaryArgb = theme.secondaryColor ? parseColor(theme.secondaryColor) : 0;
    WasmModule._embf_set_theme(dark, primaryArgb, secondaryArgb);
}

// ── Load handler ───────────────────────────────────────────────────────────────
async function handleLoad(payload, generation = loadGeneration) {
    if (generation !== loadGeneration) {
        return;
    }
    if (!payload?.project) {
        showError("Preview load payload is missing project data.");
        return;
    }
    currentProject = payload.project;
    if (payload.stringsRes && typeof payload.stringsRes === "object") {
        currentStringsRes = payload.stringsRes;
        stringResourceKeys = Array.isArray(payload.stringsRes.keys) ? payload.stringsRes.keys.slice() : [];
    } else {
        currentStringsRes = null;
        stringResourceKeys = [];
    }
    previewNavStack.length = 0;
    stringsResLoadError = typeof payload.stringsResError === "string" ? payload.stringsResError : "";
    populatePreviewLocaleSelect(
        payload.stringsResLocaleIds ??
            (currentStringsRes ? Object.keys(currentStringsRes.locales).sort() : []),
        currentStringsRes?.defaultLocale ?? ""
    );
    codegenOutputResolved =
        typeof payload.codegenOutputResolved === "string" ? payload.codegenOutputResolved : "";
    firmwarePathResolved =
        typeof payload.firmwarePathResolved === "string" ? payload.firmwarePathResolved : "";
    compileCommandsPath =
        typeof payload.compileCommandsPath === "string" ? payload.compileCommandsPath : "";
    symbolIndexStatus =
        typeof payload.symbolIndexStatus === "string" ? payload.symbolIndexStatus : "idle";
    symbolIndexSummary =
        typeof payload.symbolIndexSummary === "string" ? payload.symbolIndexSummary : "";
    displayRound = !!(currentProject?.display && currentProject.display.round === true);
    syncPreviewBezel();
    displayWidth = payload.displayWidth;
    displayHeight = payload.displayHeight;
    dragState = null;
    pendingDrag = null;
    marqueeState = null;

    /** Same WASM URI + running module → JSON-only rebalance (inspector debounced refresh): skip shimmer. */
    const quietReload =
        !!payload.suppressLoadingSpinner &&
        wasmReady &&
        WasmModule !== null &&
        loadedWasmJsUri !== null &&
        payload.wasmJsUri === loadedWasmJsUri;

    // The toolbar theme-toggle now persists to `project.theme.dark` directly (see
    // btnThemeToggle handler), so any preview state is reset every reload — the JSON value
    // is the source of truth. `previewDarkOverride` is only used by the `set_theme` flow
    // action for in-session runtime theming.
    previewDarkOverride = null;

    const typingInInspector = isInspectorFieldFocused();
    if (!quietReload && !typingInInspector) {
        showLoading(true);
    }
    hideError();

    try {
    updatePreviewZoom();
    applyPreviewLayout();

    // Populate page selector and stay on the current page when possible
    const pages = Array.isArray(payload.project.pages) ? payload.project.pages : [];
    if (!pages.length) {
        showError("Project has no pages — check the .embf file parses correctly.");
        return;
    }
    const wasFlowTabActive = isWorkspaceFlowActive();
    const preservedFlowPageIndex = _fgSelectedPageIndex;
    const requestedPage =
        typeof payload.pageIndex === "number" && Number.isFinite(payload.pageIndex)
            ? payload.pageIndex
            : currentPageIndex;
    populatePageSelect(pages);
    currentPageIndex = Math.min(Math.max(0, requestedPage), Math.max(0, pages.length - 1));
    if (!quietReload) {
        if (wasFlowTabActive) {
            pruneWorkspaceTabs();
            renderWorkspaceTabs();
        } else {
            resetWorkspaceTabsForProject(currentPageIndex);
        }
    } else {
        pruneWorkspaceTabs();
        renderWorkspaceTabs();
    }
    refreshLibraryPalette();
    renderPageList();
    populateFlowForm();
    renderFlowPanel();
    if (wasFlowTabActive && preservedFlowPageIndex >= 0 && preservedFlowPageIndex < pages.length) {
        _fgSelectedPageIndex = preservedFlowPageIndex;
        if (flowPageInspector) {
            flowPageInspector.hidden = false;
        }
        if (btnFlowOpenPagePreview) {
            btnFlowOpenPagePreview.hidden = false;
        }
        const page = pages[preservedFlowPageIndex];
        if (flowPageInspectorTitle && page) {
            flowPageInspectorTitle.textContent = page.name || page.id;
        }
        renderFlowPageTransitions(preservedFlowPageIndex);
        renderFlowGraph();
    }
    if (pageSelect) {
        pageSelectProgrammatic = true;
        pageSelect.value = String(currentPageIndex);
        pageSelectProgrammatic = false;
    }

    // Load WASM module (only if URI changed)
    if (payload.wasmJsUri !== loadedWasmJsUri) {
        stopLoop();
        wasmReady = false;
        WasmModule = null;
        loadedWasmJsUri = payload.wasmJsUri;
        try {
            await loadWasm(payload.wasmJsUri, payload.wasmBinUri, displayWidth, displayHeight, payload.project.theme?.dark ?? false);
        } catch (e) {
            showError(`Failed to load WASM: ${e.message ?? e}`);
            log("error", `WASM load error: ${e}`);
            return;
        }
    }

    if (
        wasmReady &&
        loadedWasmJsUri === payload.wasmJsUri &&
        (displayWidth !== lastWasmInitWidth || displayHeight !== lastWasmInitHeight)
    ) {
        resizeWasmPreview(displayWidth, displayHeight, payload.project.theme?.dark ?? false);
    }

    cancelPreviewTransition();
    clearPageScreenCache();

    imageAssetUris = {};
    if (Array.isArray(payload.imageAssets)) {
        for (const a of payload.imageAssets) {
            if (a && typeof a.id === "string" && typeof a.uri === "string") {
                imageAssetUris[a.id] = a.uri;
            }
        }
    }

    buildUiFromProject(currentProject, currentPageIndex);
    pumpPreviewRedraw(6);
    scheduleImageOverlaySync();

    resizeDesignOverlay();
    setDesignPointerMode();
    if (Array.isArray(payload.selectedComponentIds) && payload.selectedComponentIds.length > 0) {
        inspectorShowingPage = false;
        const page = currentProject.pages[currentPageIndex];
        selectedComponentOrder = payload.selectedComponentIds.filter(
            id => typeof id === "string" && page && findComponentById(page.components, id)
        );
    } else if (typeof payload.selectedComponentId === "string" && payload.selectedComponentId) {
        inspectorShowingPage = false;
        const page = currentProject.pages[currentPageIndex];
        const sid = payload.selectedComponentId;
        selectedComponentOrder =
            page && findComponentById(page.components, sid) ? [sid] : [];
    }
    drawDesignOverlay();
    // Avoid blowing away focused inspector inputs during preview reloads while typing.
    if (!typingInInspector) {
        renderInspector();
        renderToolbarWidgetSelect();
        renderWidgetTree();
    }
    } catch (e) {
        if (generation !== loadGeneration) {
            return;
        }
        showError(`Preview error: ${e.message ?? e}`);
        log("error", `handleLoad: ${e}`);
    } finally {
        if (generation === loadGeneration) {
            showLoading(false);
        }
    }

    if (generation !== loadGeneration) {
        return;
    }

    if (wasmReady) {
        hideError();
        if (isWorkspacePageActive()) {
            refreshPreviewLayoutAfterPanelChange();
            schedulePreviewAutoZoomReflowAfterLayout();
            pumpPreviewRedraw(4);
            drawDesignOverlay();
        }
    }

    const disp = currentProject.display;
    const depthHint =
        disp?.bitDepth && disp?.colorFormat
            ? ` · ${disp.bitDepth}-bit ${disp.colorFormat} (device)`
            : "";
    const roundHint = disp?.round ? " · round clip" : "";
    setStatus(
        `${currentProject.project.name} · LVGL ${currentProject.project.lvglVersion} · ${displayWidth}×${displayHeight} · ${formatPreviewZoomPct(previewZoom)}${depthHint}${roundHint}`
    );
    startLoop();
}

// ── Preview display quality (HiDPI + integer zoom; WASM unchanged) ───────────

function getPreviewDpr() {
    return Math.min(Math.max(1, Math.round(window.devicePixelRatio || 1)), 3);
}

/** Padding and ruler/bezel space reserved when fitting the display in the preview pane. */
function getPreviewFitInsets() {
    let pad = 24;
    if (canvasContainer?.classList.contains("show-bezel")) {
        pad += 32;
    }
    const rulerExtra = designRulersEnabled ? RULER_THICKNESS : 0;
    return { pad, rulerExtra };
}

/** Pane below workspace tabs — stable size for auto-fit (not the shrink-wrapped device frame). */
function getPreviewFitHost() {
    if (isWorkspacePageActive()) {
        const body = document.getElementById("workspace-body");
        if (body) {
            return body;
        }
        if (workspacePanelPreview) {
            return workspacePanelPreview;
        }
    }
    return canvasContainer;
}

function computeAutoZoom() {
    const fitHost = getPreviewFitHost();
    if (!fitHost || !displayWidth || !displayHeight) {
        return previewZoom > 0 ? previewZoom : 1;
    }
    const { pad, rulerExtra } = getPreviewFitInsets();
    const cw = fitHost.clientWidth - pad;
    const ch = fitHost.clientHeight - pad;
    // Layout not ready yet — avoid clamping to 10% on a transient tiny measure.
    if (cw < 120 || ch < 120) {
        return previewZoom >= 0.15 ? previewZoom : 1;
    }
    const totalW = displayWidth + rulerExtra;
    const totalH = displayHeight + rulerExtra;
    const zoomX = cw / totalW;
    const zoomY = ch / totalH;
    const zoom = Math.min(zoomX, zoomY, PREVIEW_ZOOM_MAX);
    return Math.max(PREVIEW_ZOOM_MIN, zoom);
}

function updatePreviewZoom() {
    if (previewZoomMode === "auto") {
        previewZoom = computeAutoZoom();
        return;
    }
    previewZoom = /** @type {number} */ (previewZoomMode);
}

function applyPreviewLayout() {
    if (!canvas || !displayWidth || !displayHeight) {
        return;
    }

    if (!frameCanvas) {
        frameCanvas = document.createElement("canvas");
        frameCtx = frameCanvas.getContext("2d");
    }
    frameCanvas.width = displayWidth;
    frameCanvas.height = displayHeight;

    const dpr = getPreviewDpr();
    const cssW = displayWidth * previewZoom;
    const cssH = displayHeight * previewZoom;
    const backingW = cssW * dpr;
    const backingH = cssH * dpr;

    canvas.width = backingW;
    canvas.height = backingH;
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;

    if (designOverlay) {
        designOverlay.width = displayWidth;
        designOverlay.height = displayHeight;
        designOverlay.style.width = `${cssW}px`;
        designOverlay.style.height = `${cssH}px`;
    }

    if (rulerTop) {
        rulerTop.width = Math.max(1, Math.round(cssW * dpr));
        rulerTop.height = RULER_THICKNESS * dpr;
        rulerTop.style.width = `${cssW}px`;
        rulerTop.style.height = `${RULER_THICKNESS}px`;
    }
    if (rulerLeft) {
        rulerLeft.width = RULER_THICKNESS * dpr;
        rulerLeft.height = Math.max(1, Math.round(cssH * dpr));
        rulerLeft.style.width = `${RULER_THICKNESS}px`;
        rulerLeft.style.height = `${cssH}px`;
    }
    drawRulers();

    if (displayWrapper) {
        displayWrapper.style.width = `${cssW}px`;
        displayWrapper.style.height = `${cssH}px`;
        const rulerPad = designRulersEnabled ? RULER_THICKNESS : 0;
        displayWrapper.style.marginTop = rulerPad ? `${rulerPad}px` : "";
        displayWrapper.style.marginLeft = rulerPad ? `${rulerPad}px` : "";
        // IMPORTANT: apply round clipping only to the actual rendered display layers,
        // not the wrapper itself. The rulers sit outside the display bounds (negative
        // top/left offsets), so clipping the wrapper hides rulers on round displays.
        const cpTargets = [canvas, imagePreviewLayer, designOverlay].filter(Boolean);
        if (displayRound && cssW > 0 && cssH > 0) {
            const r = Math.min(cssW, cssH) / 2;
            const cp = `circle(${r}px at ${cssW / 2}px ${cssH / 2}px)`;
            for (const el of cpTargets) {
                el.style.clipPath = cp;
                el.style.webkitClipPath = cp;
            }
            // Ensure wrapper itself doesn't clip children (rulers).
            displayWrapper.style.clipPath = "";
            displayWrapper.style.webkitClipPath = "";
        } else {
            for (const el of cpTargets) {
                el.style.clipPath = "";
                el.style.webkitClipPath = "";
            }
            displayWrapper.style.clipPath = "";
            displayWrapper.style.webkitClipPath = "";
        }
    }

    scheduleImageOverlaySync();
}

function schedulePreviewAutoZoomReflow() {
    if (previewLayoutResizeRaf) {
        cancelAnimationFrame(previewLayoutResizeRaf);
    }
    previewLayoutResizeRaf = requestAnimationFrame(() => {
        previewLayoutResizeRaf = 0;
        if (previewZoomMode !== "auto" || !isWorkspacePageActive()) {
            return;
        }
        const next = computeAutoZoom();
        if (Math.abs(next - previewZoom) > 0.0005) {
            previewZoom = next;
            applyPreviewLayout();
            drawDesignOverlay();
        }
    });
}

/** Re-measure after flex layout settles (initial open often reports a tiny pane once). */
function schedulePreviewAutoZoomReflowAfterLayout() {
    schedulePreviewAutoZoomReflow();
    requestAnimationFrame(() => {
        schedulePreviewAutoZoomReflow();
        requestAnimationFrame(schedulePreviewAutoZoomReflow);
    });
}

function initPreviewLayoutObserver() {
    if (previewLayoutObserver) {
        return;
    }
    const fitTarget = document.getElementById("workspace-body") ?? workspacePanelPreview;
    if (!fitTarget) {
        return;
    }
    previewLayoutObserver = new ResizeObserver(() => {
        schedulePreviewAutoZoomReflow();
    });
    previewLayoutObserver.observe(fitTarget);
    if (canvasContainer && fitTarget !== canvasContainer) {
        previewLayoutObserver.observe(canvasContainer);
    }
}

if (previewZoomSelect) {
    previewZoomSelect.addEventListener("change", () => {
        const raw = previewZoomSelect.value;
        if (raw === "auto") {
            previewZoomMode = "auto";
        } else {
            const n = parseFloat(raw);
            previewZoomMode =
                Number.isFinite(n) && n >= PREVIEW_ZOOM_MIN && n <= PREVIEW_ZOOM_MAX ? n : 1;
        }
        updatePreviewZoom();
        applyPreviewLayout();
        drawDesignOverlay();
        if (currentProject) {
            const disp = currentProject.display;
            const depthHint =
                disp?.bitDepth && disp?.colorFormat
                    ? ` · ${disp.bitDepth}-bit ${disp.colorFormat} (device)`
                    : "";
            const roundHint = disp?.round ? " · round clip" : "";
            setStatus(
                `${currentProject.project.name} · LVGL ${currentProject.project.lvglVersion} · ${displayWidth}×${displayHeight} · ${formatPreviewZoomPct(previewZoom)}${depthHint}${roundHint}`
            );
        }
    });
}

initPreviewLayoutObserver();

// ── Collapsible toolbar, widget palette & properties panel ─────────────────────

/** @type {{ toolbarCollapsed: boolean, leftSidebarCollapsed: boolean, inspectorCollapsed: boolean, sidebarCategory?: string }} */
let panelCollapseState = {
    toolbarCollapsed: false,
    leftSidebarCollapsed: false,
    inspectorCollapsed: false,
    sidebarCategory: "components"
};

/** Active category in the left rail (components, pages, …). */
let activeSidebarCategory = "components";

function loadPanelCollapseState() {
    const saved = vscode.getState();
    if (
        saved &&
        typeof saved === "object" &&
        saved.panelCollapse &&
        typeof saved.panelCollapse === "object"
    ) {
        const pc = /** @type {{ toolbarCollapsed?: boolean, paletteCollapsed?: boolean, leftSidebarCollapsed?: boolean, inspectorCollapsed?: boolean, sidebarCategory?: string }} */ (
            saved.panelCollapse
        );
        panelCollapseState = {
            toolbarCollapsed: !!pc.toolbarCollapsed,
            leftSidebarCollapsed: !!(pc.leftSidebarCollapsed ?? pc.paletteCollapsed),
            inspectorCollapsed: !!pc.inspectorCollapsed,
            sidebarCategory:
                typeof pc.sidebarCategory === "string" && pc.sidebarCategory in SIDEBAR_PANEL_LABELS
                    ? pc.sidebarCategory
                    : "components"
        };
        activeSidebarCategory = panelCollapseState.sidebarCategory ?? "components";
    }
}

function savePanelCollapseState() {
    const prev = vscode.getState();
    const base = prev && typeof prev === "object" ? prev : {};
    vscode.setState({ ...base, panelCollapse: panelCollapseState });
}

function refreshPreviewLayoutAfterPanelChange() {
    if (previewZoomMode === "auto") {
        updatePreviewZoom();
        applyPreviewLayout();
        drawDesignOverlay();
        schedulePreviewAutoZoomReflowAfterLayout();
        return;
    }
    applyPreviewLayout();
    drawDesignOverlay();
}

function applyPanelCollapseState(restoreLayoutOnly = false) {
    if (toolbarShell) {
        toolbarShell.classList.toggle("collapsed", panelCollapseState.toolbarCollapsed);
    }
    if (btnToggleToolbar) {
        const collapsed = panelCollapseState.toolbarCollapsed;
        btnToggleToolbar.setAttribute("aria-expanded", String(!collapsed));
        btnToggleToolbar.textContent = collapsed ? "▼ Show toolbar" : "▲ Hide toolbar";
        btnToggleToolbar.title = collapsed ? "Show toolbar" : "Hide toolbar";
    }
    if (leftSidebar) {
        leftSidebar.classList.toggle("collapsed", panelCollapseState.leftSidebarCollapsed);
    }
    if (btnToggleLeftSidebar) {
        const collapsed = panelCollapseState.leftSidebarCollapsed;
        btnToggleLeftSidebar.setAttribute("aria-expanded", String(!collapsed));
        btnToggleLeftSidebar.textContent = collapsed ? "›" : "‹";
        btnToggleLeftSidebar.title = collapsed ? "Show sidebar" : "Hide sidebar";
    }
    setSidebarCategory(activeSidebarCategory, false, { switchWorkspace: !restoreLayoutOnly });
    if (propertyInspector) {
        propertyInspector.classList.toggle("collapsed", panelCollapseState.inspectorCollapsed);
    }
    if (btnToggleInspector) {
        const collapsed = panelCollapseState.inspectorCollapsed;
        btnToggleInspector.setAttribute("aria-expanded", String(!collapsed));
        btnToggleInspector.textContent = collapsed ? "‹" : "›";
        btnToggleInspector.title = collapsed ? "Show properties panel" : "Hide properties panel";
    }
    refreshPreviewLayoutAfterPanelChange();
}

loadPanelCollapseState();
applyPanelCollapseState(true);

if (btnToggleToolbar) {
    btnToggleToolbar.addEventListener("click", () => {
        panelCollapseState.toolbarCollapsed = !panelCollapseState.toolbarCollapsed;
        savePanelCollapseState();
        applyPanelCollapseState();
    });
}

if (btnToggleInspector) {
    btnToggleInspector.addEventListener("click", () => {
        panelCollapseState.inspectorCollapsed = !panelCollapseState.inspectorCollapsed;
        savePanelCollapseState();
        applyPanelCollapseState();
    });
}

if (btnToggleLeftSidebar) {
    btnToggleLeftSidebar.addEventListener("click", () => {
        panelCollapseState.leftSidebarCollapsed = !panelCollapseState.leftSidebarCollapsed;
        savePanelCollapseState();
        applyPanelCollapseState();
    });
}

/**
 * @param {{ switchWorkspace?: boolean }} [options]
 *   When `switchWorkspace` is false, only the left sidebar panel changes (used on restore).
 */
function setSidebarCategory(categoryId, persist = true, options = {}) {
    if (!(categoryId in SIDEBAR_PANEL_LABELS)) {
        return;
    }
    const switchWorkspace = options.switchWorkspace !== false;
    activeSidebarCategory = categoryId;
    if (persist) {
        panelCollapseState.sidebarCategory = categoryId;
        savePanelCollapseState();
    }
    if (sidebarRail) {
        sidebarRail.querySelectorAll(".sidebar-rail-btn").forEach(btn => {
            if (!(btn instanceof HTMLButtonElement)) {
                return;
            }
            const id = btn.getAttribute("data-sidebar-panel");
            btn.classList.toggle("active", id === categoryId);
            btn.setAttribute("aria-selected", id === categoryId ? "true" : "false");
        });
    }
    document.querySelectorAll(".sidebar-panel-view").forEach(view => {
        if (!(view instanceof HTMLElement)) {
            return;
        }
        const id = view.getAttribute("data-sidebar-panel");
        view.hidden = id !== categoryId;
    });
    if (sidebarPanelTitle) {
        sidebarPanelTitle.textContent = SIDEBAR_PANEL_LABELS[categoryId] ?? categoryId;
    }
    if (sidebarPanel) {
        sidebarPanel.classList.toggle("wide", SIDEBAR_PANEL_WIDE.has(categoryId));
        sidebarPanel.classList.toggle("panel-medium", categoryId === SIDEBAR_PANEL_MEDIUM);
        sidebarPanel.hidden = categoryId === "flow";
    }
    if (categoryId === "pages") {
        renderPageList();
    }
    if (categoryId === "flow") {
        if (switchWorkspace) {
            openFlowWorkspaceTab(true);
        }
        populateFlowForm();
        renderFlowPanel();
    }
    if (categoryId === "hierarchy") {
        renderWidgetTree();
    }
    refreshPreviewLayoutAfterPanelChange();
}

if (sidebarRail) {
    sidebarRail.addEventListener("click", e => {
        const t = e.target;
        if (!(t instanceof Element)) {
            return;
        }
        const btn = t.closest(".sidebar-rail-btn[data-sidebar-panel]");
        if (!(btn instanceof HTMLButtonElement)) {
            return;
        }
        const id = btn.getAttribute("data-sidebar-panel");
        if (id) {
            setSidebarCategory(id);
        }
    });
}

// ── WASM loading ───────────────────────────────────────────────────────────────
/**
 * Dynamically loads the Emscripten JS glue + WASM binary.
 *
 * The script tag approach is used because VSCode webview CSP requires scripts
 * to be served from the extension's resource origin (cspSource). Dynamic script
 * injection works because `script-src` includes `${cspSource}` in the CSP header.
 */
async function loadWasm(jsUri, wasmBinUri, width, height, darkTheme) {
    // Remove any previously loaded WASM factory so we don't reuse stale state
    delete window.createEmbfRuntime;

    await injectScript(jsUri);

    const factory = window.createEmbfRuntime;
    if (typeof factory !== "function") {
        throw new Error(
            `WASM factory 'createEmbfRuntime' not found after loading:\n${jsUri}\n` +
            `Ensure embf_runtime.js was built correctly (see wasm-src/build.ps1).`
        );
    }

    const module = await factory({
        locateFile(file) {
            // Redirect the .wasm file lookup to the webview URI we already have
            if (file.endsWith(".wasm")) {
                return wasmBinUri;
            }
            return file;
        }
    });

    WasmModule = module;

    // Call embf_init to start LVGL
    if (typeof WasmModule._embf_init !== "function") {
        throw new Error("_embf_init not exported — check EXPORTED_FUNCTIONS in build.ps1");
    }

    const theme = currentProject?.theme ?? {};
    const primaryArgb   = theme.primaryColor   ? parseColor(theme.primaryColor)   : 0;
    const secondaryArgb = theme.secondaryColor ? parseColor(theme.secondaryColor) : 0;
    WasmModule._embf_init(width, height, darkTheme ? 1 : 0, primaryArgb, secondaryArgb);
    lastWasmInitWidth = width;
    lastWasmInitHeight = height;

    // Cache addresses of poll result slots (static C globals, stable for module lifetime)
    pPollObj   = WasmModule._embf_poll_obj_ptr();
    pPollCode  = WasmModule._embf_poll_code_ptr();
    pPollValue = WasmModule._embf_poll_value_ptr();

    wasmReady = true;
}

/**
 * Inject a <script src="uri"> and wait for it to load or error.
 * Re-uses the same element ID so repeated loads replace the previous one.
 */
function injectScript(uri) {
    return new Promise((resolve, reject) => {
        const existing = document.getElementById("__embf_wasm_script");
        if (existing) existing.remove();

        const script = document.createElement("script");
        script.id = "__embf_wasm_script";
        script.src = uri;
        script.onload  = () => resolve();
        script.onerror = () => reject(new Error(`Failed to load script: ${uri}`));
        document.head.appendChild(script);
    });
}


// ── UI Builder ─────────────────────────────────────────────────────────────────
function buildUiFromProject(project, pageIndex, navOpts) {
    if (!wasmReady || !WasmModule) {
        return;
    }
    switchToPage(project, pageIndex, navOpts ?? { anim: "none" });
}

function cancelPreviewTransition() {
    if (previewTransitionRaf !== null) {
        cancelAnimationFrame(previewTransitionRaf);
        previewTransitionRaf = null;
    }
    previewJsTransition = false;
}

/** Snapshot the WASM RGBA framebuffer (copy; heap buffer is reused each frame). */
function copyFramebuffer() {
    const wasm = WasmModule;
    if (!wasm || typeof wasm._embf_get_buffer !== "function") {
        return null;
    }
    wasm._embf_main_loop();
    const addr = wasm._embf_get_buffer();
    if (!addr) {
        return null;
    }
    const w = lastWasmInitWidth || displayWidth;
    const h = lastWasmInitHeight || displayHeight;
    const n = w * h * 4;
    if (addr + n > wasm.HEAPU8.buffer.byteLength) {
        return null;
    }
    return new Uint8ClampedArray(wasm.HEAPU8.buffer.slice(addr, addr + n));
}

/** Blit `frameCanvas` to the visible preview canvas (respects zoom / HiDPI). */
function blitFrameCanvasToDisplay() {
    if (!frameCtx || !frameCanvas || !ctx) {
        return;
    }
    const dpr = getPreviewDpr();
    const cssW = displayWidth * previewZoom;
    const cssH = displayHeight * previewZoom;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(frameCanvas, 0, 0, displayWidth, displayHeight, 0, 0, cssW * dpr, cssH * dpr);
}

/** Preview-only slide/fade offsets (approximates LVGL screen-load animations). */
function offsetsForPreviewAnim(anim, t, w, h) {
    const p = 1 - t;
    switch (anim) {
        case "move_right":
        case "over_right":
        case "out_right":
            return { bx: t * w, by: 0, ax: -p * w, ay: 0, fade: false };
        case "move_top":
        case "over_top":
        case "out_top":
            return { bx: 0, by: -t * h, ax: 0, ay: p * h, fade: false };
        case "move_bottom":
        case "over_bottom":
        case "out_bottom":
            return { bx: 0, by: t * h, ax: 0, ay: -p * h, fade: false };
        case "fade_in":
        case "fade_out":
            return { bx: 0, by: 0, ax: 0, ay: 0, fade: true, alpha: t };
        case "move_left":
        case "over_left":
        case "out_left":
        default:
            return { bx: -t * w, by: 0, ax: p * w, ay: 0, fade: false };
    }
}

/**
 * Instant WASM page switch (LVGL `lv_screen_load`). Used after capturing a transition frame.
 * @param {{ anim?: string, time?: number, delay?: number, autoDel?: boolean }} [navOpts]
 */
function applyPageSwitch(project, pageIndex, navOpts) {
    const wasm = WasmModule;
    if (!wasm) {
        return;
    }

    const page = project.pages[pageIndex];
    if (!page) {
        return;
    }

    const entry = ensurePageScreenBuilt(project, pageIndex);
    if (!entry) {
        return;
    }
    objPtrToId = entry.objPtrToId;
    idToObjPtr = entry.idToObjPtr;

    wasm._embf_load_screen(entry.screenPtr);
    applyEmbfThemeFromProject(project);
    refreshPreviewBindings(page);
    registerPreviewButtonGroups(page);
    reapplyPreviewButtonGroups();
    pumpPreviewRedraw(6);
}

/**
 * JS canvas transition between two framebuffer snapshots (preview only; firmware uses LVGL anim).
 * @param {{ anim?: string, time?: number, delay?: number, autoDel?: boolean }} navOpts
 */
function playPreviewPageTransition(project, pageIndex, navOpts) {
    const wasm = WasmModule;
    if (!wasm || !frameCtx || !frameCanvas) {
        applyPageSwitch(project, pageIndex, navOpts);
        return;
    }

    cancelPreviewTransition();

    const anim = navOpts.anim ?? "move_left";
    const time = Math.max(50, Math.round(navOpts.time ?? 300));
    const delay = Math.max(0, Math.round(navOpts.delay ?? 0));

    const beforeCopy = copyFramebuffer();
    if (!beforeCopy) {
        applyPageSwitch(project, pageIndex, navOpts);
        return;
    }

    const startTransition = () => {
        applyPageSwitch(project, pageIndex, { anim: "none" });
        const afterCopy = copyFramebuffer();
        if (!afterCopy) {
            return;
        }

        const w = displayWidth;
        const h = displayHeight;
        const beforeCanvas = document.createElement("canvas");
        beforeCanvas.width = w;
        beforeCanvas.height = h;
        beforeCanvas.getContext("2d").putImageData(new ImageData(beforeCopy, w, h), 0, 0);

        const afterCanvas = document.createElement("canvas");
        afterCanvas.width = w;
        afterCanvas.height = h;
        afterCanvas.getContext("2d").putImageData(new ImageData(afterCopy, w, h), 0, 0);

        previewJsTransition = true;
        const t0 = performance.now();

        const tick = now => {
            const t = Math.min(1, (now - t0) / time);
            const o = offsetsForPreviewAnim(anim, t, w, h);
            frameCtx.clearRect(0, 0, w, h);
            if (o.fade) {
                frameCtx.drawImage(beforeCanvas, 0, 0);
                frameCtx.globalAlpha = o.alpha;
                frameCtx.drawImage(afterCanvas, 0, 0);
                frameCtx.globalAlpha = 1;
            } else {
                frameCtx.drawImage(beforeCanvas, o.bx, o.by);
                frameCtx.drawImage(afterCanvas, o.ax, o.ay);
            }
            blitFrameCanvasToDisplay();

            if (t < 1) {
                previewTransitionRaf = requestAnimationFrame(tick);
            } else {
                cancelPreviewTransition();
            }
        };

        previewTransitionRaf = requestAnimationFrame(tick);
    };

    if (delay > 0) {
        setTimeout(startTransition, delay);
    } else {
        startTransition();
    }
}

/**
 * @param {{ anim?: string, time?: number, delay?: number, autoDel?: boolean }} [navOpts]
 */
function switchToPage(project, pageIndex, navOpts) {
    if (!wasmReady || !WasmModule) {
        return;
    }

    const anim = navOpts?.anim ?? "none";
    const usePreviewAnim =
        anim !== "none" && screenLoadAnimToLv(anim) !== LV_SCREEN_LOAD_ANIM.none;

    if (usePreviewAnim) {
        for (let i = 0; i < project.pages.length; i++) {
            ensurePageScreenBuilt(project, i);
        }
        playPreviewPageTransition(project, pageIndex, navOpts);
        return;
    }

    applyPageSwitch(project, pageIndex, navOpts);
}

function ensurePageScreenBuilt(project, pageIndex) {
    const page = project.pages[pageIndex];
    const cached = pageScreenCache.get(page.id);
    if (cached) {
        return cached;
    }

    const wasm = WasmModule;
    const idToObjPtrLocal = new Map();
    const objPtrToIdLocal = new Map();
    const prevId = idToObjPtr;
    const prevObj = objPtrToId;
    idToObjPtr = idToObjPtrLocal;
    objPtrToId = objPtrToIdLocal;

    const screenObj = wasm._embf_create_screen();

    applyPreviewBaseDir(wasm, screenObj);

    if (page.backgroundColor) {
        wasm._embf_obj_set_style_bg_color(screenObj, parseColor(page.backgroundColor));
    }
    if (typeof wasm._embf_obj_set_scroll_dir === "function") {
        const dirMask = (page.scrollX ? 1 : 0) | (page.scrollY ? 2 : 0);
        if (page.scrollX !== undefined || page.scrollY !== undefined) {
            wasm._embf_obj_set_scroll_dir(screenObj, dirMask);
        }
    }

    for (const comp of page.components) {
        buildComponentEmbf(wasm, comp, screenObj);
    }

    registerPageEvents(wasm, page);

    refreshPreviewBindings(page);

    idToObjPtr = prevId;
    objPtrToId = prevObj;

    const entry = { screenPtr: screenObj, idToObjPtr: idToObjPtrLocal, objPtrToId: objPtrToIdLocal };
    pageScreenCache.set(page.id, entry);
    return entry;
}

/** Register LVGL event callbacks for all components with events on the current page. */
function registerPageEvents(wasm, page) {
    for (const comp of flatComponents(page.components)) {
        if (!comp.events?.length) continue;
        const ptr = idToObjPtr.get(comp.id);
        if (!ptr) continue;

        for (const evtDef of comp.events) {
            const code = triggerToLvCode(evtDef.trigger);
            wasm._embf_register_event(ptr, code);
        }
    }
}

/** Collect all components recursively (for containers/panels). */
function flatComponents(comps) {
    const result = [];
    for (const c of comps ?? []) {
        result.push(c);
        if (c.children) result.push(...flatComponents(c.children));
    }
    return result;
}

function triggerToLvCode(trigger) {
    switch (trigger) {
        case "clicked":       return LV_EVENT_CLICKED;
        case "long_pressed":  return LV_EVENT_LONG_PRESSED;
        case "value_changed": return LV_EVENT_VALUE_CHANGED;
        default:              return LV_EVENT_CLICKED;
    }
}

/** Maps `AnimationDef.property` → `embf_anim_start` prop id (must match embf_runtime.c). */
const ANIM_PROP_ID = { x: 0, y: 1, width: 2, height: 3, opacity: 4 };
const ANIM_EASING_ID = {
    linear: 0,
    ease_in: 1,
    ease_out: 2,
    ease_in_out: 3,
    overshoot: 4,
    bounce: 5,
    step: 6
};

/**
 * Run all `animations[]` on the current page via WASM `embf_anim_start`.
 * Requires a rebuilt preview runtime (wasm-src/build.ps1) exporting `_embf_anim_start`.
 */
function buttonGroupKey(members) {
    return [...members].sort().join("\0");
}

function normalizeStyleHex(hex) {
    return (hex ?? "").replace(/^#/, "").toLowerCase();
}

function stylesLookSelected(styles, selectedStyles) {
    if (!styles?.bgColor) {
        return false;
    }
    const bg = normalizeStyleHex(styles.bgColor);
    const selBg = normalizeStyleHex(selectedStyles?.bgColor);
    const primary = normalizeStyleHex(currentProject?.theme?.primaryColor ?? "#2dd4ff");
    const secondary = normalizeStyleHex(currentProject?.theme?.secondaryColor ?? "#a78bfa");
    return bg === selBg || bg === primary || bg === secondary;
}

function templateUnselectedStyles(page, members, selectedStyles) {
    for (const id of members) {
        const comp = findComponentById(page.components, id);
        if (comp?.styles && !stylesLookSelected(comp.styles, selectedStyles)) {
            return comp.styles;
        }
    }
    return {
        textColor: "#e5e7eb",
        bgColor: "#0f172a",
        borderColor: "#1f2a44",
        borderWidth: 2,
        borderRadius: 12
    };
}

function inactiveStylesForMember(page, memberId, members, selectedStyles) {
    const comp = findComponentById(page.components, memberId);
    const styles = comp?.styles;
    if (styles && !stylesLookSelected(styles, selectedStyles)) {
        return styles;
    }
    return templateUnselectedStyles(page, members, selectedStyles);
}

function defaultActiveMemberId(page, members, selectedStyles) {
    for (const id of members) {
        const comp = findComponentById(page.components, id);
        if (comp?.styles && stylesLookSelected(comp.styles, selectedStyles)) {
            return id;
        }
    }
    return members[0] ?? null;
}

function collectUniqueButtonGroupActions(page) {
    const seen = new Map();
    for (const action of collectPageActions(page)) {
        if (action.type !== "select_button_group") {
            continue;
        }
        const key = buttonGroupKey(action.members);
        if (!seen.has(key)) {
            seen.set(key, action);
        }
    }
    return [...seen.values()];
}

function defaultSelectedButtonStyles() {
    const primary = currentProject?.theme?.primaryColor ?? "#2dd4ff";
    return { bgColor: primary, textColor: "#0f172a", borderColor: primary };
}

function applyButtonGroupSelection(members, activeId, selectedStyles) {
    const wasm = WasmModule;
    const page = currentProject?.pages?.[currentPageIndex];
    if (!wasm || !page || !wasmReady) {
        return;
    }
    const sel = selectedStyles ?? defaultSelectedButtonStyles();
    previewButtonGroupState.set(buttonGroupKey(members), activeId);
    for (const id of members) {
        const ptr = idToObjPtr.get(id);
        if (!ptr) {
            continue;
        }
        const styles =
            id === activeId ? sel : inactiveStylesForMember(page, id, members, sel);
        applyStylesEmbf(wasm, ptr, styles);
    }
    pumpPreviewRedraw(2);
}

function reapplyPreviewButtonGroups() {
    const page = currentProject?.pages?.[currentPageIndex];
    if (!page) {
        return;
    }
    for (const action of collectUniqueButtonGroupActions(page)) {
        const members = action.members;
        const sel = action.selectedStyles ?? defaultSelectedButtonStyles();
        const key = buttonGroupKey(members);
        const activeId =
            previewButtonGroupState.get(key) ?? defaultActiveMemberId(page, members, sel);
        if (activeId) {
            applyButtonGroupSelection(members, activeId, action.selectedStyles);
        }
    }
}

function collectPageActions(page) {
    const out = [];
    function walk(comps) {
        for (const c of comps ?? []) {
            for (const evt of c.events ?? []) {
                for (const a of evt.actions ?? []) {
                    out.push(a);
                }
            }
            if (Array.isArray(c.children)) {
                walk(c.children);
            }
        }
    }
    walk(page.components);
    return out;
}

function inferDefaultActiveButton(members) {
    const page = currentProject?.pages?.[currentPageIndex];
    if (!page) {
        return members[0];
    }
    const primary = (currentProject?.theme?.primaryColor ?? "#2dd4ff").toLowerCase();
    const secondary = (currentProject?.theme?.secondaryColor ?? "#a78bfa").toLowerCase();
    for (const id of members) {
        const comp = findComponentById(page.components, id);
        const bg = (comp?.styles?.bgColor ?? "").toLowerCase();
        if (bg && (bg === primary || bg === secondary)) {
            return id;
        }
    }
    return members[0];
}

function registerPreviewButtonGroups(page) {
    for (const action of collectUniqueButtonGroupActions(page)) {
        const key = buttonGroupKey(action.members);
        if (!previewButtonGroupState.has(key)) {
            const sel = action.selectedStyles ?? defaultSelectedButtonStyles();
            previewButtonGroupState.set(
                key,
                defaultActiveMemberId(page, action.members, sel)
            );
        }
    }
}

function playWidgetAnimationsOnCurrentPage() {
    if (!wasmReady || !WasmModule || !currentProject) {
        return { ok: false, reason: "Preview not ready." };
    }
    if (typeof WasmModule._embf_anim_start !== "function") {
        return {
            ok: false,
            reason: "Rebuild the WASM preview (wasm-src/build.ps1) to enable Play animations."
        };
    }
    const page = currentProject.pages[currentPageIndex];
    if (!page) {
        return { ok: false, reason: "No active page." };
    }

    let started = 0;
    for (const comp of flatComponents(page.components)) {
        const anims = comp.animations;
        if (!Array.isArray(anims) || anims.length === 0) {
            continue;
        }
        const ptr = idToObjPtr.get(comp.id);
        if (!ptr) {
            continue;
        }
        for (const a of anims) {
            const propId = ANIM_PROP_ID[a.property];
            if (propId === undefined) {
                continue;
            }
            const from = Math.round(Number(a.from));
            const to = Math.round(Number(a.to));
            if (!Number.isFinite(from) || !Number.isFinite(to)) {
                continue;
            }
            const duration = Math.max(1, Math.round(Number(a.duration ?? 500)));
            const delay = a.delay !== undefined ? Math.max(0, Math.round(Number(a.delay))) : 0;
            const easingId = ANIM_EASING_ID[a.easing ?? "linear"] ?? 0;
            const repeat = a.repeat !== undefined ? Math.round(Number(a.repeat)) : 0;
            const playback = a.playback ? 1 : 0;
            WasmModule._embf_anim_start(ptr, propId, from, to, duration, delay, easingId, repeat, playback);
            started++;
        }
    }

    if (started === 0) {
        return {
            ok: false,
            reason: "No animations on this page (add them in Properties → Animations, or edit traffic.embf)."
        };
    }
    return { ok: true, started };
}

/** Preview properties: `model.properties` when set, else legacy `dataModel.fields`. */
function getPreviewProperties() {
    if (!currentProject) return [];
    if (currentProject.model?.properties !== undefined) {
        return currentProject.model.properties;
    }
    const legacy = currentProject.dataModel?.fields;
    return Array.isArray(legacy) ? legacy : [];
}

function formatPropertyDefault(f) {
    if (!f) return "";
    if (f.default === undefined || f.default === null) {
        switch (f.type) {
            case "int":
            case "float":
                return "0";
            case "bool":
                return "false";
            default:
                return "";
        }
    }
    if (typeof f.default === "boolean") return f.default ? "true" : "false";
    return String(f.default);
}

/**
 * Substitute `{{field}}` with `model.properties` / `dataModel.fields` defaults (preview only).
 */
function applyBindingTemplates(text) {
    if (typeof text !== "string" || text.indexOf("{{") === -1) {
        return text;
    }
    const fields = getPreviewProperties();
    return text.replace(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g, (_full, id) => {
        const f = fields.find(x => x && x.id === id);
        if (!f) return `<${id}>`;
        return formatPropertyDefault(f);
    });
}

/**
 * Resolve a numeric value from `comp.bindings[prop]` against `dataModel.fields[]` defaults.
 * Falls back to `fallback` if no binding is set or the field is missing/non-numeric.
 */
function resolveBoundNumber(comp, prop, fallback) {
    const fieldId = comp?.bindings?.[prop];
    if (typeof fieldId !== "string") return fallback;
    const fields = getPreviewProperties();
    if (!fields.length) return fallback;
    const f = fields.find(x => x && x.id === fieldId);
    if (!f) return fallback;
    if (f.default === undefined || f.default === null) {
        return f.type === "float" || f.type === "int" ? 0 : fallback;
    }
    const n = Number(f.default);
    return Number.isFinite(n) ? n : fallback;
}

/** Label text that is exactly `{{fieldId}}` (matches firmware codegen). */
function singleBindingFieldInLabel(text) {
    if (typeof text !== "string" || text.indexOf("{{") === -1) {
        return null;
    }
    const fields = [];
    const re = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;
    let m;
    while ((m = re.exec(text)) !== null) {
        if (!fields.includes(m[1])) {
            fields.push(m[1]);
        }
    }
    if (fields.length !== 1) {
        return null;
    }
    const trimmed = text.replace(/\s/g, "");
    return trimmed === `{{${fields[0]}}}` ? fields[0] : null;
}

function setDataModelField(fieldId, value) {
    const fields = getPreviewProperties();
    if (!fields.length) {
        return false;
    }
    const f = fields.find(x => x && x.id === fieldId);
    if (!f) {
        return false;
    }
    switch (f.type) {
        case "string":
            f.default = String(value);
            return true;
        case "int":
            f.default = Math.round(Number(value));
            return true;
        case "float":
            f.default = Number(value);
            return true;
        case "bool":
            f.default = !!value;
            return true;
    }
    return false;
}

function isWidgetTextRef(value) {
    return (
        value !== null &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        typeof value.ref === "string"
    );
}

function widgetTextMode(value) {
    return isWidgetTextRef(value) ? "resource" : "literal";
}

function widgetTextLiteral(value) {
    return typeof value === "string" ? value : "";
}

function widgetTextRefKey(value) {
    return isWidgetTextRef(value) ? value.ref : "";
}

/** Resolve label/button/checkbox copy for preview (defaultLocale → any locale → key id). */
function resolveWidgetTextDisplay(value) {
    if (value === undefined || value === null) {
        return "";
    }
    if (typeof value === "string") {
        return applyBindingTemplates(value);
    }
    if (isWidgetTextRef(value)) {
        const key = value.ref;
        if (!currentStringsRes) {
            return key;
        }
        const tryLoc = loc => {
            const table = currentStringsRes.locales[loc];
            return table && Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined;
        };
        const activeLoc = previewLocale || currentStringsRes.defaultLocale;
        if (activeLoc) {
            const fromActive = tryLoc(activeLoc);
            if (fromActive !== undefined) {
                return applyBindingTemplates(fromActive);
            }
        }
        const fromDefault = tryLoc(currentStringsRes.defaultLocale);
        if (fromDefault !== undefined) {
            return applyBindingTemplates(fromDefault);
        }
        for (const loc of Object.keys(currentStringsRes.locales)) {
            const v = tryLoc(loc);
            if (v !== undefined) {
                return applyBindingTemplates(v);
            }
        }
        return key;
    }
    return String(value);
}

/** Re-apply localized copy after preview locale change (updates cached screens in place). */
function refreshPreviewLocaleText() {
    if (!currentProject || !WasmModule || !wasmReady) {
        return;
    }
    if (previewLocaleRefreshScheduled) {
        return;
    }
    previewLocaleRefreshScheduled = true;
    requestAnimationFrame(() => {
        previewLocaleRefreshScheduled = false;
        refreshPreviewLocaleTextNow();
    });
}

/** Apply string-resource text + base_dir on one cached screen without rebuilding LVGL objects. */
function refreshPageLocalizedStrings(wasm, page, idMap) {
    if (!page || !idMap) {
        return;
    }

    function walk(comps) {
        for (const c of comps ?? []) {
            const ptr = idMap.get(c.id);
            if (ptr) {
                if (c.type === "label") {
                    if (typeof c.text === "string" && c.text.indexOf("{{") !== -1) {
                        const strPtr = wasm.stringToNewUTF8(applyBindingTemplates(c.text));
                        wasm._embf_label_set_text(ptr, strPtr);
                        wasm._free(strPtr);
                    } else if (isWidgetTextRef(c.text)) {
                        const strPtr = wasm.stringToNewUTF8(resolveWidgetTextDisplay(c.text));
                        wasm._embf_label_set_text(ptr, strPtr);
                        wasm._free(strPtr);
                    }
                } else if (c.type === "button") {
                    if (typeof c.label === "string" && c.label.indexOf("{{") !== -1) {
                        const strPtr = wasm.stringToNewUTF8(applyBindingTemplates(c.label));
                        wasm._embf_button_set_label?.(ptr, strPtr);
                        wasm._free(strPtr);
                    } else if (isWidgetTextRef(c.label)) {
                        const strPtr = wasm.stringToNewUTF8(resolveWidgetTextDisplay(c.label));
                        wasm._embf_button_set_label?.(ptr, strPtr);
                        wasm._free(strPtr);
                    }
                } else if (c.type === "checkbox") {
                    if (typeof c.text === "string" && c.text.indexOf("{{") !== -1) {
                        const strPtr = wasm.stringToNewUTF8(applyBindingTemplates(c.text));
                        wasm._embf_checkbox_set_text?.(ptr, strPtr);
                        wasm._free(strPtr);
                    } else if (isWidgetTextRef(c.text)) {
                        const strPtr = wasm.stringToNewUTF8(resolveWidgetTextDisplay(c.text));
                        wasm._embf_checkbox_set_text?.(ptr, strPtr);
                        wasm._free(strPtr);
                    }
                }
            }
            if (c.children?.length) {
                walk(c.children);
            }
        }
    }
    walk(page.components);
}

function refreshPreviewLocaleTextNow() {
    const wasm = WasmModule;
    const project = currentProject;
    if (!wasm || !project || !wasmReady) {
        return;
    }

    for (const [pageId, entry] of pageScreenCache) {
        const page = project.pages.find(p => p.id === pageId);
        if (!page) {
            continue;
        }
        applyPreviewBaseDir(wasm, entry.screenPtr);
        refreshPageLocalizedStrings(wasm, page, entry.idToObjPtr);
    }

    const page = project.pages[currentPageIndex];
    if (!page) {
        return;
    }

    let entry = pageScreenCache.get(page.id);
    if (!entry) {
        applyPageSwitch(project, currentPageIndex);
        entry = pageScreenCache.get(page.id);
    }
    if (!entry) {
        return;
    }

    objPtrToId = entry.objPtrToId;
    idToObjPtr = entry.idToObjPtr;
    applyPreviewBaseDir(wasm, entry.screenPtr);
    refreshPageLocalizedStrings(wasm, page, entry.idToObjPtr);
    wasm._embf_load_screen(entry.screenPtr);
    refreshPreviewBindings(page);
    reapplyPreviewButtonGroups();
    pumpPreviewRedraw(2);
    drawDesignOverlay();
}

function populatePreviewLocaleSelect(localeIds, defaultLocale) {
    if (!previewLocaleSelect) {
        return;
    }
    const ids = Array.isArray(localeIds) ? localeIds.filter(Boolean) : [];
    if (!ids.length) {
        previewLocaleSelect.innerHTML = "";
        previewLocaleSelect.disabled = true;
        previewLocale = "";
        return;
    }
    previewLocaleSelect.disabled = false;
    if (!previewLocale || !ids.includes(previewLocale)) {
        previewLocale = defaultLocale && ids.includes(defaultLocale) ? defaultLocale : ids[0];
    }
    previewLocaleSelect.innerHTML = ids
        .map(
            loc =>
                `<option value="${esc(loc)}"${loc === previewLocale ? " selected" : ""}>${esc(loc)}</option>`
        )
        .join("");
}

/** Mirror firmware `ui_bindings_apply()` for the live preview after button actions. */
function refreshPreviewBindings(page) {
    if (!page || !WasmModule || !getPreviewProperties().length) {
        return;
    }
    const wasm = WasmModule;

    function walk(comps) {
        for (const c of comps ?? []) {
            const ptr = idToObjPtr.get(c.id);
            if (ptr) {
                if (c.type === "label" && typeof c.text === "string" && c.text.indexOf("{{") !== -1) {
                    const strPtr = wasm.stringToNewUTF8(applyBindingTemplates(c.text));
                    wasm._embf_label_set_text(ptr, strPtr);
                    wasm._free(strPtr);
                } else if (c.type === "label" && isWidgetTextRef(c.text)) {
                    const strPtr = wasm.stringToNewUTF8(resolveWidgetTextDisplay(c.text));
                    wasm._embf_label_set_text(ptr, strPtr);
                    wasm._free(strPtr);
                } else if (c.type === "button" && typeof c.label === "string" && c.label.indexOf("{{") !== -1) {
                    const strPtr = wasm.stringToNewUTF8(applyBindingTemplates(c.label));
                    wasm._embf_button_set_label?.(ptr, strPtr);
                    wasm._free(strPtr);
                } else if (c.type === "button" && isWidgetTextRef(c.label)) {
                    const strPtr = wasm.stringToNewUTF8(resolveWidgetTextDisplay(c.label));
                    wasm._embf_button_set_label?.(ptr, strPtr);
                    wasm._free(strPtr);
                } else if (c.type === "slider") {
                    wasm._embf_slider_set_value?.(
                        ptr,
                        resolveBoundNumber(c, "value", c.value)
                    );
                } else if (c.type === "bar") {
                    wasm._embf_bar_set_value?.(ptr, resolveBoundNumber(c, "value", c.value));
                } else if (c.type === "arc" || c.type === "knob") {
                    wasm._embf_arc_set_value?.(ptr, resolveBoundNumber(c, "value", c.value));
                }
            }
            if (c.children?.length) {
                walk(c.children);
            }
        }
    }
    walk(page.components);
}

const RTL_LOCALE_IDS = new Set(["ar", "fa", "he", "ur", "ps", "ku", "dv"]);

function isRtlLocaleIdPreview(localeId) {
    const base = String(localeId ?? "").split(/[-_]/)[0]?.toLowerCase() ?? "";
    return RTL_LOCALE_IDS.has(base);
}

/** RTL2: active locale → localeMeta → inferred RTL id → display.direction → ltr */
function resolvePreviewTextDirection() {
    const loc = (previewLocale || currentStringsRes?.defaultLocale || "").trim();
    if (loc && currentStringsRes?.localeMeta?.[loc]?.direction) {
        return currentStringsRes.localeMeta[loc].direction === "rtl" ? "rtl" : "ltr";
    }
    if (loc && isRtlLocaleIdPreview(loc)) {
        return "rtl";
    }
    const disp = currentProject?.display?.direction;
    if (disp === "rtl" || disp === "ltr") {
        return disp;
    }
    return "ltr";
}

const EMBF_FLEX_FLOW = { row: 0, column: 1, row_wrap: 4, column_wrap: 5 };
const EMBF_FLEX_ALIGN = {
    start: 0,
    end: 1,
    center: 2,
    space_evenly: 3,
    space_around: 4,
    space_between: 5
};
const EMBF_GRID_CELL_ALIGN = { start: 0, center: 1, end: 2, stretch: 3 };

function gridTrackToWasm(wasm, track) {
    if (track === "content" && typeof wasm._embf_grid_content === "function") {
        return wasm._embf_grid_content();
    }
    if (typeof track === "number" && Number.isFinite(track)) {
        return Math.round(track);
    }
    const m = /^(\d+(?:\.\d+)?)fr$/i.exec(String(track ?? "").trim());
    if (m && typeof wasm._embf_grid_fr === "function") {
        return wasm._embf_grid_fr(Math.max(1, Math.round(Number(m[1]))));
    }
    const px = Number.parseInt(String(track), 10);
    if (Number.isFinite(px)) {
        return px;
    }
    return typeof wasm._embf_grid_fr === "function" ? wasm._embf_grid_fr(1) : 1;
}

function buildGridDscBuffer(wasm, tracks) {
    const vals = (tracks ?? ["1fr"]).map(t => gridTrackToWasm(wasm, t));
    if (typeof wasm._embf_grid_template_last === "function") {
        vals.push(wasm._embf_grid_template_last());
    }
    const buf = wasm._malloc(vals.length * 4);
    vals.forEach((v, i) => {
        wasm.HEAP32[(buf >> 2) + i] = v;
    });
    return { buf };
}

function applyContainerLayoutEmbf(wasm, obj, comp) {
    if (!obj || comp.type !== "container") {
        return;
    }
    if (comp.layout === "flex" && typeof wasm._embf_container_set_flex === "function") {
        const flow = EMBF_FLEX_FLOW[comp.flexFlow ?? "row"] ?? 0;
        const main = EMBF_FLEX_ALIGN[comp.flexAlign ?? "start"] ?? 0;
        const cross = EMBF_FLEX_ALIGN[comp.flexCrossAlign ?? "start"] ?? 0;
        const track = EMBF_FLEX_ALIGN[comp.flexTrackCrossAlign ?? "start"] ?? 0;
        wasm._embf_container_set_flex(obj, flow, main, cross, track);
    } else if (comp.layout === "grid" && typeof wasm._embf_container_set_grid === "function") {
        const col = buildGridDscBuffer(wasm, comp.gridColumnDescriptors ?? ["1fr"]);
        const row = buildGridDscBuffer(wasm, comp.gridRowDescriptors ?? ["1fr"]);
        gridDscStore.set(comp.id, [col.buf, row.buf]);
        wasm._embf_container_set_grid(
            obj,
            col.buf,
            row.buf,
            Math.round(comp.gridColumnGap ?? 0),
            Math.round(comp.gridRowGap ?? 0),
            EMBF_FLEX_ALIGN[comp.gridAlign ?? "start"] ?? 0,
            EMBF_FLEX_ALIGN[comp.gridVAlign ?? "start"] ?? 0
        );
    }
}

function applyChildLayoutEmbf(wasm, obj, comp) {
    if (!obj) {
        return;
    }
    if (comp.flexGrow !== undefined && comp.flexGrow > 0 && typeof wasm._embf_obj_set_flex_grow === "function") {
        wasm._embf_obj_set_flex_grow(obj, Math.round(comp.flexGrow));
    }
    if (
        typeof wasm._embf_obj_set_grid_cell === "function" &&
        (comp.gridCol !== undefined ||
            comp.gridRow !== undefined ||
            comp.gridColSpan !== undefined ||
            comp.gridRowSpan !== undefined)
    ) {
        wasm._embf_obj_set_grid_cell(
            obj,
            EMBF_GRID_CELL_ALIGN[comp.gridCellXAlign ?? "stretch"] ?? 3,
            comp.gridCol ?? 0,
            comp.gridColSpan ?? 1,
            EMBF_GRID_CELL_ALIGN[comp.gridCellYAlign ?? "stretch"] ?? 3,
            comp.gridRow ?? 0,
            comp.gridRowSpan ?? 1
        );
    }
}

function applyPreviewBaseDir(wasm, screenObj) {
    if (!screenObj || typeof wasm._embf_obj_set_base_dir !== "function") {
        return;
    }
    wasm._embf_obj_set_base_dir(screenObj, resolvePreviewTextDirection() === "rtl" ? 1 : 0);
}

function previewNavigateToPage(targetIdx, navOpts, stackMode) {
    const page = currentProject?.pages?.[currentPageIndex];
    const target = currentProject?.pages?.[targetIdx];
    if (!page || !target) {
        return;
    }
    if (stackMode === "push" && previewNavStack.length < 16) {
        previewNavStack.push(page.id);
    } else if (stackMode === "reset") {
        previewNavStack.length = 0;
    }
    currentPageIndex = targetIdx;
    selectedComponentOrder = [];
    inspectorShowingPage = false;
    dragState = null;
    pendingDrag = null;
    marqueeState = null;
    pageSelectProgrammatic = true;
    try {
        if (pageSelect) {
            pageSelect.value = String(targetIdx);
        }
        switchToPage(currentProject, targetIdx, navOpts ?? { anim: "none" });
        drawDesignOverlay();
        renderInspector();
        renderPageList();
        renderToolbarWidgetSelect();
        renderFlowPanel();
    } finally {
        pageSelectProgrammatic = false;
    }
}

function buildComponentEmbf(wasm, comp, parent) {
    if (comp.hidden) return;
    let obj = 0;
    // obj is tracked below after the switch

    switch (comp.type) {
        case "label": {
            obj = wasm._embf_create_label(parent, comp.x, comp.y, comp.width, comp.height);
            const ptr = wasm.stringToNewUTF8(resolveWidgetTextDisplay(comp.text));
            wasm._embf_label_set_text(obj, ptr);
            wasm._free(ptr);
            break;
        }
        case "button": {
            obj = wasm._embf_create_button(parent, comp.x, comp.y, comp.width, comp.height);
            if (comp.label !== undefined && comp.label !== null && comp.label !== "") {
                const ptr = wasm.stringToNewUTF8(resolveWidgetTextDisplay(comp.label));
                wasm._embf_button_set_label(obj, ptr);
                wasm._free(ptr);
            }
            break;
        }
        case "slider": {
            obj = wasm._embf_create_slider(parent, comp.x, comp.y, comp.width, comp.height);
            wasm._embf_slider_set_range(obj, comp.min, comp.max);
            wasm._embf_slider_set_value(obj, resolveBoundNumber(comp, "value", comp.value));
            break;
        }
        case "switch": {
            obj = wasm._embf_create_switch(parent, comp.x, comp.y, comp.width, comp.height);
            if (comp.checked) wasm._embf_switch_set_state(obj, 1);
            break;
        }
        case "bar": {
            obj = wasm._embf_create_bar(parent, comp.x, comp.y, comp.width, comp.height);
            wasm._embf_bar_set_range(obj, comp.min, comp.max);
            wasm._embf_bar_set_value(obj, resolveBoundNumber(comp, "value", comp.value));
            break;
        }
        case "spinner": {
            obj = wasm._embf_create_spinner(parent, comp.x, comp.y, comp.width, comp.height,
                comp.speed ?? 1000, comp.arcLength ?? 60);
            break;
        }
        case "arc": {
            obj = wasm._embf_create_arc(parent, comp.x, comp.y, comp.width, comp.height);
            wasm._embf_arc_set_range(obj, comp.min, comp.max);
            wasm._embf_arc_set_value(obj, resolveBoundNumber(comp, "value", comp.value));
            break;
        }
        case "knob": {
            // Knob is rendered as an arc; native runtime knob styling (LV_PART_KNOB) is approximated.
            obj = wasm._embf_create_arc(parent, comp.x, comp.y, comp.width, comp.height);
            wasm._embf_arc_set_range(obj, comp.min, comp.max);
            wasm._embf_arc_set_value(obj, resolveBoundNumber(comp, "value", comp.value));
            break;
        }
        case "checkbox": {
            obj = wasm._embf_create_checkbox(parent, comp.x, comp.y, comp.width, comp.height);
            if (comp.text !== undefined && comp.text !== null && comp.text !== "") {
                const ptr = wasm.stringToNewUTF8(resolveWidgetTextDisplay(comp.text));
                wasm._embf_checkbox_set_text(obj, ptr);
                wasm._free(ptr);
            }
            if (comp.checked) wasm._embf_checkbox_set_state(obj, 1);
            break;
        }
        case "dropdown": {
            obj = wasm._embf_create_dropdown(parent, comp.x, comp.y, comp.width, comp.height);
            const optStr = (comp.options ?? []).join("\n");
            const optPtr = wasm.stringToNewUTF8(optStr);
            wasm._embf_dropdown_set_options(obj, optPtr);
            wasm._free(optPtr);
            wasm._embf_dropdown_set_selected(obj, comp.selectedIndex ?? 0);
            break;
        }
        case "roller": {
            obj = wasm._embf_create_roller(parent, comp.x, comp.y, comp.width, comp.height);
            const optStr = (comp.options ?? []).join("\n");
            const optPtr = wasm.stringToNewUTF8(optStr);
            const infinite = comp.mode === "infinite" ? 1 : 0;
            wasm._embf_roller_set_options(obj, optPtr, infinite);
            wasm._free(optPtr);
            wasm._embf_roller_set_selected(obj, comp.selectedIndex ?? 0);
            break;
        }
        case "textarea": {
            obj = wasm._embf_create_textarea(parent, comp.x, comp.y, comp.width, comp.height);
            if (comp.text) {
                const ptr = wasm.stringToNewUTF8(applyBindingTemplates(comp.text));
                wasm._embf_textarea_set_text(obj, ptr);
                wasm._free(ptr);
            }
            if (comp.placeholder) {
                const ptr = wasm.stringToNewUTF8(applyBindingTemplates(comp.placeholder));
                wasm._embf_textarea_set_placeholder(obj, ptr);
                wasm._free(ptr);
            }
            if (comp.oneLine) wasm._embf_textarea_set_one_line(obj, 1);
            break;
        }
        case "line": {
            obj = wasm._embf_create_line(parent, comp.x, comp.y, comp.width, comp.height);
            const pts = comp.points ?? [];
            if (pts.length > 0) {
                const buf = wasm._malloc(pts.length * 8); // 2 × int32 per point
                pts.forEach((p, i) => {
                    wasm.HEAP32[(buf >> 2) + i * 2]     = p.x;
                    wasm.HEAP32[(buf >> 2) + i * 2 + 1] = p.y;
                });
                wasm._embf_line_set_points(obj, buf, pts.length);
                wasm._free(buf);
            }
            break;
        }
        case "image": {
            // Images require compiled-in asset data; show a labeled placeholder
            obj = wasm._embf_create_container(parent, comp.x, comp.y, comp.width, comp.height);
            const lbl = wasm._embf_create_label(obj, 0, 0, comp.width, comp.height);
            const ptr = wasm.stringToNewUTF8(`[${comp.src ?? "image"}]`);
            wasm._embf_label_set_text(lbl, ptr);
            wasm._free(ptr);
            break;
        }
        case "container":
        case "panel": {
            obj = wasm._embf_create_container(parent, comp.x, comp.y, comp.width, comp.height);
            if (comp.type === "container") {
                applyContainerLayoutEmbf(wasm, obj, comp);
            }
            for (const child of comp.children ?? []) {
                buildComponentEmbf(wasm, child, obj);
            }
            break;
        }
        default:
            log("warn", `Unknown component type: ${comp.type}`);
            return;
    }

    // Track pointer ↔ id mapping
    if (obj) {
        objPtrToId.set(obj, comp.id);
        idToObjPtr.set(comp.id, obj);
    }

    // Scroll direction flags (optional per widget)
    if (obj && typeof wasm._embf_obj_set_scroll_dir === "function") {
        const dirMask = (comp.scrollX ? 1 : 0) | (comp.scrollY ? 2 : 0);
        // Only apply when explicitly set; otherwise keep LVGL defaults.
        if (comp.scrollX !== undefined || comp.scrollY !== undefined) {
            wasm._embf_obj_set_scroll_dir(obj, dirMask);
        }
    }

    applyStylesEmbf(wasm, obj, comp.styles ?? {});
    applyChildLayoutEmbf(wasm, obj, comp);
}

function applyStylesEmbf(wasm, obj, styles) {
    if (!obj) return;
    if (styles.bgColor !== undefined) {
        wasm._embf_obj_set_style_bg_color(obj, parseColor(styles.bgColor));
    }
    if (styles.indicatorColor !== undefined && typeof wasm._embf_obj_set_style_bg_color_part === "function") {
        wasm._embf_obj_set_style_bg_color_part(obj, LV_PART_INDICATOR, parseColor(styles.indicatorColor));
    }
    if (styles.textColor !== undefined) {
        wasm._embf_obj_set_style_text_color(obj, parseColor(styles.textColor));
    }
    if (styles.borderWidth !== undefined) {
        wasm._embf_obj_set_style_border_width(obj, styles.borderWidth);
    }
    if (styles.borderRadius !== undefined) {
        wasm._embf_obj_set_style_radius(obj, styles.borderRadius);
    }
    if (styles.fontSize !== undefined) {
        wasm._embf_obj_set_style_font_size(obj, styles.fontSize);
    }
    if (styles.borderColor !== undefined) {
        wasm._embf_obj_set_style_border_color(obj, parseColor(styles.borderColor));
    }
    if (styles.align !== undefined) {
        const alignCode = styles.align === "center" ? 1 : styles.align === "right" ? 2 : 0;
        wasm._embf_obj_set_style_text_align(obj, alignCode);
    }
    if (typeof styles.padding === "number") {
        wasm._embf_obj_set_style_pad_all(obj, styles.padding);
    }
}


// ── Main render loop ───────────────────────────────────────────────────────────
function startLoop() {
    stopLoop();
    rafHandle = requestAnimationFrame(loop);
}

function stopLoop() {
    if (rafHandle !== null) {
        cancelAnimationFrame(rafHandle);
        rafHandle = null;
    }
}

function loop() {
    if (!wasmReady || !WasmModule) return;

    try {
        // Tick LVGL
        if (typeof WasmModule._embf_main_loop === "function") {
            WasmModule._embf_main_loop();
        } else if (typeof WasmModule._mainLoop === "function") {
            WasmModule._mainLoop();
        }

        // Drain the LVGL event queue and dispatch actions
        drainEventQueue();

        // Read pixel buffer and blit to canvas
        let bufAddr = 0;
        if (typeof WasmModule._embf_get_buffer === "function") {
            bufAddr = WasmModule._embf_get_buffer();
        } else if (typeof WasmModule._getSyncedBuffer === "function") {
            bufAddr = WasmModule._getSyncedBuffer();
        }

        if (!previewJsTransition && bufAddr !== 0 && frameCtx && frameCanvas && ctx) {
            const w = lastWasmInitWidth || displayWidth;
            const h = lastWasmInitHeight || displayHeight;
            const byteLen = w * h * 4;
            if (!w || !h || bufAddr + byteLen > WasmModule.HEAPU8.buffer.byteLength) {
                rafHandle = requestAnimationFrame(loop);
                return;
            }
            const pixels = new Uint8ClampedArray(WasmModule.HEAPU8.buffer, bufAddr, byteLen);
            const imageData = new ImageData(pixels, w, h);
            frameCtx.putImageData(imageData, 0, 0);
            blitFrameCanvasToDisplay();
        }
    } catch (e) {
        showError(`Runtime error: ${e.message ?? e}`);
        log("error", `Loop error: ${e}`);
        return; // stop loop on error
    }

    rafHandle = requestAnimationFrame(loop);
}

// ── Event dispatch ─────────────────────────────────────────────────────────────

function drainEventQueue() {
    if (!wasmReady || !WasmModule || !currentProject || !pPollObj) return;

    while (WasmModule._embf_poll_event()) {
        // Read the result slots written by embf_poll_event()
        const objPtr  = WasmModule.HEAPU32[pPollObj  >> 2];
        const code    = WasmModule.HEAPU32[pPollCode  >> 2];
        const value   = WasmModule.HEAP32 [pPollValue >> 2];

        const compId  = objPtrToId.get(objPtr);
        if (!compId) continue;

        const pageIndex = currentPageIndex;
        const page      = currentProject.pages[pageIndex];
        if (!page) continue;

        const comp = flatComponents(page.components).find(c => c.id === compId);
        if (!comp?.events) continue;

        const trigger = lvCodeToTrigger(code);
        for (const evtDef of comp.events) {
            if (evtDef.trigger === trigger) {
                for (const action of evtDef.actions) {
                    dispatchAction(action, value, page);
                }
            }
        }
    }
}

function lvCodeToTrigger(code) {
    if (code === LV_EVENT_CLICKED)       return "clicked";
    if (code === LV_EVENT_LONG_PRESSED)  return "long_pressed";
    if (code === LV_EVENT_VALUE_CHANGED) return "value_changed";
    return null;
}

function dispatchAction(action, eventValue, currentPage) {
    const wasm = WasmModule;

    switch (action.type) {
        case "navigate": {
            if (isWorkspaceFlowActive()) {
                break;
            }
            const targetIdx = currentProject.pages.findIndex(p => p.id === action.target);
            if (targetIdx < 0) {
                log("warn", `navigate: page "${action.target}" not found`);
                return;
            }
            previewNavigateToPage(targetIdx, {
                anim: action.anim,
                time: action.time,
                delay: action.delay,
                autoDel: action.autoDel
            });
            break;
        }
        case "nav_push": {
            if (isWorkspaceFlowActive()) {
                break;
            }
            const targetIdx = currentProject.pages.findIndex(p => p.id === action.route);
            if (targetIdx < 0) {
                log("warn", `nav_push: page "${action.route}" not found`);
                return;
            }
            previewNavigateToPage(
                targetIdx,
                { anim: action.anim, time: action.time, delay: action.delay, autoDel: action.autoDel },
                "push"
            );
            break;
        }
        case "nav_pop": {
            if (isWorkspaceFlowActive() || previewNavStack.length === 0) {
                break;
            }
            const prevId = previewNavStack.pop();
            const targetIdx = currentProject.pages.findIndex(p => p.id === prevId);
            if (targetIdx < 0) {
                log("warn", `nav_pop: page "${prevId}" not found`);
                return;
            }
            previewNavigateToPage(targetIdx, {
                anim: action.anim,
                time: action.time,
                delay: action.delay,
                autoDel: action.autoDel
            });
            break;
        }
        case "nav_replace": {
            if (isWorkspaceFlowActive()) {
                break;
            }
            const targetIdx = currentProject.pages.findIndex(p => p.id === action.route);
            if (targetIdx < 0) {
                log("warn", `nav_replace: page "${action.route}" not found`);
                return;
            }
            previewNavigateToPage(targetIdx, {
                anim: action.anim,
                time: action.time,
                delay: action.delay,
                autoDel: action.autoDel
            });
            break;
        }
        case "nav_reset": {
            if (isWorkspaceFlowActive()) {
                break;
            }
            const targetIdx = currentProject.pages.findIndex(p => p.id === action.route);
            if (targetIdx < 0) {
                log("warn", `nav_reset: page "${action.route}" not found`);
                return;
            }
            previewNavigateToPage(
                targetIdx,
                { anim: action.anim, time: action.time, delay: action.delay, autoDel: action.autoDel },
                "reset"
            );
            break;
        }
        case "set_text": {
            const page = currentProject.pages[currentPageIndex];
            const targetComp = page ? findComponentById(page.components, action.target) : null;
            const bindField =
                targetComp?.type === "label" && typeof targetComp.text === "string"
                    ? singleBindingFieldInLabel(targetComp.text)
                    : null;
            if (bindField && typeof action.text === "string") {
                setDataModelField(bindField, action.text);
                refreshPreviewBindings(page);
                break;
            }
            const ptr = idToObjPtr.get(action.target);
            if (!ptr) return;
            const displayText =
                isWidgetTextRef(action.text)
                    ? resolveWidgetTextDisplay(action.text)
                    : typeof action.text === "string"
                      ? action.text
                      : "";
            const strPtr = wasm.stringToNewUTF8(displayText);
            if (targetComp?.type === "button") {
                wasm._embf_button_set_label?.(ptr, strPtr);
            } else {
                wasm._embf_label_set_text(ptr, strPtr);
            }
            wasm._free(strPtr);
            break;
        }
        case "set_value": {
            const page = currentProject.pages[currentPageIndex];
            const targetComp = page ? findComponentById(page.components, action.target) : null;
            const v = Math.round(Number(action.value));
            if (!Number.isFinite(v)) return;
            const bindField = targetComp?.bindings?.value;
            if (typeof bindField === "string") {
                setDataModelField(bindField, v);
            }
            const ptr = idToObjPtr.get(action.target);
            if (!ptr) return;
            // Must call the setter matching the widget type — calling slider/bar setters on an
            // arc (or vice versa) corrupts LVGL and can flash a solid color over the framebuffer.
            switch (targetComp?.type) {
                case "slider":
                    wasm._embf_slider_set_value?.(ptr, v);
                    break;
                case "bar":
                    wasm._embf_bar_set_value?.(ptr, v);
                    break;
                case "arc":
                case "knob":
                    wasm._embf_arc_set_value?.(ptr, v);
                    break;
                default:
                    log("warn", `set_value: "${action.target}" is not a numeric widget`);
                    break;
            }
            if (typeof bindField === "string") {
                refreshPreviewBindings(page);
            }
            break;
        }
        case "set_checked": {
            const ptr = idToObjPtr.get(action.target);
            if (!ptr) return;
            const page = currentProject.pages[currentPageIndex];
            const targetComp = page ? findComponentById(page.components, action.target) : null;
            const on = action.checked ? 1 : 0;
            switch (targetComp?.type) {
                case "switch":
                    wasm._embf_switch_set_state?.(ptr, on);
                    break;
                case "checkbox":
                    wasm._embf_checkbox_set_state?.(ptr, on);
                    break;
                default:
                    log("warn", `set_checked: "${action.target}" is not a switch/checkbox`);
                    break;
            }
            break;
        }
        case "set_hidden": {
            const ptr = idToObjPtr.get(action.target);
            if (!ptr) return;
            if (action.hidden) {
                // lv_obj_add_flag(obj, LV_OBJ_FLAG_HIDDEN) — flag value 1
                wasm._embf_obj_set_hidden?.(ptr, 1);
            } else {
                wasm._embf_obj_set_hidden?.(ptr, 0);
            }
            break;
        }
        case "set_theme": {
            if ("dark" in action) {
                previewDarkOverride = action.dark;
            } else {
                previewDarkOverride = !!eventValue;
            }
            applyEmbfThemeFromProject(currentProject);
            break;
        }
        case "set_locale": {
            const loc = typeof action.locale === "string" ? action.locale.trim() : "";
            if (!loc) {
                return;
            }
            previewLocale = loc;
            if (previewLocaleSelect) {
                previewLocaleSelect.value = loc;
            }
            refreshPreviewLocaleText();
            break;
        }
        case "select_button_group": {
            const members = Array.isArray(action.members) ? action.members.filter(Boolean) : [];
            const active = typeof action.active === "string" ? action.active : "";
            if (members.length < 2 || !active) {
                return;
            }
            applyButtonGroupSelection(members, active, action.selectedStyles);
            break;
        }
        case "play_animations": {
            const r = playWidgetAnimationsOnCurrentPage();
            if (!r.ok && r.reason && statusEl) {
                statusEl.textContent = r.reason;
            } else if (statusEl && r.started) {
                statusEl.textContent = `Playing ${r.started} animation(s)…`;
            }
            break;
        }
    }
}

// ── Design overlay (select / move widgets) ────────────────────────────────────
if (designModeCheck) {
    designMode = designModeCheck.checked;
    designModeCheck.addEventListener("change", () => {
        designMode = designModeCheck.checked;
        if (!designMode) {
            selectedComponentOrder = [];
            inspectorShowingPage = false;
            dragState = null;
            pendingDrag = null;
            marqueeState = null;
        } else {
            canvasSwipeTrack = null;
        }
        setDesignPointerMode();
        drawDesignOverlay();
        renderInspector();
    });
}

function setDesignPointerMode() {
    if (!designOverlay || !canvas) {
        return;
    }
    if (designMode) {
        designOverlay.style.pointerEvents = "auto";
        canvas.style.pointerEvents = "none";
    } else {
        designOverlay.style.pointerEvents = "none";
        canvas.style.pointerEvents = "auto";
    }
}

function resizeDesignOverlay() {
    applyPreviewLayout();
}

/**
 * Hit-test component at display coordinates (parent-relative x/y).
 * When several widgets overlap, prefer `image` then the smallest area (most specific target).
 * @returns {{ comp: object, absX: number, absY: number } | null}
 */
function hitTestAt(page, px, py) {
    /** @type {{ comp: object, absX: number, absY: number, area: number, depth: number }[]} */
    const hits = [];

    /** @param {object[]} components @param {number} parentX @param {number} parentY @param {number} depth */
    function walk(components, parentX, parentY, depth) {
        for (const c of components ?? []) {
            if (c.hidden) {
                continue;
            }
            const ax = parentX + (Number(c.x) || 0);
            const ay = parentY + (Number(c.y) || 0);
            const w = Math.max(1, Number(c.width) || 1);
            const h = Math.max(1, Number(c.height) || 1);
            if (px >= ax && px < ax + w && py >= ay && py < ay + h) {
                hits.push({ comp: c, absX: ax, absY: ay, area: w * h, depth });
                if (c.children?.length) {
                    walk(c.children, ax, ay, depth + 1);
                }
            }
        }
    }
    walk(page.components ?? [], 0, 0, 0);
    if (hits.length === 0) {
        return null;
    }
    hits.sort((a, b) => {
        const ai = a.comp.type === "image" ? 0 : 1;
        const bi = b.comp.type === "image" ? 0 : 1;
        if (ai !== bi) {
            return ai - bi;
        }
        if (a.area !== b.area) {
            return a.area - b.area;
        }
        return b.depth - a.depth;
    });
    const best = hits[0];
    return { comp: best.comp, absX: best.absX, absY: best.absY };
}

/** @returns {{ id: string; ax: number; ay: number; width: number; height: number }[]} */
function listAllWidgetsAbsRects(page) {
    /** @type {{ id: string; ax: number; ay: number; width: number; height: number }[]} */
    const out = [];
    /** @param {object[]} components @param {number} parentX @param {number} parentY */
    function walk(components, parentX, parentY) {
        for (const c of components ?? []) {
            const ax = parentX + c.x;
            const ay = parentY + c.y;
            out.push({ id: c.id, ax, ay, width: c.width, height: c.height });
            if (c.children?.length) {
                walk(c.children, ax, ay);
            }
        }
    }
    walk(page.components ?? [], 0, 0);
    return out;
}

/** Axis-aligned intersection (closed boxes, logical pixels). */
function rectsIntersect(ax, ay, aw, ah, bx, by, bw, bh) {
    return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

function normalizedMarqueeRect(m) {
    const x = Math.min(m.ox, m.x);
    const y = Math.min(m.oy, m.y);
    const w = Math.abs(m.x - m.ox);
    const h = Math.abs(m.y - m.oy);
    return { x, y, w, h };
}

/** Ids that intersect the marquee rect, in tree preorder (parents before children). */
function idsInMarqueeRect(page, rect) {
    const all = listAllWidgetsAbsRects(page);
    const chosen = [];
    for (const w of all) {
        if (rectsIntersect(rect.x, rect.y, rect.w, rect.h, w.ax, w.ay, w.width, w.height)) {
            chosen.push(w.id);
        }
    }
    return chosen;
}

/** Match `componentOutsetPadding` in embfComponentModel (LVGL draws outside widget box). */
function componentOutsetPadding(type) {
    switch (type) {
        case "slider":
        case "bar":
            return { l: 14, t: 6, r: 14, b: 6 };
        case "switch":
            return { l: 10, t: 4, r: 10, b: 4 };
        case "arc":
        case "knob":
            return { l: 8, t: 8, r: 8, b: 8 };
        case "dropdown":
        case "roller":
            return { l: 2, t: 2, r: 2, b: 4 };
        default:
            return { l: 0, t: 0, r: 0, b: 0 };
    }
}

/** Union of group children + knob/switch outset (for overlay and hit tests). */
function groupVisualBounds(comp, absX, absY) {
    const kids = comp.children ?? [];
    if (!kids.length) {
        return { x: absX, y: absY, width: comp.width, height: comp.height };
    }
    let left = absX + comp.width;
    let top = absY + comp.height;
    let right = absX;
    let bottom = absY;
    for (const ch of kids) {
        const p = componentOutsetPadding(ch.type);
        const cx = absX + ch.x;
        const cy = absY + ch.y;
        left = Math.min(left, cx - p.l);
        top = Math.min(top, cy - p.t);
        right = Math.max(right, cx + ch.width + p.r);
        bottom = Math.max(bottom, cy + ch.height + p.b);
    }
    return {
        x: left,
        y: top,
        width: Math.max(1, right - left),
        height: Math.max(1, bottom - top)
    };
}

function getAbsBounds(page, componentId) {
    /** @param {object[]} components @param {number} parentX @param {number} parentY */
    function walk(components, parentX, parentY) {
        for (const c of components ?? []) {
            const ax = parentX + c.x;
            const ay = parentY + c.y;
            if (c.id === componentId) {
                if (c.type === "container" || c.type === "panel") {
                    return groupVisualBounds(c, ax, ay);
                }
                return { x: ax, y: ay, width: c.width, height: c.height };
            }
            if (c.children?.length) {
                const inner = walk(c.children, ax, ay);
                if (inner) {
                    return inner;
                }
            }
        }
        return null;
    }
    return walk(page.components ?? [], 0, 0);
}

/** Bounds of all page widgets except ids being dragged (for magnetic snap). */
function collectSnapTargets(page, excludeIds) {
    /** @type {{ id: string, left: number, right: number, top: number, bottom: number, cx: number, cy: number }[]} */
    const out = [];
    for (const c of flatComponentsList(page.components)) {
        if (excludeIds.has(c.id)) {
            continue;
        }
        const b = getAbsBounds(page, c.id);
        if (!b) {
            continue;
        }
        out.push({
            id: c.id,
            left: b.x,
            right: b.x + b.width,
            top: b.y,
            bottom: b.y + b.height,
            cx: b.x + b.width / 2,
            cy: b.y + b.height / 2
        });
    }
    return out;
}

/** Selection bounding box at the current drag offset. */
function dragSelectionBox(items, dx, dy) {
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    for (const it of items) {
        const x = it.startAbsX + dx;
        const y = it.startAbsY + dy;
        left = Math.min(left, x);
        top = Math.min(top, y);
        right = Math.max(right, x + it.width);
        bottom = Math.max(bottom, y + it.height);
    }
    return {
        left,
        top,
        right,
        bottom,
        cx: (left + right) / 2,
        cy: (top + bottom) / 2
    };
}

/**
 * Snap selection to nearby widget edges/centers on X and Y.
 * @returns {{ dx: number, dy: number, guides: { axis: string, pos: number, crossStart: number, crossEnd: number }[] }}
 */
function magneticSnapAdjust(page, items, dx, dy, excludeIds) {
    const targets = collectSnapTargets(page, excludeIds);
    if (!targets.length) {
        return { dx, dy, guides: [] };
    }

    const box = dragSelectionBox(items, dx, dy);
    const edges = {
        left: box.left,
        right: box.right,
        top: box.top,
        bottom: box.bottom,
        cx: box.cx,
        cy: box.cy
    };

    let snapDx = 0;
    let snapDy = 0;
    let bestX = DESIGN_SNAP_THRESHOLD + 1;
    let bestY = DESIGN_SNAP_THRESHOLD + 1;
    /** @type {{ axis: string, pos: number, crossStart: number, crossEnd: number } | null} */
    let guideX = null;
    /** @type {{ axis: string, pos: number, crossStart: number, crossEnd: number } | null} */
    let guideY = null;

    const xPairs = [
        ["left", "left"],
        ["right", "right"],
        ["left", "right"],
        ["right", "left"],
        ["cx", "cx"]
    ];
    const yPairs = [
        ["top", "top"],
        ["bottom", "bottom"],
        ["top", "bottom"],
        ["bottom", "top"],
        ["cy", "cy"]
    ];

    for (const t of targets) {
        for (const [me, te] of xPairs) {
            const mv = edges[me];
            const tv = t[te];
            const dist = Math.abs(mv - tv);
            if (dist <= DESIGN_SNAP_THRESHOLD && dist < bestX) {
                bestX = dist;
                snapDx = tv - mv;
                guideX = {
                    axis: "x",
                    pos: Math.round(tv),
                    crossStart: 0,
                    crossEnd: displayHeight
                };
            }
        }
        for (const [me, te] of yPairs) {
            const mv = edges[me];
            const tv = t[te];
            const dist = Math.abs(mv - tv);
            if (dist <= DESIGN_SNAP_THRESHOLD && dist < bestY) {
                bestY = dist;
                snapDy = tv - mv;
                guideY = {
                    axis: "y",
                    pos: Math.round(tv),
                    crossStart: 0,
                    crossEnd: displayWidth
                };
            }
        }
    }

    const guides = [];
    if (guideX) {
        guides.push(guideX);
    }
    if (guideY) {
        guides.push(guideY);
    }
    return { dx: dx + snapDx, dy: dy + snapDy, guides };
}

function drawSnapGuides(guides) {
    if (!designCtx || !guides?.length) {
        return;
    }
    designCtx.save();
    designCtx.strokeStyle = "rgba(236, 72, 153, 0.95)";
    designCtx.lineWidth = 1;
    designCtx.setLineDash([6, 4]);
    for (const g of guides) {
        if (g.axis === "x") {
            designCtx.beginPath();
            designCtx.moveTo(g.pos + 0.5, g.crossStart);
            designCtx.lineTo(g.pos + 0.5, g.crossEnd);
            designCtx.stroke();
        } else if (g.axis === "y") {
            designCtx.beginPath();
            designCtx.moveTo(g.crossStart, g.pos + 0.5);
            designCtx.lineTo(g.crossEnd, g.pos + 0.5);
            designCtx.stroke();
        }
    }
    designCtx.restore();
}

/** @param {object[]} components @param {object[]} out */
function collectImageComponents(components, out) {
    for (const c of components ?? []) {
        if (c.type === "image") {
            out.push(c);
        }
        if (c.children?.length) {
            collectImageComponents(c.children, out);
        }
    }
}

/**
 * Bounds for HTML image overlay: prefer LVGL on-screen coords from WASM (matches placeholder box).
 * @param {object} page
 * @param {string} componentId
 * @returns {{ x: number, y: number, width: number, height: number } | null}
 */
function resolveImageOverlayBounds(page, componentId) {
    const ptr = idToObjPtr.get(componentId);
    const wasm = WasmModule;
    if (
        wasmReady &&
        wasm &&
        ptr &&
        typeof wasm._embf_obj_get_screen_coords === "function" &&
        typeof wasm._malloc === "function"
    ) {
        if (!imageOverlayBoundsBuf) {
            imageOverlayBoundsBuf = wasm._malloc(16);
        }
        if (imageOverlayBoundsBuf) {
            if (typeof wasm._embf_main_loop === "function") {
                wasm._embf_main_loop();
            }
            wasm._embf_obj_get_screen_coords(ptr, imageOverlayBoundsBuf);
            const base = imageOverlayBoundsBuf >> 2;
            const x = wasm.HEAP32[base];
            const y = wasm.HEAP32[base + 1];
            const w = wasm.HEAP32[base + 2];
            const h = wasm.HEAP32[base + 3];
            if (
                w > 0 &&
                h > 0 &&
                x >= -4 &&
                y >= -4 &&
                x < displayWidth + 4 &&
                y < displayHeight + 4
            ) {
                return { x, y, width: w, height: h };
            }
        }
    }
    return getAbsBounds(page, componentId);
}

/** Resolve preview URI for an image widget `src` (project.images id or inferred file). */
function resolveImageAssetUri(src) {
    const id = String(src ?? "").trim();
    if (!id) {
        return "";
    }
    if (imageAssetUris[id]) {
        return imageAssetUris[id];
    }
    const entry = currentProject?.images?.find(e => e.id === id);
    if (entry && imageAssetUris[entry.id]) {
        return imageAssetUris[entry.id];
    }
    return "";
}

/** After layout / page build, sync overlays once LVGL has settled. */
function scheduleImageOverlaySync() {
    requestAnimationFrame(() => {
        syncImagePreviewOverlays();
    });
}

/** Draw project image files over the WASM canvas (WASM has no embedded assets). */
function syncImagePreviewOverlays() {
    if (!imagePreviewLayer || !currentProject) {
        return;
    }
    imagePreviewLayer.innerHTML = "";
    const page = currentProject.pages[currentPageIndex];
    if (!page) {
        return;
    }
    /** @type {object[]} */
    const images = [];
    collectImageComponents(page.components, images);
    const z = previewZoom;
    for (const comp of images) {
        const src = String(comp.src ?? "").trim();
        const uri = resolveImageAssetUri(src);
        if (!uri) {
            continue;
        }
        const b = resolveImageOverlayBounds(page, comp.id);
        if (!b) {
            continue;
        }
        const img = document.createElement("img");
        img.src = uri;
        img.alt = src;
        img.dataset.componentId = comp.id;
        img.style.pointerEvents = "none";
        img.style.left = `${Math.max(0, Math.round(b.x * z))}px`;
        img.style.top = `${Math.max(0, Math.round(b.y * z))}px`;
        img.style.width = `${Math.max(1, Math.round(b.width * z))}px`;
        img.style.height = `${Math.max(1, Math.round(b.height * z))}px`;
        imagePreviewLayer.appendChild(img);
    }
}

function snapToGrid(v) {
    if (!designGridEnabled || DESIGN_GRID_SIZE < 2) {
        return Math.round(v);
    }
    return Math.round(v / DESIGN_GRID_SIZE) * DESIGN_GRID_SIZE;
}

/** @param {object[]} components */
function locateComponentParent(page, componentId) {
    /** @param {object[]} comps @param {number} pax @param {number} pay */
    function walk(comps, pax, pay) {
        for (const c of comps ?? []) {
            if (c.id === componentId) {
                return { comp: c, parentAbsX: pax, parentAbsY: pay };
            }
            if (c.children?.length) {
                const inner = walk(c.children, pax + c.x, pay + c.y);
                if (inner) {
                    return inner;
                }
            }
        }
        return null;
    }
    return walk(page.components ?? [], 0, 0);
}

/** @returns {string | null} */
function hitTestResizeHandle(page, px, py, componentId) {
    const b = getAbsBounds(page, componentId);
    if (!b) {
        return null;
    }
    const hs = RESIZE_HANDLE_PX;
    const handles = [
        ["nw", b.x, b.y],
        ["n", b.x + b.width / 2, b.y],
        ["ne", b.x + b.width, b.y],
        ["e", b.x + b.width, b.y + b.height / 2],
        ["se", b.x + b.width, b.y + b.height],
        ["s", b.x + b.width / 2, b.y + b.height],
        ["sw", b.x, b.y + b.height],
        ["w", b.x, b.y + b.height / 2]
    ];
    for (const [name, hx, hy] of handles) {
        if (Math.abs(px - hx) <= hs && Math.abs(py - hy) <= hs) {
            return name;
        }
    }
    return null;
}

function drawDesignGrid(ctx) {
    if (!designGridEnabled) {
        return;
    }
    const g = DESIGN_GRID_SIZE;
    ctx.save();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.06)";
    ctx.lineWidth = 1;
    for (let x = g; x < displayWidth; x += g) {
        ctx.beginPath();
        ctx.moveTo(x + 0.5, 0);
        ctx.lineTo(x + 0.5, displayHeight);
        ctx.stroke();
    }
    for (let y = g; y < displayHeight; y += g) {
        ctx.beginPath();
        ctx.moveTo(0, y + 0.5);
        ctx.lineTo(displayWidth, y + 0.5);
        ctx.stroke();
    }
    ctx.restore();
}

function drawResizeHandles(ctx, b) {
    const hs = 4;
    const pts = [
        [b.x, b.y],
        [b.x + b.width / 2, b.y],
        [b.x + b.width, b.y],
        [b.x + b.width, b.y + b.height / 2],
        [b.x + b.width, b.y + b.height],
        [b.x + b.width / 2, b.y + b.height],
        [b.x, b.y + b.height],
        [b.x, b.y + b.height / 2]
    ];
    ctx.save();
    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = "#007acc";
    ctx.lineWidth = 1;
    for (const [hx, hy] of pts) {
        ctx.fillRect(hx - hs, hy - hs, hs * 2, hs * 2);
        ctx.strokeRect(hx - hs + 0.5, hy - hs + 0.5, hs * 2, hs * 2);
    }
    ctx.restore();
}

/**
 * @param {string} handle
 * @param {{ startX: number, startY: number, startW: number, startH: number, parentAbsX: number, parentAbsY: number }} st
 * @param {number} px @param {number} py
 */
function boundsFromResize(handle, st, px, py) {
    const ax0 = st.parentAbsX + st.startX;
    const ay0 = st.parentAbsY + st.startY;
    const ax1 = ax0 + st.startW;
    const ay1 = ay0 + st.startH;
    let left = ax0;
    let top = ay0;
    let right = ax1;
    let bottom = ay1;
    if (handle.includes("e")) {
        right = px;
    }
    if (handle.includes("w")) {
        left = px;
    }
    if (handle.includes("s")) {
        bottom = py;
    }
    if (handle.includes("n")) {
        top = py;
    }
    if (right - left < MIN_WIDGET_SIZE) {
        if (handle.includes("w")) {
            left = right - MIN_WIDGET_SIZE;
        } else {
            right = left + MIN_WIDGET_SIZE;
        }
    }
    if (bottom - top < MIN_WIDGET_SIZE) {
        if (handle.includes("n")) {
            top = bottom - MIN_WIDGET_SIZE;
        } else {
            bottom = top + MIN_WIDGET_SIZE;
        }
    }
    return {
        x: Math.round(left - st.parentAbsX),
        y: Math.round(top - st.parentAbsY),
        width: Math.round(right - left),
        height: Math.round(bottom - top)
    };
}

function drawDesignOverlay() {
    if (!designCtx || !designOverlay) {
        return;
    }
    designCtx.clearRect(0, 0, displayWidth, displayHeight);
    if (!designMode || !currentProject) {
        return;
    }
    const page = currentProject.pages[currentPageIndex];
    if (!page) {
        return;
    }
    drawDesignGrid(designCtx);

    designCtx.strokeStyle = "#007acc";
    designCtx.lineWidth = 2;
    designCtx.setLineDash([4, 3]);

    if (resizeState?.preview) {
        const loc = locateComponentParent(page, resizeState.id);
        if (loc) {
            const abs = {
                x: loc.parentAbsX + resizeState.preview.x,
                y: loc.parentAbsY + resizeState.preview.y,
                width: resizeState.preview.width,
                height: resizeState.preview.height
            };
            designCtx.strokeRect(abs.x + 0.5, abs.y + 0.5, abs.width, abs.height);
            drawResizeHandles(designCtx, abs);
        }
        designCtx.setLineDash([]);
        return;
    }

    if (dragState) {
        drawSnapGuides(dragState.snapGuides);
        const dx = dragState.dx;
        const dy = dragState.dy;
        for (const item of dragState.items) {
            designCtx.strokeRect(
                Math.max(0, Math.round(item.startAbsX + dx)) + 0.5,
                Math.max(0, Math.round(item.startAbsY + dy)) + 0.5,
                item.width,
                item.height
            );
        }
        designCtx.setLineDash([]);
        return;
    }

    if (inspectorShowingPage) {
        designCtx.strokeRect(0.5, 0.5, displayWidth, displayHeight);
        designCtx.setLineDash([]);
    }

    if (!inspectorShowingPage || selectedComponentOrder.length > 0) {
        designCtx.strokeStyle = "#007acc";
        designCtx.lineWidth = 2;
        designCtx.setLineDash([4, 3]);
        for (const id of selectedComponentOrder) {
            const b = getAbsBounds(page, id);
            if (b) {
                designCtx.strokeRect(b.x + 0.5, b.y + 0.5, b.width, b.height);
            }
        }
        if (selectedComponentOrder.length === 1) {
            const b = getAbsBounds(page, selectedComponentOrder[0]);
            if (b) {
                drawResizeHandles(designCtx, b);
            }
        }
    }

    if (groupEditContainerId) {
        const gb = getAbsBounds(page, groupEditContainerId);
        if (gb) {
            designCtx.save();
            designCtx.strokeStyle = "rgba(255, 160, 0, 0.92)";
            designCtx.lineWidth = 2;
            designCtx.setLineDash([6, 4]);
            designCtx.strokeRect(gb.x + 0.5, gb.y + 0.5, gb.width, gb.height);
            designCtx.restore();
        }
    }

    if (marqueeState) {
        const norm = normalizedMarqueeRect(marqueeState);
        if (norm.w > 0 || norm.h > 0) {
            designCtx.save();
            designCtx.strokeStyle = "rgba(218, 165, 32, 0.95)";
            designCtx.lineWidth = 1;
            designCtx.setLineDash([3, 3]);
            designCtx.strokeRect(norm.x + 0.5, norm.y + 0.5, norm.w, norm.h);
            designCtx.restore();
        }
    }
    designCtx.setLineDash([]);
}

function overlayCoords(e) {
    const el = designOverlay ?? canvas;
    const rect = el.getBoundingClientRect();
    const scaleX = displayWidth / rect.width;
    const scaleY = displayHeight / rect.height;
    return {
        x: Math.round((e.clientX - rect.left) * scaleX),
        y: Math.round((e.clientY - rect.top) * scaleY)
    };
}

// ── Property inspector ────────────────────────────────────────────────────────

/** @param {object[]} components */
function findComponentById(components, id) {
    for (const c of components ?? []) {
        if (c.id === id) {
            return c;
        }
        if (c.children?.length) {
            const inner = findComponentById(c.children, id);
            if (inner) {
                return inner;
            }
        }
    }
    return null;
}

/** @param {object | null | undefined} c */
function isGroupComponent(c) {
    return (
        !!c &&
        (c.type === "container" || c.type === "panel") &&
        Array.isArray(c.children) &&
        c.children.length > 0
    );
}

/** Innermost container/panel that owns `targetId`, or the group id if `targetId` is the group. */
/** @param {object[]} components */
function findEnclosingGroupId(components, targetId) {
    /** @type {string | null} */
    let result = null;
    /** @param {object[]} comps @param {string | null} parentGroupId */
    function walk(comps, parentGroupId) {
        for (const c of comps ?? []) {
            if (c.id === targetId) {
                result = isGroupComponent(c) ? c.id : parentGroupId;
                return true;
            }
            if (c.children?.length) {
                const pg = isGroupComponent(c) ? c.id : parentGroupId;
                if (walk(c.children, pg)) {
                    return true;
                }
            }
        }
        return false;
    }
    walk(components, null);
    return result;
}

/** @param {object[]} components */
function isDescendantOf(components, descendantId, ancestorId) {
    if (descendantId === ancestorId) {
        return true;
    }
    const ancestor = findComponentById(components, ancestorId);
    if (!ancestor?.children?.length) {
        return false;
    }
    /** @param {object[]} comps */
    function walk(comps) {
        for (const c of comps ?? []) {
            if (c.id === descendantId) {
                return true;
            }
            if (c.children?.length && walk(c.children)) {
                return true;
            }
        }
        return false;
    }
    return walk(ancestor.children);
}

/** Page-level selection: whole group when not in group-edit mode. */
/** @param {object[]} components */
function unitedSelectionId(components, componentId) {
    return findEnclosingGroupId(components, componentId) ?? componentId;
}

/** @param {object[]} components @param {string[]} ids */
function collapseToUnitedSelection(components, ids) {
    /** @type {string[]} */
    const out = [];
    const seen = new Set();
    for (const id of ids) {
        const u = unitedSelectionId(components, id);
        if (!seen.has(u)) {
            seen.add(u);
            out.push(u);
        }
    }
    return out;
}

function groupEditBannerHtml() {
    if (!groupEditContainerId || !currentProject) {
        return "";
    }
    const page = currentProject.pages[currentPageIndex];
    const g = page ? findComponentById(page.components, groupEditContainerId) : null;
    const label = g?.id ?? groupEditContainerId;
    return (
        `<div class="inspector-group-edit-banner" style="margin:0 0 12px;padding:8px 10px;background:rgba(255,160,0,0.12);border:1px solid rgba(255,160,0,0.45);border-radius:4px;font-size:12px;line-height:1.4">` +
        `Editing group <strong>${esc(label)}</strong> — children can be selected independently. ` +
        `Press <kbd>Esc</kbd> or Done when finished.` +
        `</div>` +
        `<div class="inspector-layout-grid" style="margin-bottom:12px">` +
        layoutToolbarButton("exit-group-edit", "Done editing group") +
        `</div>`
    );
}

function exitGroupEditMode(keepGroupSelected = true) {
    const was = groupEditContainerId;
    groupEditContainerId = null;
    if (keepGroupSelected && was) {
        selectedComponentOrder = [was];
        inspectorShowingPage = false;
    }
    drawDesignOverlay();
    renderInspector();
    renderToolbarWidgetSelect();
}

/** @param {string} groupId @param {string | null} [childId] */
function enterGroupEditMode(groupId, childId) {
    groupEditContainerId = groupId;
    inspectorShowingPage = false;
    selectedComponentOrder = childId ? [childId] : [groupId];
    dragState = null;
    pendingDrag = null;
    marqueeState = null;
    drawDesignOverlay();
    renderInspector();
    renderToolbarWidgetSelect();
}

/** @param {object[]} components */
function flatComponentsList(components) {
    /** @type {object[]} */
    const out = [];
    for (const c of components ?? []) {
        out.push(c);
        if (c.children?.length) {
            out.push(...flatComponentsList(c.children));
        }
    }
    return out;
}

/** @param {object[]} components @param {number} [depth] @returns {Array<{ comp: object, depth: number }>} */
function flatComponentsListWithDepth(components, depth = 0) {
    /** @type {Array<{ comp: object, depth: number }>} */
    const out = [];
    for (const c of components ?? []) {
        out.push({ comp: c, depth });
        if (c.children?.length) {
            out.push(...flatComponentsListWithDepth(c.children, depth + 1));
        }
    }
    return out;
}

/** @returns {Array<{ sourcePageIndex: number, sourcePageId: string, sourcePageName: string, componentId: string, componentType: string, trigger: string, targetPageId: string, targetPageName: string, targetPageIndex: number, anim: string, time: number }>} */
function collectNavigateFlowsFromProject() {
    if (!currentProject) {
        return [];
    }
    /** @type {ReturnType<typeof collectNavigateFlowsFromProject>} */
    const flows = [];
    for (let pi = 0; pi < currentProject.pages.length; pi++) {
        const page = currentProject.pages[pi];
        for (const comp of flatComponentsList(page.components)) {
            for (const evt of comp.events ?? []) {
                for (const action of evt.actions ?? []) {
                    if (action.type !== "navigate") {
                        continue;
                    }
                    const ti = currentProject.pages.findIndex(p => p.id === action.target);
                    if (ti < 0) {
                        continue;
                    }
                    const target = currentProject.pages[ti];
                    flows.push({
                        sourcePageIndex: pi,
                        sourcePageId: page.id,
                        sourcePageName: page.name,
                        componentId: comp.id,
                        componentType: comp.type,
                        trigger: evt.trigger,
                        targetPageId: target.id,
                        targetPageName: target.name,
                        targetPageIndex: ti,
                        anim: action.anim ?? "none",
                        time: action.time ?? 300
                    });
                }
            }
        }
    }
    return flows;
}

/** @returns {Array<{ kind: string, sourcePageIndex: number, sourcePageName: string, targetPageName: string, targetPageId: string, direction?: string, componentId?: string, componentType?: string, trigger?: string, anim: string, time: number }>} */
function collectPageSwipeFlowsFromProject() {
    if (!currentProject) {
        return [];
    }
    /** @type {ReturnType<typeof collectPageSwipeFlowsFromProject>} */
    const flows = [];
    for (let pi = 0; pi < currentProject.pages.length; pi++) {
        const page = currentProject.pages[pi];
        for (const swipe of page.swipes ?? []) {
            const ti = currentProject.pages.findIndex(p => p.id === swipe.target);
            if (ti < 0) {
                continue;
            }
            const target = currentProject.pages[ti];
            flows.push({
                kind: "swipe",
                sourcePageIndex: pi,
                sourcePageName: page.name,
                targetPageId: target.id,
                targetPageName: target.name,
                direction: swipe.direction,
                anim: swipe.anim ?? "none",
                time: swipe.time ?? 300
            });
        }
    }
    return flows;
}

function collectAllFlowsFromProject() {
    const component = collectNavigateFlowsFromProject().map(f => ({ kind: "component", ...f }));
    const swipe = collectPageSwipeFlowsFromProject();
    return [...component, ...swipe];
}

/** Map pointer delta to swipe direction (matches LVGL `lv_dir_t`). */
function detectSwipeDirection(dx, dy) {
    const adx = Math.abs(dx);
    const ady = Math.abs(dy);
    if (adx < PAGE_SWIPE_MIN_PX && ady < PAGE_SWIPE_MIN_PX) {
        return null;
    }
    if (adx >= ady) {
        return dx < 0 ? "left" : "right";
    }
    return dy < 0 ? "top" : "bottom";
}

/** Run a page swipe flow in preview when the user swipes on the canvas (run mode only). */
function tryExecutePageSwipe(dx, dy) {
    if (designMode || !currentProject) {
        return false;
    }
    const direction = detectSwipeDirection(dx, dy);
    if (!direction) {
        return false;
    }
    const page = currentProject.pages[currentPageIndex];
    const swipe = (page.swipes ?? []).find(s => s.direction === direction);
    if (!swipe) {
        return false;
    }
    dispatchAction(
        {
            type: "navigate",
            target: swipe.target,
            anim: swipe.anim,
            time: swipe.time,
            delay: swipe.delay,
            autoDel: swipe.autoDel
        },
        null,
        page
    );
    return true;
}

function syncFlowKindFields() {
    const isSwipe = flowKind?.value === "swipe";
    if (flowComponentFields) {
        flowComponentFields.hidden = isSwipe;
    }
    if (flowSwipeFields) {
        flowSwipeFields.hidden = !isSwipe;
    }
}

function populateFlowForm() {
    if (!currentProject) {
        return;
    }
    const pages = currentProject.pages;
    if (flowFromPage) {
        const prev = flowFromPage.value;
        flowFromPage.innerHTML = "";
        pages.forEach((p, i) => {
            const opt = document.createElement("option");
            opt.value = String(i);
            opt.textContent = `${p.name} (${p.id})`;
            flowFromPage.appendChild(opt);
        });
        flowFromPage.value =
            prev && pages[Number(prev)] !== undefined
                ? prev
                : isWorkspaceFlowActive() && _fgSelectedPageIndex >= 0
                  ? String(_fgSelectedPageIndex)
                  : String(currentPageIndex);
    }
    if (flowToPage) {
        flowToPage.innerHTML = "";
        pages.forEach(p => {
            const opt = document.createElement("option");
            opt.value = p.id;
            opt.textContent = `${p.name} (${p.id})`;
            flowToPage.appendChild(opt);
        });
    }
    populateFlowComponentSelect();
}

function populateFlowComponentSelect() {
    if (!flowComponent || !flowFromPage || !currentProject) {
        return;
    }
    const pi = parseInt(flowFromPage.value, 10) || 0;
    const page = currentProject.pages[pi];
    const prev = flowComponent.value;
    flowComponent.innerHTML = "";
    if (!page) {
        return;
    }
    for (const comp of flatComponentsList(page.components)) {
        const opt = document.createElement("option");
        opt.value = comp.id;
        opt.textContent = `${comp.id} (${comp.type})`;
        flowComponent.appendChild(opt);
    }
    if (prev && [...flowComponent.options].some(o => o.value === prev)) {
        flowComponent.value = prev;
    }
}

// ── Workspace tabs (closable page tabs + navigation flow) ───────────────────

function nextWorkspaceTabId() {
    workspaceTabIdSeq += 1;
    return `ws-tab-${workspaceTabIdSeq}`;
}

/** @returns {WorkspaceTabEntry | undefined} */
function getActiveWorkspaceTab() {
    return workspaceTabs.find(t => t.id === activeWorkspaceTabId) ?? workspaceTabs[0];
}

function isWorkspacePageActive() {
    return getActiveWorkspaceTab()?.kind === "page";
}

function isWorkspaceFlowActive() {
    return getActiveWorkspaceTab()?.kind === "flow";
}

function resolveWorkspacePageIndex(pageId) {
    if (!currentProject) {
        return -1;
    }
    return currentProject.pages.findIndex(p => p.id === pageId);
}

function getWorkspaceTabLabel(tab) {
    if (tab.kind === "flow") {
        return "Navigation flow";
    }
    const idx = resolveWorkspacePageIndex(tab.pageId);
    const page = idx >= 0 ? currentProject?.pages[idx] : null;
    return page?.name || page?.id || "Page";
}

function applyWorkspacePanelsForActiveTab() {
    const tab = getActiveWorkspaceTab();
    const showFlow = tab?.kind === "flow";
    if (workspacePanelPreview) {
        workspacePanelPreview.classList.toggle("active", !showFlow);
        workspacePanelPreview.hidden = showFlow;
    }
    if (workspacePanelFlow) {
        workspacePanelFlow.classList.toggle("active", !!showFlow);
        workspacePanelFlow.hidden = !showFlow;
    }
    if (showFlow) {
        populateFlowForm();
        renderFlowPanel();
        requestAnimationFrame(() => {
            if (isWorkspaceFlowActive()) {
                renderFlowGraph();
            }
        });
    } else {
        refreshPreviewLayoutAfterPanelChange();
        schedulePreviewAutoZoomReflowAfterLayout();
        drawDesignOverlay();
    }
}

function renderWorkspaceTabs() {
    if (!workspaceTabsListEl) {
        return;
    }
    workspaceTabsListEl.innerHTML = "";
    for (const tab of workspaceTabs) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className =
            "workspace-tab-item" +
            (tab.id === activeWorkspaceTabId ? " active" : "") +
            (tab.kind === "flow" ? " flow-tab" : "");
        btn.setAttribute("role", "tab");
        btn.setAttribute("aria-selected", tab.id === activeWorkspaceTabId ? "true" : "false");
        btn.dataset.tabId = tab.id;

        const label = document.createElement("span");
        label.className = "workspace-tab-label";
        label.textContent = getWorkspaceTabLabel(tab);
        btn.appendChild(label);

        const close = document.createElement("button");
        close.type = "button";
        close.className = "workspace-tab-close";
        close.setAttribute("aria-label", `Close ${getWorkspaceTabLabel(tab)}`);
        close.textContent = "×";
        close.dataset.tabClose = tab.id;
        btn.appendChild(close);

        workspaceTabsListEl.appendChild(btn);
    }
}

function activateWorkspaceTab(tabId) {
    if (!workspaceTabs.some(t => t.id === tabId)) {
        return;
    }
    activeWorkspaceTabId = tabId;
    renderWorkspaceTabs();
    const tab = getActiveWorkspaceTab();
    if (!tab || !currentProject) {
        applyWorkspacePanelsForActiveTab();
        return;
    }
    if (tab.kind === "flow") {
        applyWorkspacePanelsForActiveTab();
        return;
    }
    const idx = resolveWorkspacePageIndex(tab.pageId);
    if (idx < 0) {
        applyWorkspacePanelsForActiveTab();
        return;
    }
    if (idx !== currentPageIndex) {
        navigateToPageIndex(idx, { skipTabSync: true });
    } else {
        applyWorkspacePanelsForActiveTab();
        renderPageList();
        renderInspector();
        renderToolbarWidgetSelect();
    }
}

function closeWorkspaceTab(tabId) {
    const idx = workspaceTabs.findIndex(t => t.id === tabId);
    if (idx < 0) {
        return;
    }
    const closing = workspaceTabs[idx];
    if (workspaceTabs.length === 1) {
        if (closing.kind === "flow" && currentProject?.pages.length) {
            const page = currentProject.pages[currentPageIndex] ?? currentProject.pages[0];
            workspaceTabs = [{ id: nextWorkspaceTabId(), kind: "page", pageId: page.id }];
            activeWorkspaceTabId = workspaceTabs[0].id;
            renderWorkspaceTabs();
            activateWorkspaceTab(activeWorkspaceTabId);
        }
        return;
    }
    const wasActive = activeWorkspaceTabId === tabId;
    workspaceTabs.splice(idx, 1);
    if (wasActive) {
        activeWorkspaceTabId = workspaceTabs[Math.min(idx, workspaceTabs.length - 1)].id;
        activateWorkspaceTab(activeWorkspaceTabId);
    } else {
        renderWorkspaceTabs();
    }
}

/** @returns {WorkspaceTabEntry | undefined} */
function ensurePageTabForIndex(pageIndex, createIfMissing = true) {
    if (!currentProject) {
        return undefined;
    }
    const page = currentProject.pages[pageIndex];
    if (!page) {
        return undefined;
    }
    let tab = workspaceTabs.find(t => t.kind === "page" && t.pageId === page.id);
    if (!tab && createIfMissing) {
        tab = { id: nextWorkspaceTabId(), kind: "page", pageId: page.id };
        workspaceTabs.push(tab);
        renderWorkspaceTabs();
    }
    return tab;
}

function openPageTabByIndex(pageIndex, activate = true) {
    const tab = ensurePageTabForIndex(pageIndex, true);
    if (!tab) {
        return;
    }
    if (activate) {
        activateWorkspaceTab(tab.id);
    } else {
        renderWorkspaceTabs();
    }
}

function openPageTabByPageId(pageId, activate = true) {
    const idx = resolveWorkspacePageIndex(pageId);
    if (idx >= 0) {
        openPageTabByIndex(idx, activate);
    }
}

function openFlowWorkspaceTab(activate = true) {
    let tab = workspaceTabs.find(t => t.kind === "flow");
    if (!tab) {
        tab = { id: nextWorkspaceTabId(), kind: "flow" };
        workspaceTabs.push(tab);
        renderWorkspaceTabs();
    }
    if (activate) {
        activateWorkspaceTab(tab.id);
    }
}

function resetWorkspaceTabsForProject(pageIndex) {
    if (!currentProject?.pages.length) {
        workspaceTabs = [];
        activeWorkspaceTabId = "";
        renderWorkspaceTabs();
        return;
    }
    const idx = Math.min(Math.max(0, pageIndex), currentProject.pages.length - 1);
    const page = currentProject.pages[idx];
    workspaceTabs = [{ id: nextWorkspaceTabId(), kind: "page", pageId: page.id }];
    activeWorkspaceTabId = workspaceTabs[0].id;
    renderWorkspaceTabs();
    applyWorkspacePanelsForActiveTab();
}

function pruneWorkspaceTabs() {
    if (!currentProject) {
        workspaceTabs = [];
        activeWorkspaceTabId = "";
        return;
    }
    const pageIds = new Set(currentProject.pages.map(p => p.id));
    workspaceTabs = workspaceTabs.filter(t => t.kind === "flow" || pageIds.has(t.pageId));
    if (!workspaceTabs.length) {
        resetWorkspaceTabsForProject(currentPageIndex);
        return;
    }
    if (!workspaceTabs.some(t => t.id === activeWorkspaceTabId)) {
        activeWorkspaceTabId = workspaceTabs[0].id;
    }
}

function openNextPageInNewTab() {
    if (!currentProject?.pages.length) {
        return;
    }
    for (const page of currentProject.pages) {
        if (!workspaceTabs.some(t => t.kind === "page" && t.pageId === page.id)) {
            const tab = { id: nextWorkspaceTabId(), kind: "page", pageId: page.id };
            workspaceTabs.push(tab);
            activateWorkspaceTab(tab.id);
            return;
        }
    }
    const nextIdx = (currentPageIndex + 1) % currentProject.pages.length;
    openPageTabByIndex(nextIdx, true);
}

if (workspaceTabsListEl) {
    workspaceTabsListEl.addEventListener("click", e => {
        const t = e.target;
        if (!(t instanceof Element)) {
            return;
        }
        const closeBtn = t.closest("[data-tab-close]");
        if (closeBtn instanceof HTMLElement) {
            e.stopPropagation();
            const tabId = closeBtn.getAttribute("data-tab-close");
            if (tabId) {
                closeWorkspaceTab(tabId);
            }
            return;
        }
        const tabBtn = t.closest(".workspace-tab-item[data-tab-id]");
        if (tabBtn instanceof HTMLElement) {
            const tabId = tabBtn.getAttribute("data-tab-id");
            if (tabId) {
                activateWorkspaceTab(tabId);
            }
        }
    });
}

if (btnWorkspaceTabAdd) {
    btnWorkspaceTabAdd.addEventListener("click", () => openNextPageInNewTab());
}

// ── Toolbar dropdown menus ───────────────────────────────────────────────────

function closeAllToolbarMenus() {
    document.querySelectorAll(".tb-menu-panel").forEach(p => {
        p.hidden = true;
    });
    document.querySelectorAll(".tb-menu-trigger.open").forEach(t => {
        t.classList.remove("open");
        t.setAttribute("aria-expanded", "false");
    });
}

function toggleToolbarMenu(triggerId, panelId) {
    const trigger = document.getElementById(triggerId);
    const panel = document.getElementById(panelId);
    if (!trigger || !panel) {
        return;
    }
    const willOpen = panel.hidden;
    closeAllToolbarMenus();
    if (willOpen) {
        panel.hidden = false;
        trigger.classList.add("open");
        trigger.setAttribute("aria-expanded", "true");
    }
}

[
    ["tb-menu-project-trigger", "tb-menu-project"],
    ["tb-menu-edit-trigger", "tb-menu-edit"],
    ["tb-menu-view-trigger", "tb-menu-view"]
].forEach(([tid, pid]) => {
    const trigger = document.getElementById(tid);
    if (!trigger) {
        return;
    }
    trigger.addEventListener("click", e => {
        e.stopPropagation();
        toggleToolbarMenu(tid, pid);
    });
});

document.querySelectorAll(".tb-menu-panel").forEach(panel => {
    panel.addEventListener("click", e => e.stopPropagation());
});

document.addEventListener("click", e => {
    if (e.target instanceof Element && e.target.closest(".tb-menu-wrap")) {
        return;
    }
    closeAllToolbarMenus();
});

// ── Navigation Graph ──────────────────────────────────────────────────────────

/**
 * Computed during renderFlowGraph — used by mouse handlers for hit-testing.
 * @type {Array<{page: object, index: number, x: number, y: number, w: number, h: number}>}
 */
let _fgNodes = [];

/**
 * Computed during renderFlowGraph — visual edges (uni- or bidirectional) for hit-testing.
 * @type {Array<{ bidirectional: boolean, flows: object[], labels: Array<{ flow: object, flowIndex: number, mx: number, my: number }>, sx: number, sy: number, tx: number, ty: number, cp1x: number, cp1y: number, cp2x: number, cp2y: number, dashStyle: number[] }>}
 */
let _fgEdges = [];

let _fgHoverEdge = -1;
/** Label index within hovered edge (-1 = edge body only). */
let _fgHoverEdgeLabel = -1;
let _fgSelectedPageIndex = -1;
/** @type {{ sourceIndex: number } | null} */
let _fgLinkPick = null;
/** @type {object | null} flow row being edited (replaced on save) */
let _fgEditingFlow = null;
/** @type {{ pageIndex: number, pointerX: number, pointerY: number, nodeX: number, nodeY: number, moved: boolean } | null} */
let _fgDrag = null;
/** @type {{ pageIndex: number, x: number, y: number } | null} */
let _fgDragPos = null;
let _fgSuppressClick = false;

const FG_NODE_W = 148;
const FG_NODE_H = 52;
const FG_GAP_X = 40;
const FG_GAP_Y = 64;
const FG_PAD = 16;
const FG_PAD_TOP = 52;
const FG_DEL_R = 8;
const FG_DRAG_THRESHOLD = 4;

function getFlowsFromPage(pageIndex) {
    return collectAllFlowsFromProject().filter(f => f.sourcePageIndex === pageIndex);
}

function _fgFlowEdgeLabel(f) {
    if (f.kind === "swipe") {
        const dir = f.direction === "top" ? "↑" : f.direction === "bottom" ? "↓" : f.direction === "left" ? "←" : "→";
        return `swipe ${dir}`;
    }
    const trig = f.trigger === "clicked" ? "click" : f.trigger;
    return `${f.componentId} · ${trig}`;
}

function setFlowLinkMode(on) {
    if (flowGraphWrap) {
        flowGraphWrap.classList.toggle("linking", on);
    }
    if (btnFlowAddLink) {
        btnFlowAddLink.classList.toggle("active", on);
    }
    if (flowLinkHint) {
        flowLinkHint.hidden = !on;
    }
    if (!on) {
        _fgLinkPick = null;
    }
}

function hideFlowTransitionEditor() {
    _fgEditingFlow = null;
    if (flowTransitionEditor) {
        flowTransitionEditor.hidden = true;
    }
}

function clearFlowGraphSelection() {
    _fgSelectedPageIndex = -1;
    if (flowPageInspector) {
        flowPageInspector.hidden = true;
    }
    if (btnFlowOpenPagePreview) {
        btnFlowOpenPagePreview.hidden = true;
    }
    hideFlowTransitionEditor();
    renderFlowGraph();
}

function selectFlowGraphPage(pageIndex) {
    _fgSelectedPageIndex = pageIndex;
    setFlowLinkMode(false);
    if (flowPageInspector) {
        flowPageInspector.hidden = false;
    }
    if (btnFlowOpenPagePreview) {
        btnFlowOpenPagePreview.hidden = false;
    }
    const page = currentProject?.pages[pageIndex];
    if (flowPageInspectorTitle && page) {
        flowPageInspectorTitle.textContent = page.name || page.id;
    }
    renderFlowPageTransitions(pageIndex);
    hideFlowTransitionEditor();
    renderFlowGraph();
}

function showFlowTransitionEditor(mode, sourcePageIndex, prefill) {
    _fgEditingFlow = mode === "edit" && prefill ? prefill : null;
    populateFlowForm();
    if (flowFromPage) {
        flowFromPage.value = String(sourcePageIndex);
    }
    if (flowTransitionEditor) {
        flowTransitionEditor.hidden = false;
    }
    if (flowTransitionEditorTitle) {
        flowTransitionEditorTitle.textContent = mode === "edit" ? "Edit transition" : "New transition";
    }
    if (prefill) {
        if (prefill.kind === "swipe" && flowKind) {
            flowKind.value = "swipe";
            syncFlowKindFields();
            if (flowSwipeDirection) {
                flowSwipeDirection.value = prefill.direction;
            }
        } else if (flowKind) {
            flowKind.value = "component";
            syncFlowKindFields();
            populateFlowComponentSelect();
            if (flowComponent && prefill.componentId) {
                flowComponent.value = prefill.componentId;
            }
            if (flowTrigger && prefill.trigger) {
                flowTrigger.value = prefill.trigger;
            }
        }
        if (flowToPage && prefill.targetPageId) {
            flowToPage.value = prefill.targetPageId;
        }
        if (flowAnim && prefill.anim) {
            flowAnim.value = prefill.anim;
        }
        if (flowTime != null && prefill.time != null) {
            flowTime.value = String(prefill.time);
        }
    } else {
        syncFlowKindFields();
        const pages = currentProject?.pages ?? [];
        if (flowToPage && pages.length > 1) {
            const other = pages.find((_, i) => i !== sourcePageIndex);
            if (other) {
                flowToPage.value = other.id;
            }
        }
    }
    syncFlowTimeField();
}

function removeFlowFromProject(f) {
    if (f.kind === "swipe") {
        vscode.postMessage({
            type: "removePageSwipeFlow",
            sourcePageIndex: f.sourcePageIndex,
            direction: f.direction
        });
    } else {
        vscode.postMessage({
            type: "removeNavigateFlow",
            sourcePageIndex: f.sourcePageIndex,
            componentId: f.componentId,
            trigger: f.trigger,
            targetPageId: f.targetPageId
        });
    }
}

function renderFlowPageTransitions(pageIndex) {
    if (!flowPageTransitionsEl || !currentProject) {
        return;
    }
    flowPageTransitionsEl.innerHTML = "";
    const flows = getFlowsFromPage(pageIndex);
    if (!flows.length) {
        const li = document.createElement("li");
        li.className = "flow-page-transitions-empty";
        li.textContent = "No transitions yet. Use + Add connection on the canvas or Add transition below.";
        flowPageTransitionsEl.appendChild(li);
        return;
    }
    for (const f of flows) {
        const li = document.createElement("li");
        li.className = "flow-transition-row";
        const main = document.createElement("button");
        main.type = "button";
        main.className = "flow-transition-row-main";
        const tgt = document.createElement("span");
        tgt.className = "flow-transition-row-target";
        tgt.textContent = `→ ${f.targetPageName}`;
        const meta = document.createElement("span");
        meta.className = "flow-transition-row-meta";
        meta.textContent =
            f.kind === "swipe"
                ? `Screen swipe ${f.direction}`
                : `${f.componentId} · ${f.trigger}`;
        main.appendChild(tgt);
        main.appendChild(meta);
        main.addEventListener("click", () => {
            showFlowTransitionEditor("edit", pageIndex, f);
        });
        const del = document.createElement("button");
        del.type = "button";
        del.className = "flow-transition-row-del";
        del.textContent = "×";
        del.title = "Remove transition";
        del.addEventListener("click", e => {
            e.stopPropagation();
            removeFlowFromProject(f);
        });
        li.appendChild(main);
        li.appendChild(del);
        flowPageTransitionsEl.appendChild(li);
    }
}

function submitFlowTransition() {
    if (!currentProject || !flowFromPage || !flowToPage) {
        return false;
    }
    const sourcePageIndex = parseInt(flowFromPage.value, 10) || 0;
    const targetPageId = flowToPage.value;
    const anim = flowAnim?.value ?? "none";
    const time = flowTime ? parseInt(flowTime.value, 10) : 300;
    if (!targetPageId) {
        return false;
    }
    if (_fgEditingFlow) {
        removeFlowFromProject(_fgEditingFlow);
        _fgEditingFlow = null;
    }
    const kind = flowKind?.value ?? "component";
    if (kind === "swipe") {
        const direction = flowSwipeDirection?.value;
        if (!direction) {
            return false;
        }
        vscode.postMessage({
            type: "addPageSwipeFlow",
            sourcePageIndex,
            direction,
            targetPageId,
            anim,
            time: Number.isFinite(time) ? time : 300
        });
    } else {
        if (!flowComponent || !flowTrigger) {
            return false;
        }
        const componentId = flowComponent.value;
        const trigger = flowTrigger.value;
        if (!componentId) {
            return false;
        }
        vscode.postMessage({
            type: "addNavigateFlow",
            sourcePageIndex,
            componentId,
            trigger,
            targetPageId,
            anim,
            time: Number.isFinite(time) ? time : 300
        });
    }
    if (_fgSelectedPageIndex !== sourcePageIndex) {
        selectFlowGraphPage(sourcePageIndex);
    } else {
        renderFlowPageTransitions(sourcePageIndex);
        renderFlowGraph();
    }
    showFlowTransitionEditor("new", sourcePageIndex, null);
    return true;
}

function hitTestFlowNode(mx, my) {
    for (const node of _fgNodes) {
        if (mx >= node.x && mx <= node.x + node.w && my >= node.y && my <= node.y + node.h) {
            return node;
        }
    }
    return null;
}

function flowGraphCols(W) {
    return Math.max(1, Math.floor((W - FG_PAD * 2 + FG_GAP_X) / (FG_NODE_W + FG_GAP_X)));
}

function flowGridPos(pageIndex, cols) {
    return {
        x: FG_PAD + (pageIndex % cols) * (FG_NODE_W + FG_GAP_X),
        y: FG_PAD_TOP + Math.floor(pageIndex / cols) * (FG_NODE_H + FG_GAP_Y)
    };
}

function flowNodePosition(page, pageIndex, cols) {
    if (_fgDragPos && _fgDragPos.pageIndex === pageIndex) {
        return { x: _fgDragPos.x, y: _fgDragPos.y };
    }
    if (typeof page.flowX === "number" && typeof page.flowY === "number") {
        return { x: page.flowX, y: page.flowY };
    }
    return flowGridPos(pageIndex, cols);
}

function clampFlowNodePos(x, y, W, H) {
    const minX = FG_PAD;
    const minY = FG_PAD_TOP;
    const maxX = Math.max(minX, W - FG_PAD - FG_NODE_W);
    const maxY = Math.max(minY, H - FG_PAD - FG_NODE_H);
    return {
        x: Math.min(maxX, Math.max(minX, x)),
        y: Math.min(maxY, Math.max(minY, y))
    };
}

function flowCanvasPoint(e) {
    const rect = flowGraphCanvas.getBoundingClientRect();
    return { mx: e.clientX - rect.left, my: e.clientY - rect.top };
}

function finishFlowNodeDrag() {
    if (!_fgDrag) {
        return;
    }
    const drag = _fgDrag;
    _fgDrag = null;
    document.removeEventListener("mousemove", onFlowNodeDragMove);
    document.removeEventListener("mouseup", finishFlowNodeDrag);
    if (flowGraphCanvas) {
        flowGraphCanvas.style.cursor = "default";
    }

    if (!drag.moved || !currentProject || !flowGraphWrap) {
        _fgDragPos = null;
        renderFlowGraph();
        return;
    }

    const page = currentProject.pages[drag.pageIndex];
    if (!page || !_fgDragPos) {
        _fgDragPos = null;
        renderFlowGraph();
        return;
    }

    page.flowX = _fgDragPos.x;
    page.flowY = _fgDragPos.y;
    _fgSuppressClick = true;
    _fgDragPos = null;
    renderFlowGraph();
    vscode.postMessage({
        type: "updatePage",
        pageIndex: drag.pageIndex,
        patch: { flowX: page.flowX, flowY: page.flowY }
    });
}

function onFlowNodeDragMove(e) {
    if (!_fgDrag || !flowGraphWrap) {
        return;
    }
    const W = flowGraphWrap.clientWidth;
    const H = flowGraphWrap.clientHeight;
    const { mx, my } = flowCanvasPoint(e);
    const dx = mx - _fgDrag.pointerX;
    const dy = my - _fgDrag.pointerY;
    if (!_fgDrag.moved && Math.hypot(dx, dy) >= FG_DRAG_THRESHOLD) {
        _fgDrag.moved = true;
    }
    const pos = clampFlowNodePos(_fgDrag.nodeX + dx, _fgDrag.nodeY + dy, W, H);
    _fgDragPos = { pageIndex: _fgDrag.pageIndex, x: pos.x, y: pos.y };
    if (flowGraphCanvas) {
        flowGraphCanvas.style.cursor = "grabbing";
    }
    renderFlowGraph();
}

function toggleFlowLinkMode() {
    const on = !flowGraphWrap?.classList.contains("linking");
    setFlowLinkMode(on);
    if (on) {
        clearFlowGraphSelection();
    }
    renderFlowGraph();
}

function renderFlowPanel() {
    if (isWorkspaceFlowActive()) {
        renderFlowGraph();
        if (_fgSelectedPageIndex >= 0) {
            renderFlowPageTransitions(_fgSelectedPageIndex);
        }
    }
}

function _fgBezierPt(p0, p1, p2, p3, t) {
    const mt = 1 - t;
    return mt * mt * mt * p0 + 3 * mt * mt * t * p1 + 3 * mt * t * t * p2 + t * t * t * p3;
}

function _fgArrowHead(ctx, cpx, cpy, tx, ty, color, size) {
    const angle = Math.atan2(ty - cpy, tx - cpx);
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.lineTo(tx - size * Math.cos(angle - Math.PI / 6), ty - size * Math.sin(angle - Math.PI / 6));
    ctx.lineTo(tx - size * Math.cos(angle + Math.PI / 6), ty - size * Math.sin(angle + Math.PI / 6));
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
}

function _fgTruncateText(ctx, text, maxW) {
    if (ctx.measureText(text).width <= maxW) return text;
    let t = text;
    while (t.length > 1 && ctx.measureText(t + "…").width > maxW) t = t.slice(0, -1);
    return t + "…";
}

function _fgTargetPageIndex(flow) {
    return currentProject?.pages.findIndex(p => p.id === flow.targetPageId) ?? -1;
}

function _fgFlowEdgeLabelsText(entries) {
    if (!entries.length) {
        return "";
    }
    if (entries.length === 1) {
        return _fgFlowEdgeLabel(entries[0].flow);
    }
    return entries.map(e => _fgFlowEdgeLabel(e.flow)).join(" · ");
}

function _fgEdgeDashStyle(entries) {
    return entries.length > 0 && entries.every(e => e.flow.kind === "swipe") ? [5, 4] : [];
}

/** @returns {{ sx: number, sy: number, tx: number, ty: number, cp1x: number, cp1y: number, cp2x: number, cp2y: number, startPageIndex: number, endPageIndex: number }} */
function _fgPairGeometry(nodeFrom, nodeTo, curveOffset = 0) {
    const sameRow = Math.abs(nodeTo.y - nodeFrom.y) < FG_NODE_H * 0.5;
    let sx, sy, tx, ty, cp1x, cp1y, cp2x, cp2y;

    if (sameRow) {
        const goRight = nodeTo.x + nodeTo.w / 2 >= nodeFrom.x + nodeFrom.w / 2;
        sx = goRight ? nodeFrom.x + nodeFrom.w : nodeFrom.x;
        sy = nodeFrom.y + nodeFrom.h / 2;
        tx = goRight ? nodeTo.x : nodeTo.x + nodeTo.w;
        ty = nodeTo.y + nodeTo.h / 2;
        const curveDrop = FG_GAP_Y * 0.55 + (curveOffset % 3) * 14;
        cp1x = sx + (goRight ? 20 : -20);
        cp1y = sy + curveDrop;
        cp2x = tx + (goRight ? -20 : 20);
        cp2y = ty + curveDrop;
    } else {
        const goDown = nodeTo.y + nodeTo.h / 2 >= nodeFrom.y + nodeFrom.h / 2;
        sx = nodeFrom.x + nodeFrom.w / 2;
        sy = goDown ? nodeFrom.y + nodeFrom.h : nodeFrom.y;
        tx = nodeTo.x + nodeTo.w / 2;
        ty = goDown ? nodeTo.y : nodeTo.y + nodeTo.h;
        const dy = ty - sy;
        cp1x = sx;
        cp1y = sy + dy * 0.45;
        cp2x = tx;
        cp2y = ty - dy * 0.45;
    }

    return {
        sx,
        sy,
        tx,
        ty,
        cp1x,
        cp1y,
        cp2x,
        cp2y,
        startPageIndex: nodeFrom.index,
        endPageIndex: nodeTo.index
    };
}

function _fgBuildVisualFlowEdges(flows) {
    /** @type {Map<string, { low: number, high: number, lowToHigh: Array<{ flow: object, flowIndex: number }>, highToLow: Array<{ flow: object, flowIndex: number }> }>} */
    const pairs = new Map();

    flows.forEach((f, fi) => {
        const tgtIdx = _fgTargetPageIndex(f);
        if (tgtIdx < 0 || tgtIdx === f.sourcePageIndex) {
            return;
        }
        const low = Math.min(f.sourcePageIndex, tgtIdx);
        const high = Math.max(f.sourcePageIndex, tgtIdx);
        const key = `${low}-${high}`;
        if (!pairs.has(key)) {
            pairs.set(key, { low, high, lowToHigh: [], highToLow: [] });
        }
        const bucket = pairs.get(key);
        const entry = { flow: f, flowIndex: fi };
        if (f.sourcePageIndex === low) {
            bucket.lowToHigh.push(entry);
        } else {
            bucket.highToLow.push(entry);
        }
    });

    /** @type {Array<{ bidirectional: boolean, low: number, high: number, lowToHigh: Array<{ flow: object, flowIndex: number }>, highToLow: Array<{ flow: object, flowIndex: number }> }>} */
    const visual = [];
    for (const bucket of pairs.values()) {
        const bidirectional = bucket.lowToHigh.length > 0 && bucket.highToLow.length > 0;
        if (bidirectional) {
            visual.push({
                bidirectional: true,
                low: bucket.low,
                high: bucket.high,
                lowToHigh: bucket.lowToHigh,
                highToLow: bucket.highToLow
            });
        } else {
            const entries = bucket.lowToHigh.length ? bucket.lowToHigh : bucket.highToLow;
            for (let i = 0; i < entries.length; i++) {
                visual.push({
                    bidirectional: false,
                    low: bucket.low,
                    high: bucket.high,
                    entries: [entries[i]],
                    curveOffset: i
                });
            }
        }
    }
    return visual;
}

function _fgDrawFlowEdge(ctx, geom, edgeColor, lineWidth, dashStyle, arrowEnds) {
    ctx.beginPath();
    ctx.moveTo(geom.sx, geom.sy);
    ctx.bezierCurveTo(geom.cp1x, geom.cp1y, geom.cp2x, geom.cp2y, geom.tx, geom.ty);
    ctx.strokeStyle = edgeColor;
    ctx.lineWidth = lineWidth;
    ctx.setLineDash(dashStyle);
    ctx.stroke();
    ctx.setLineDash([]);

    const headSize = lineWidth >= 2.5 ? 8 : 6;
    if (arrowEnds.to) {
        _fgArrowHead(ctx, geom.cp2x, geom.cp2y, geom.tx, geom.ty, edgeColor, headSize);
    }
    if (arrowEnds.from) {
        _fgArrowHead(ctx, geom.cp1x, geom.cp1y, geom.sx, geom.sy, edgeColor, headSize);
    }
}

function _fgHitTestFlowEdges(mx, my) {
    let bestEdge = -1;
    let bestLabel = -1;
    let bestDist = 16;

    for (let ei = 0; ei < _fgEdges.length; ei++) {
        const ed = _fgEdges[ei];
        for (let li = 0; li < ed.labels.length; li++) {
            const lb = ed.labels[li];
            const d = Math.hypot(mx - lb.mx, my - lb.my);
            if (d < bestDist) {
                bestDist = d;
                bestEdge = ei;
                bestLabel = li;
            }
        }
        if (bestEdge === ei) {
            continue;
        }
        const mid = ed.labels[Math.floor(ed.labels.length / 2)] ?? ed.labels[0];
        if (mid) {
            const d = Math.hypot(mx - mid.mx, my - mid.my);
            if (d < bestDist) {
                bestDist = d;
                bestEdge = ei;
                bestLabel = -1;
            }
        }
    }
    return { edge: bestEdge, label: bestLabel };
}

function renderFlowGraph() {
    if (!flowGraphCanvas || !flowGraphWrap || !currentProject) return;

    const W = flowGraphWrap.clientWidth;
    const H = flowGraphWrap.clientHeight;
    if (W < 2 || H < 2) return;

    const dpr = window.devicePixelRatio || 1;
    if (flowGraphCanvas.width !== W * dpr || flowGraphCanvas.height !== H * dpr) {
        flowGraphCanvas.width = W * dpr;
        flowGraphCanvas.height = H * dpr;
    }
    flowGraphCanvas.style.width = W + "px";
    flowGraphCanvas.style.height = H + "px";

    const ctx = flowGraphCanvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    const pages = currentProject.pages;
    if (!pages.length) {
        ctx.fillStyle = "#888";
        ctx.font = "12px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("No pages in project.", W / 2, H / 2);
        return;
    }

    const cols = flowGraphCols(W);
    _fgNodes = pages.map((page, i) => {
        const pos = flowNodePosition(page, i, cols);
        const clamped = clampFlowNodePos(pos.x, pos.y, W, H);
        return {
            page,
            index: i,
            x: clamped.x,
            y: clamped.y,
            w: FG_NODE_W,
            h: FG_NODE_H
        };
    });

    const flows = collectAllFlowsFromProject();
    const visualEdges = _fgBuildVisualFlowEdges(flows);
    _fgEdges = [];

    for (let ei = 0; ei < visualEdges.length; ei++) {
        const ve = visualEdges[ei];
        const nodeLow = _fgNodes[ve.low];
        const nodeHigh = _fgNodes[ve.high];
        if (!nodeLow || !nodeHigh) {
            continue;
        }

        const geom = _fgPairGeometry(nodeLow, nodeHigh, 0);
        const isHover = _fgHoverEdge === ei;
        const edgeColor = isHover ? "#4ea2e0" : "#3a7ab8";
        const lineWidth = isHover ? 2.5 : 1.5;

        /** @type {Array<{ flow: object, flowIndex: number, mx: number, my: number, text: string }>} */
        const labels = [];

        if (ve.bidirectional) {
            const dashStyle = _fgEdgeDashStyle([...ve.lowToHigh, ...ve.highToLow]);
            _fgDrawFlowEdge(ctx, geom, edgeColor, lineWidth, dashStyle, { from: true, to: true });

            const tLow = 0.35;
            const tHigh = 0.65;
            labels.push({
                flow: ve.highToLow[0].flow,
                flowIndex: ve.highToLow[0].flowIndex,
                mx: _fgBezierPt(geom.sx, geom.cp1x, geom.cp2x, geom.tx, tLow),
                my: _fgBezierPt(geom.sy, geom.cp1y, geom.cp2y, geom.ty, tLow),
                text: _fgFlowEdgeLabelsText(ve.highToLow)
            });
            labels.push({
                flow: ve.lowToHigh[0].flow,
                flowIndex: ve.lowToHigh[0].flowIndex,
                mx: _fgBezierPt(geom.sx, geom.cp1x, geom.cp2x, geom.tx, tHigh),
                my: _fgBezierPt(geom.sy, geom.cp1y, geom.cp2y, geom.ty, tHigh),
                text: _fgFlowEdgeLabelsText(ve.lowToHigh)
            });

            _fgEdges.push({
                bidirectional: true,
                flows: [...ve.lowToHigh, ...ve.highToLow].map(e => e.flow),
                labels,
                ...geom,
                dashStyle
            });
        } else {
            const entry = ve.entries[0];
            const dashStyle = _fgEdgeDashStyle([entry]);
            const src = _fgNodes[entry.flow.sourcePageIndex];
            const tgtIdx = _fgTargetPageIndex(entry.flow);
            const tgt = _fgNodes[tgtIdx];
            if (!src || !tgt) {
                continue;
            }
            const uniGeom = _fgPairGeometry(src, tgt, ve.curveOffset ?? 0);
            _fgDrawFlowEdge(ctx, uniGeom, edgeColor, lineWidth, dashStyle, { from: false, to: true });

            labels.push({
                flow: entry.flow,
                flowIndex: entry.flowIndex,
                mx: _fgBezierPt(uniGeom.sx, uniGeom.cp1x, uniGeom.cp2x, uniGeom.tx, 0.5),
                my: _fgBezierPt(uniGeom.sy, uniGeom.cp1y, uniGeom.cp2y, uniGeom.ty, 0.5),
                text: _fgFlowEdgeLabel(entry.flow)
            });

            _fgEdges.push({
                bidirectional: false,
                flows: [entry.flow],
                labels,
                ...uniGeom,
                dashStyle
            });
        }

        const edge = _fgEdges[_fgEdges.length - 1];
        ctx.font = "10px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        for (let li = 0; li < edge.labels.length; li++) {
            const lb = edge.labels[li];
            const labelHover = isHover && (_fgHoverEdgeLabel === li || (_fgHoverEdgeLabel < 0 && edge.labels.length === 1));
            ctx.fillStyle = labelHover ? "#cce4f7" : "#8ab4d9";
            const yOff = edge.bidirectional ? (li === 0 ? -10 : 10) : -10;
            ctx.fillText(_fgTruncateText(ctx, lb.text, 72), lb.mx, lb.my + yOff);

            if (labelHover || (isHover && edge.labels.length === 1)) {
                ctx.beginPath();
                ctx.arc(lb.mx, lb.my, FG_DEL_R, 0, Math.PI * 2);
                ctx.fillStyle = "#cc3333";
                ctx.fill();
                ctx.fillStyle = "#fff";
                ctx.font = "bold 11px sans-serif";
                ctx.fillText("×", lb.mx, lb.my + 0.5);
                ctx.font = "10px sans-serif";
            }
        }
    }

    for (const node of _fgNodes) {
        const isSelected = node.index === _fgSelectedPageIndex;
        const isLinkSource = _fgLinkPick && node.index === _fgLinkPick.sourceIndex;
        const r = 6;

        ctx.beginPath();
        if (ctx.roundRect) {
            ctx.roundRect(node.x, node.y, node.w, node.h, r);
        } else {
            // fallback for older browsers
            const { x, y, w, h } = node;
            ctx.moveTo(x + r, y);
            ctx.lineTo(x + w - r, y); ctx.arcTo(x + w, y, x + w, y + r, r);
            ctx.lineTo(x + w, y + h - r); ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
            ctx.lineTo(x + r, y + h); ctx.arcTo(x, y + h, x, y + h - r, r);
            ctx.lineTo(x, y + r); ctx.arcTo(x, y, x + r, y, r);
            ctx.closePath();
        }
        ctx.fillStyle = isSelected || isLinkSource ? "#094771" : "#2a2d2e";
        ctx.fill();
        ctx.strokeStyle = isSelected || isLinkSource ? "#007acc" : "#555";
        ctx.lineWidth = isSelected || isLinkSource ? 2 : 1;
        ctx.stroke();

        const cx = node.x + node.w / 2;
        ctx.textAlign = "center";
        ctx.textBaseline = "alphabetic";
        ctx.font = "bold 13px sans-serif";
        ctx.fillStyle = isSelected || isLinkSource ? "#fff" : "#ddd";
        ctx.fillText(_fgTruncateText(ctx, node.page.name, node.w - 14), cx, node.y + node.h / 2 - 2);

        ctx.font = "10px sans-serif";
        ctx.fillStyle = isSelected || isLinkSource ? "#b3d4f5" : "#888";
        ctx.fillText(_fgTruncateText(ctx, node.page.id, node.w - 12), cx, node.y + node.h / 2 + 14);
    }

    if (!flows.length && pages.length) {
        ctx.fillStyle = "#666";
        ctx.font = "12px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("+ Add connection — or drag pages to arrange · click a page to edit transitions", W / 2, H - 28);
    }
}

// ── Flow graph mouse interaction ───────────────────────────────────────────────

if (flowGraphCanvas) {
    flowGraphCanvas.addEventListener("mousedown", e => {
        if (!isWorkspaceFlowActive() || !currentProject || e.button !== 0) {
            return;
        }
        if (flowGraphWrap?.classList.contains("linking")) {
            return;
        }
        const { mx, my } = flowCanvasPoint(e);
        const node = hitTestFlowNode(mx, my);
        if (!node) {
            return;
        }
        e.preventDefault();
        _fgDrag = {
            pageIndex: node.index,
            pointerX: mx,
            pointerY: my,
            nodeX: node.x,
            nodeY: node.y,
            moved: false
        };
        _fgDragPos = null;
        document.addEventListener("mousemove", onFlowNodeDragMove);
        document.addEventListener("mouseup", finishFlowNodeDrag);
    });

    flowGraphCanvas.addEventListener("mousemove", e => {
        if (!isWorkspaceFlowActive()) return;
        if (_fgDrag) {
            return;
        }
        const rect = flowGraphCanvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;

        let newHover = -1;
        let newHoverLabel = -1;
        const hit = _fgHitTestFlowEdges(mx, my);
        if (hit.edge >= 0) {
            newHover = hit.edge;
            newHoverLabel = hit.label;
        }
        const node = hitTestFlowNode(mx, my);
        let cursor = "default";
        if (newHover >= 0) {
            cursor = "pointer";
        } else if (node) {
            cursor = flowGraphWrap?.classList.contains("linking") ? "crosshair" : "grab";
        }
        if (newHover !== _fgHoverEdge || newHoverLabel !== _fgHoverEdgeLabel) {
            _fgHoverEdge = newHover;
            _fgHoverEdgeLabel = newHoverLabel;
            flowGraphCanvas.style.cursor = cursor;
            renderFlowGraph();
        } else if (flowGraphCanvas.style.cursor !== cursor) {
            flowGraphCanvas.style.cursor = cursor;
        }
    });

    flowGraphCanvas.addEventListener("mouseleave", () => {
        if (_fgHoverEdge !== -1) {
            _fgHoverEdge = -1;
            _fgHoverEdgeLabel = -1;
            flowGraphCanvas.style.cursor = "default";
            renderFlowGraph();
        }
    });

    flowGraphCanvas.addEventListener("click", e => {
        if (!isWorkspaceFlowActive() || !currentProject) {
            return;
        }
        if (_fgSuppressClick) {
            _fgSuppressClick = false;
            return;
        }
        const rect = flowGraphCanvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;

        if (_fgHoverEdge >= 0 && _fgHoverEdge < _fgEdges.length) {
            const ed = _fgEdges[_fgHoverEdge];
            const labelIdx = _fgHoverEdgeLabel >= 0 ? _fgHoverEdgeLabel : 0;
            const lb = ed.labels[labelIdx];
            if (lb) {
                const dx = mx - lb.mx;
                const dy = my - lb.my;
                if (Math.sqrt(dx * dx + dy * dy) < FG_DEL_R + 4) {
                    removeFlowFromProject(lb.flow);
                    _fgHoverEdge = -1;
                    _fgHoverEdgeLabel = -1;
                    return;
                }
                selectFlowGraphPage(lb.flow.sourcePageIndex);
                showFlowTransitionEditor("edit", lb.flow.sourcePageIndex, lb.flow);
                return;
            }
        }

        const node = hitTestFlowNode(mx, my);
        if (node) {
            if (flowGraphWrap?.classList.contains("linking")) {
                if (!_fgLinkPick) {
                    _fgLinkPick = { sourceIndex: node.index };
                    renderFlowGraph();
                    return;
                }
                if (_fgLinkPick.sourceIndex !== node.index) {
                    const src = _fgLinkPick.sourceIndex;
                    setFlowLinkMode(false);
                    selectFlowGraphPage(src);
                    showFlowTransitionEditor("new", src, null);
                    if (flowToPage) {
                        const tgtPage = currentProject.pages[node.index];
                        if (tgtPage) {
                            flowToPage.value = tgtPage.id;
                        }
                    }
                }
                return;
            }
            selectFlowGraphPage(node.index);
            return;
        }

        clearFlowGraphSelection();
        setFlowLinkMode(false);
    });

    flowGraphCanvas.addEventListener("dblclick", e => {
        if (!isWorkspaceFlowActive() || !currentProject) {
            return;
        }
        const rect = flowGraphCanvas.getBoundingClientRect();
        const node = hitTestFlowNode(e.clientX - rect.left, e.clientY - rect.top);
        if (node) {
            openPageTabByIndex(node.index, true);
        }
    });
}

// Redraw graph on panel resize (rAF avoids ResizeObserver loop warnings)
let flowGraphResizeRaf = 0;
if (flowGraphWrap && typeof ResizeObserver !== "undefined") {
    new ResizeObserver(() => {
        if (flowGraphResizeRaf) {
            return;
        }
        flowGraphResizeRaf = requestAnimationFrame(() => {
            flowGraphResizeRaf = 0;
            if (isWorkspaceFlowActive()) {
                renderFlowGraph();
            }
        });
    }).observe(flowGraphWrap);
}

if (flowFromPage) {
    flowFromPage.addEventListener("change", () => populateFlowComponentSelect());
}

function syncFlowTimeField() {
    if (!flowTime || !flowAnim) {
        return;
    }
    const instant = flowAnim.value === "none" || flowAnim.value === "";
    flowTime.disabled = instant;
    if (instant) {
        flowTime.title = "Not used when animation is None";
    } else {
        flowTime.title = "Animation duration in milliseconds";
    }
}

if (flowKind) {
    flowKind.addEventListener("change", syncFlowKindFields);
    syncFlowKindFields();
}

if (flowAnim) {
    flowAnim.addEventListener("change", syncFlowTimeField);
    syncFlowTimeField();
}

if (btnFlowAdd) {
    btnFlowAdd.addEventListener("click", () => submitFlowTransition());
}
if (btnFlowCancelEdit) {
    btnFlowCancelEdit.addEventListener("click", () => hideFlowTransitionEditor());
}
if (btnFlowAddLink) {
    btnFlowAddLink.addEventListener("click", () => toggleFlowLinkMode());
}
if (btnFlowInspectorClose) {
    btnFlowInspectorClose.addEventListener("click", () => clearFlowGraphSelection());
}
if (btnFlowNewTransition) {
    btnFlowNewTransition.addEventListener("click", () => {
        if (_fgSelectedPageIndex < 0) {
            return;
        }
        showFlowTransitionEditor("new", _fgSelectedPageIndex, null);
    });
}
if (btnFlowOpenPagePreview) {
    btnFlowOpenPagePreview.addEventListener("click", () => {
        if (_fgSelectedPageIndex >= 0) {
            openPageTabByIndex(_fgSelectedPageIndex, true);
        }
    });
}

/** Absolute boxes for all selected widgets (skips stale ids). */
function getMultiSelectionBoxes(page, ids) {
    return ids.map(id => {
        const b = getAbsBounds(page, id);
        if (!b) {
            return null;
        }
        return { id, x: b.x, y: b.y, width: b.width, height: b.height };
    }).filter(Boolean);
}

function postBulkMoveAbsolute(moves) {
    if (!moves?.length) {
        return;
    }
    vscode.postMessage({
        type: "bulkMoveWidgets",
        pageIndex: currentPageIndex,
        moves: moves.map(m => ({
            componentId: m.componentId,
            absX: Math.max(0, Math.round(Number(m.absX))),
            absY: Math.max(0, Math.round(Number(m.absY)))
        }))
    });
}

function layoutToolbarButton(act, label) {
    return `<button type="button" class="layout-act-btn tb-btn-small" data-layout-act="${esc(act)}">${esc(label)}</button>`;
}

function zOrderInspectorHtml() {
    return (
        `<div class="inspector-group-title">Draw order</div>` +
        `<div class="inspector-layout-grid">` +
        layoutToolbarButton("z-back", "To back") +
        layoutToolbarButton("z-backward", "Backward") +
        layoutToolbarButton("z-forward", "Forward") +
        layoutToolbarButton("z-front", "To front") +
        `</div>`
    );
}

function syncPreviewBezel() {
    if (!canvasContainer || !displayWrapper) {
        return;
    }
    const on = !!(previewBezelCheck && previewBezelCheck.checked);
    canvasContainer.classList.toggle("show-bezel", on);
    if (displayRound) {
        displayWrapper.classList.toggle("round-bezel", on);
    }
}

const INSERT_WIDGET_TYPES = [
    "label",
    "button",
    "slider",
    "switch",
    "bar",
    "arc",
    "knob",
    "checkbox",
    "dropdown",
    "roller",
    "textarea",
    "line",
    "image",
    "container",
    "panel",
    "spinner"
];

function ensureInsertWidgetPickerPopulated() {
    if (!insertWidgetPicker || insertWidgetPicker.dataset.populated) {
        return;
    }
    insertWidgetPicker.dataset.populated = "1";
    insertWidgetPicker.innerHTML = "";
    for (const t of INSERT_WIDGET_TYPES) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "picker-item";
        btn.textContent = t;
        btn.dataset.widget = t;
        btn.addEventListener("click", () => {
            const ox = Number(insertWidgetPicker.dataset.ox);
            const oy = Number(insertWidgetPicker.dataset.oy);
            hideInsertWidgetPicker();
            vscode.postMessage({
                type: "addWidget",
                pageIndex: currentPageIndex,
                widgetType: t,
                x: Number.isFinite(ox) ? ox : undefined,
                y: Number.isFinite(oy) ? oy : undefined
            });
        });
        insertWidgetPicker.appendChild(btn);
    }
}

/** @param {number} px @param {number} py */
function showInsertWidgetPicker(px, py) {
    if (!insertWidgetPicker || !canvasContainer) {
        return;
    }
    ensureInsertWidgetPickerPopulated();
    insertWidgetPicker.dataset.ox = String(px);
    insertWidgetPicker.dataset.oy = String(py);
    const cr = canvasContainer.getBoundingClientRect();
    const z = previewZoom;
    insertWidgetPicker.style.left = `${Math.max(0, px * z)}px`;
    insertWidgetPicker.style.top = `${Math.max(0, py * z)}px`;
    insertWidgetPicker.classList.add("open");
    insertWidgetPicker.hidden = false;
}

function hideInsertWidgetPicker() {
    if (!insertWidgetPicker) {
        return;
    }
    insertWidgetPicker.classList.remove("open");
    insertWidgetPicker.hidden = true;
}

function filterPaletteSearch() {
    if (!paletteSearch) {
        return;
    }
    const q = paletteSearch.value.trim().toLowerCase();
    const root = document.getElementById("palette-standard");
    if (!root) {
        return;
    }
    for (const btn of root.querySelectorAll("[data-widget]")) {
        if (!(btn instanceof HTMLElement)) {
            continue;
        }
        const w = btn.getAttribute("data-widget") ?? "";
        const hide = q.length > 0 && !w.includes(q);
        btn.classList.toggle("palette-hidden", hide);
    }
}

function postAddWidgetAt(widgetType, x, y) {
    vscode.postMessage({
        type: "addWidget",
        pageIndex: currentPageIndex,
        widgetType,
        x: Math.max(0, Math.round(x)),
        y: Math.max(0, Math.round(y))
    });
}

function multiInspectorLayoutActsHtml() {
    return (
        `<div class="inspector-group-title">Align together</div>` +
        `<div class="inspector-layout-grid">` +
        layoutToolbarButton("align-left", "Left") +
        layoutToolbarButton("align-right", "Right") +
        layoutToolbarButton("align-top", "Top") +
        layoutToolbarButton("align-bottom", "Bottom") +
        layoutToolbarButton("align-center-h", "Center H") +
        layoutToolbarButton("align-center-v", "Center V") +
        layoutToolbarButton("distribute-h", "Spread X") +
        layoutToolbarButton("distribute-v", "Spread Y") +
        `</div>` +
        `<div class="inspector-group-title">Match size</div>` +
        `<div class="inspector-layout-grid">` +
        layoutToolbarButton("match-width", "= max width") +
        layoutToolbarButton("match-height", "= max height") +
        `</div>` +
        `<div class="inspector-group-title">On page canvas</div>` +
        `<div class="inspector-layout-grid">` +
        layoutToolbarButton("grp-left", "To left") +
        layoutToolbarButton("grp-top", "To top") +
        layoutToolbarButton("grp-center", "Center in page") +
        `</div>` +
        `<div class="inspector-group-title">Group</div>` +
        `<div class="inspector-layout-grid">` +
        layoutToolbarButton("combine-widgets", "Combine into group") +
        `</div>`
    );
}

const LIBRARY_PALETTE_ICON =
    `<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="4" y="5" width="12" height="10" rx="1" fill="none" stroke="currentColor" stroke-width="1.2" stroke-dasharray="2 2"/><rect x="7" y="8" width="6" height="4" rx="0.5" fill="currentColor" opacity="0.35"/></svg>`;

function refreshLibraryPalette() {
    const list = document.getElementById("library-palette-list");
    if (!list) {
        return;
    }
    const lib = currentProject?.componentLibrary;
    if (!Array.isArray(lib) || lib.length === 0) {
        list.innerHTML =
            `<div class="library-palette-empty">Combine widgets, then use <strong>Save to library</strong> in the inspector.</div>`;
        return;
    }
    list.innerHTML = lib
        .map(e => {
            const name = esc(String(e.name ?? e.id));
            const id = esc(String(e.id));
            const w = Number(e.width) || 0;
            const h = Number(e.height) || 0;
            const size = `${w}×${h}`;
            return (
                `<button type="button" class="palette-item palette-item-library" data-library="${id}" ` +
                `title="${name} (${esc(size)})" aria-label="Insert ${name}">` +
                LIBRARY_PALETTE_ICON +
                `<span class="palette-library-label">${name}</span>` +
                `</button>`
            );
        })
        .join("");
}

function renderMultiInspectorHtml(ids) {
    const list = ids.map(esc).join(", ");
    return (
        `<div id="inspector-readonly"><strong>${ids.length}</strong> widgets selected</div>` +
        `<div class="inspector-group-title">Multi-select</div>` +
        `<p class="inspector-hint" style="font-size:11px;color:#888;line-height:1.35;margin:0 0 8px;">` +
        `Ctrl+click: toggle · Shift+click: add · Drag empty: marquee (Shift: add · Ctrl: toggle hits) · Double-click: deepest widget under cursor · Combine: siblings only.` +
        `</p>` +
        `<div class="inspector-hint" style="font-size:11px;color:#aaa;margin:-4px 0 12px;line-height:1.3">${esc(list)}</div>` +
        multiInspectorLayoutActsHtml()
    );
}

function renderHomogeneousMultiInspectorHtml(ids, comps) {
    const list = ids.map(esc).join(", ");
    const t = /** @type {string} */ (comps[0].type);
    const layoutM = {
        x: consensusNum(comps, "x", 0),
        y: consensusNum(comps, "y", 0),
        width: consensusNum(comps, "width", 0),
        height: consensusNum(comps, "height", 0),
        hidden: consensusBool(comps, "hidden")
    };
    const typeM = buildConsensusWidgetModel(comps);
    const stM = consensusStylesModel(comps);
    const evM = consensusEventsModel(comps);
    return (
        `<div id="inspector-readonly"><strong>${ids.length}</strong> × <strong>${esc(t)}</strong></div>` +
        `<div class="inspector-group-title">Multi-select (same type)</div>` +
        `<p class="inspector-hint" style="font-size:11px;color:#888;line-height:1.35;margin:0 0 8px;">` +
        `Edits apply to every selected widget. Fields marked (mixed) differ — leave blank to keep each widget’s value, or set a new shared value. Double-click on the canvas selects the deepest widget under the cursor. Combine requires siblings (same parent).` +
        `</p>` +
        `<div class="inspector-hint" style="font-size:11px;color:#aaa;margin:-4px 0 12px;line-height:1.3">${esc(list)}</div>` +
        multiInspectorLayoutActsHtml() +
        inspectorLayoutFieldsHtml(layoutM) +
        `<div class="inspector-group-title">${esc(t)}</div>` +
        widgetTypeSpecificFieldsHtml(t, typeM) +
        inspectorAppearancesFromModels(stM, evM)
    );
}

function applyLayoutAct(act) {
    const page = currentProject?.pages[currentPageIndex];
    const ids = [...selectedComponentOrder];
    if (!page || ids.length === 0 || !act) {
        return;
    }
    if (act === "combine-widgets") {
        if (ids.length < 2) {
            log("warn", "Select at least two widgets to combine.");
            return;
        }
        vscode.postMessage({
            type: "combineWidgets",
            pageIndex: currentPageIndex,
            componentIds: [...ids]
        });
        return;
    }
    if (act === "ungroup-widget") {
        if (ids.length !== 1) {
            log("warn", "Select a single container or panel to ungroup.");
            return;
        }
        groupEditContainerId = null;
        vscode.postMessage({
            type: "ungroupWidget",
            pageIndex: currentPageIndex,
            componentId: ids[0]
        });
        return;
    }
    if (act === "edit-group-contents") {
        if (ids.length !== 1) {
            log("warn", "Select a single widget in a group to edit its contents.");
            return;
        }
        const comp = findComponentById(page.components, ids[0]);
        const gid = isGroupComponent(comp)
            ? comp.id
            : findEnclosingGroupId(page.components, ids[0]);
        if (!gid) {
            log("warn", "Select a container, panel, or a widget inside a group.");
            return;
        }
        enterGroupEditMode(gid, isGroupComponent(comp) ? null : ids[0]);
        return;
    }
    if (act === "exit-group-edit") {
        exitGroupEditMode(true);
        return;
    }
    if (act === "z-front" || act === "z-back" || act === "z-forward" || act === "z-backward") {
        if (ids.length !== 1) {
            log("warn", "Select one widget to change draw order.");
            return;
        }
        const map = {
            "z-front": "front",
            "z-back": "back",
            "z-forward": "forward",
            "z-backward": "backward"
        };
        vscode.postMessage({
            type: "reorderWidget",
            pageIndex: currentPageIndex,
            componentId: ids[0],
            action: map[act]
        });
        return;
    }
    if (act === "save-group-to-library") {
        if (ids.length !== 1) {
            log("warn", "Select a single container or panel to save to the library.");
            return;
        }
        vscode.postMessage({
            type: "saveGroupToLibrary",
            pageIndex: currentPageIndex,
            componentId: ids[0]
        });
        return;
    }
    const boxes = /** @type {{ id: string; x: number; y: number; width: number; height: number }[]} */ (
        getMultiSelectionBoxes(page, ids)
    );
    if (!boxes.length) {
        return;
    }

    const minX = Math.min(...boxes.map(b => b.x));
    const minY = Math.min(...boxes.map(b => b.y));
    const maxR = Math.max(...boxes.map(b => b.x + b.width));
    const maxB = Math.max(...boxes.map(b => b.y + b.height));
    const bboxCx = (minX + maxR) / 2;
    const bboxCy = (minY + maxB) / 2;

    const needsPair = ["distribute-h", "distribute-v", "match-width", "match-height"].includes(act);
    if (needsPair && boxes.length < 2) {
        log("warn", "Select at least two widgets for distribute / match size.");
        return;
    }

    switch (act) {
        case "align-left":
            postBulkMoveAbsolute(boxes.map(b => ({ componentId: b.id, absX: minX, absY: b.y })));
            break;
        case "align-right":
            postBulkMoveAbsolute(boxes.map(b => ({ componentId: b.id, absX: maxR - b.width, absY: b.y })));
            break;
        case "align-top":
            postBulkMoveAbsolute(boxes.map(b => ({ componentId: b.id, absX: b.x, absY: minY })));
            break;
        case "align-bottom":
            postBulkMoveAbsolute(boxes.map(b => ({ componentId: b.id, absX: b.x, absY: maxB - b.height })));
            break;
        case "align-center-h": {
            postBulkMoveAbsolute(
                boxes.map(b => ({
                    componentId: b.id,
                    absX: Math.round(bboxCx - b.width / 2),
                    absY: b.y
                }))
            );
            break;
        }
        case "align-center-v":
            postBulkMoveAbsolute(
                boxes.map(b => ({
                    componentId: b.id,
                    absX: b.x,
                    absY: Math.round(bboxCy - b.height / 2)
                }))
            );
            break;
        case "distribute-h": {
            const sorted = [...boxes].sort((a, b) => a.x - b.x);
            const left0 = sorted[0].x;
            const span = sorted[sorted.length - 1].x + sorted[sorted.length - 1].width - left0;
            const innerW = sorted.reduce((s, b) => s + b.width, 0);
            const gaps = sorted.length - 1;
            const gap = gaps > 0 ? (span - innerW) / gaps : 0;
            let cursor = left0;
            const moves = sorted.map(b => {
                const nx = cursor;
                cursor += b.width + gap;
                return { componentId: b.id, absX: nx, absY: b.y };
            });
            postBulkMoveAbsolute(moves);
            break;
        }
        case "distribute-v": {
            const sorted = [...boxes].sort((a, b) => a.y - b.y);
            const top0 = sorted[0].y;
            const span = sorted[sorted.length - 1].y + sorted[sorted.length - 1].height - top0;
            const innerH = sorted.reduce((s, b) => s + b.height, 0);
            const gaps = sorted.length - 1;
            const gap = gaps > 0 ? (span - innerH) / gaps : 0;
            let cursor = top0;
            const moves = sorted.map(b => {
                const ny = cursor;
                cursor += b.height + gap;
                return { componentId: b.id, absX: b.x, absY: ny };
            });
            postBulkMoveAbsolute(moves);
            break;
        }
        case "match-width": {
            const wMax = Math.max(...boxes.map(b => b.width));
            vscode.postMessage({
                type: "bulkPatchWidgets",
                pageIndex: currentPageIndex,
                updates: boxes.map(b => ({
                    componentId: b.id,
                    patch: { width: Math.round(wMax) }
                }))
            });
            break;
        }
        case "match-height": {
            const hMax = Math.max(...boxes.map(b => b.height));
            vscode.postMessage({
                type: "bulkPatchWidgets",
                pageIndex: currentPageIndex,
                updates: boxes.map(b => ({
                    componentId: b.id,
                    patch: { height: Math.round(hMax) }
                }))
            });
            break;
        }
        case "grp-left": {
            const dx = -minX;
            postBulkMoveAbsolute(boxes.map(b => ({ componentId: b.id, absX: b.x + dx, absY: b.y })));
            break;
        }
        case "grp-top": {
            const dy = -minY;
            postBulkMoveAbsolute(boxes.map(b => ({ componentId: b.id, absX: b.x, absY: b.y + dy })));
            break;
        }
        case "grp-center": {
            const bw = maxR - minX;
            const bh = maxB - minY;
            const dx = Math.round((displayWidth - bw) / 2 - minX);
            const dy = Math.round((displayHeight - bh) / 2 - minY);
            postBulkMoveAbsolute(boxes.map(b => ({ componentId: b.id, absX: b.x + dx, absY: b.y + dy })));
            break;
        }
        default:
            break;
    }
}

function clearInspectorSelection() {
    selectedComponentOrder = [];
    inspectorShowingPage = false;
    groupEditContainerId = null;
    dragState = null;
    pendingDrag = null;
    marqueeState = null;
    drawDesignOverlay();
    renderInspector();
}

function selectPageInspector() {
    inspectorShowingPage = true;
    selectedComponentOrder = [];
    groupEditContainerId = null;
    dragState = null;
    pendingDrag = null;
    marqueeState = null;
    drawDesignOverlay();
    renderInspector();
    syncToolbarWidgetSelect();
}

function setSelection(componentId) {
    inspectorShowingPage = false;
    if (componentId && currentProject && !groupEditContainerId) {
        const page = currentProject.pages[currentPageIndex];
        if (page) {
            componentId = unitedSelectionId(page.components, componentId);
        }
    }
    selectedComponentOrder = componentId ? [componentId] : [];
    dragState = null;
    pendingDrag = null;
    marqueeState = null;
    drawDesignOverlay();
    renderInspector();
    syncToolbarWidgetSelect();
    renderWidgetTree();
}

function wirePageInspectorActions() {
    const browseBtn = document.getElementById("btn-browse-codegen-output");
    if (browseBtn && !browseBtn.dataset.wired) {
        browseBtn.dataset.wired = "1";
        browseBtn.addEventListener("click", e => {
            e.preventDefault();
            vscode.postMessage({
                type: "pickCodegenOutputFolder",
                pageIndex: currentPageIndex
            });
        });
    }
    const firmwareBtn = document.getElementById("btn-browse-firmware");
    if (firmwareBtn && !firmwareBtn.dataset.wired) {
        firmwareBtn.dataset.wired = "1";
        firmwareBtn.addEventListener("click", e => {
            e.preventDefault();
            vscode.postMessage({
                type: "pickFirmwareFolder",
                pageIndex: currentPageIndex
            });
        });
    }
    const symBtn = document.getElementById("btn-refresh-symbol-index");
    if (symBtn && !symBtn.dataset.wired) {
        symBtn.dataset.wired = "1";
        symBtn.addEventListener("click", e => {
            e.preventDefault();
            symbolIndexSummary = "Reconnecting clangd…";
            renderInspector();
            vscode.postMessage({ type: "refreshSymbolIndex" });
        });
    }
    wireSymbolSearchInspector();
    const stringsBtn = document.getElementById("btn-open-strings-res");
    if (stringsBtn && !stringsBtn.dataset.wired) {
        stringsBtn.dataset.wired = "1";
        stringsBtn.addEventListener("click", e => {
            e.preventDefault();
            vscode.postMessage({ type: "openStringResources" });
        });
    }
    wireProjectStylesAndFieldsActions();
    wireWidgetTextModeToggles();
}

let symbolSearchDebounceTimer = null;

/** Kinds that may expose members when clicked (struct instance, typedef, etc.). */
const SYMBOL_MEMBER_KINDS = new Set(["struct", "variable", "typedef", "enum"]);

function symbolMayHaveMembers(node) {
    return (
        SYMBOL_MEMBER_KINDS.has(node.kind) &&
        typeof node.filePath === "string" &&
        typeof node.line === "number"
    );
}

function appendSymbolResultRow(parent, node, depth = 0, opts = {}) {
    const pickMode = typeof opts.onPick === "function";
    const rootSymbol = depth === 0 ? node.name : opts.rootSymbol || node.name;
    const pathParts = Array.isArray(opts.pathParts) ? opts.pathParts : [];

    const li = document.createElement("li");
    if (depth > 0) {
        li.className = "sym-member";
        li.style.paddingLeft = `${8 + depth * 12}px`;
    }
    const expandable = symbolMayHaveMembers(node);
    if (expandable) {
        li.classList.add("sym-expandable");
        li.tabIndex = 0;
    }
    if (pickMode) {
        li.classList.add("sym-pickable");
        li.title = expandable
            ? "Click to bind; chevron expands members"
            : "Click to bind to this symbol";
    } else if (expandable) {
        li.title = "Click to show members";
    }
    const kind = document.createElement("span");
    kind.className = "sym-kind";
    kind.textContent = symbolKindLabel(node.kind);
    kind.title = node.kind || "";
    li.appendChild(kind);
    const nameEl = document.createElement("span");
    nameEl.className = "sym-name";
    nameEl.textContent = node.name || "";
    li.appendChild(nameEl);
    let chev = null;
    if (expandable) {
        chev = document.createElement("span");
        chev.className = "sym-chevron";
        chev.textContent = "▸";
        chev.setAttribute("aria-hidden", "true");
        chev.title = "Show members";
        li.appendChild(chev);
    }
    if (pickMode) {
        const pickBtn = document.createElement("button");
        pickBtn.type = "button";
        pickBtn.className = "tb-btn-small sym-pick-btn";
        pickBtn.textContent = "Bind";
        pickBtn.title = "Use this symbol";
        li.appendChild(pickBtn);
    }
    const detail = node.signature || node.typeHint;
    if (detail) {
        const d = document.createElement("div");
        d.className = "sym-detail";
        d.textContent = detail;
        li.appendChild(d);
    }
    const fp = formatSymbolFilePath(node.filePath);
    if (fp) {
        const loc = document.createElement("div");
        loc.className = "sym-file";
        loc.textContent = fp + (typeof node.line === "number" ? `:${node.line + 1}` : "");
        li.appendChild(loc);
    }
    parent.appendChild(li);

    const memberPath = pathParts.join(".");
    const displayPath = memberPath ? `${rootSymbol}.${memberPath}` : rootSymbol;

    const firePick = () => {
        opts.onPick({
            rootSymbol,
            memberPath,
            displayPath,
            kind: node.kind,
            typeHint: node.typeHint || node.signature || ""
        });
    };

    if (pickMode) {
        const pickBtn = li.querySelector(".sym-pick-btn");
        if (pickBtn) {
            pickBtn.addEventListener("click", e => {
                e.preventDefault();
                e.stopPropagation();
                firePick();
            });
        }
        li.addEventListener("click", e => {
            if (e.target instanceof Element && e.target.closest(".sym-chevron")) {
                return;
            }
            if (e.target instanceof Element && e.target.closest(".sym-pick-btn")) {
                return;
            }
            e.preventDefault();
            firePick();
        });
    }

    if (expandable) {
        const membersUl = document.createElement("ul");
        membersUl.className = "symbol-search-members";
        membersUl.hidden = true;
        li.appendChild(membersUl);

        const toggleMembers = e => {
            if (e) {
                e.preventDefault();
                e.stopPropagation();
            }
            if (membersUl.dataset.loaded === "1") {
                membersUl.hidden = !membersUl.hidden;
                if (chev) {
                    chev.textContent = membersUl.hidden ? "▸" : "▾";
                }
                return;
            }
            membersUl.hidden = false;
            if (chev) {
                chev.textContent = "▾";
            }
            membersUl.innerHTML = "<li>Loading members…</li>";
            void fetchFirmwareSymbolMembers({
                name: node.name,
                filePath: node.filePath,
                line: node.line
            })
                .then(res => {
                    membersUl.innerHTML = "";
                    if (res.status !== "ready" || !res.members.length) {
                        const empty = document.createElement("li");
                        empty.textContent =
                            res.message || res.summary || "No members found";
                        membersUl.appendChild(empty);
                    } else {
                        for (const m of res.members) {
                            appendSymbolResultRow(
                                membersUl,
                                m,
                                depth + 1,
                                pickMode
                                    ? {
                                          onPick: opts.onPick,
                                          rootSymbol,
                                          pathParts: [...pathParts, m.name]
                                      }
                                    : {}
                            );
                        }
                    }
                    membersUl.dataset.loaded = "1";
                })
                .catch(err => {
                    membersUl.innerHTML = "";
                    const errLi = document.createElement("li");
                    errLi.textContent = err?.message ?? String(err);
                    membersUl.appendChild(errLi);
                });
        };
        if (chev) {
            chev.addEventListener("click", toggleMembers);
        }
        if (!pickMode) {
            li.addEventListener("click", e => {
                e.preventDefault();
                toggleMembers();
            });
            li.addEventListener("keydown", e => {
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    toggleMembers();
                }
            });
        }
    }
}

function renderSymbolSearchResults(nodes, status, message, resultCount) {
    const list = document.getElementById("symbol-search-results");
    const footer = document.getElementById("symbol-search-footer");
    if (!list) {
        return;
    }
    list.innerHTML = "";
    if (footer) {
        footer.textContent = "";
    }
    if (status !== "ready") {
        const li = document.createElement("li");
        li.textContent = message || status || "clangd not ready";
        list.appendChild(li);
        return;
    }
    if (!nodes.length) {
        const li = document.createElement("li");
        li.textContent = message || "No matching symbols";
        list.appendChild(li);
    }
    for (const node of nodes) {
        appendSymbolResultRow(list, node);
    }
    if (footer && typeof resultCount === "number" && resultCount > 0) {
        footer.textContent = `${resultCount} result${resultCount === 1 ? "" : "s"}`;
    }
}

function wireSymbolSearchInspector() {
    const input = /** @type {HTMLInputElement | null} */ (document.getElementById("symbol-search-query"));
    const kindSel = /** @type {HTMLSelectElement | null} */ (document.getElementById("symbol-kind-filter"));
    if (!input || input.dataset.wired) {
        return;
    }
    input.dataset.wired = "1";
    if (kindSel) {
        kindSel.dataset.wired = "1";
    }
    input.disabled = symbolIndexStatus !== "ready";
    if (kindSel) {
        kindSel.disabled = symbolIndexStatus !== "ready";
    }
    const runSearch = () => {
        const q = input.value.trim();
        const kinds = kindSel?.value ? [kindSel.value] : undefined;
        const list = document.getElementById("symbol-search-results");
        if (!q) {
            if (list) {
                list.innerHTML = "<li>Type a name to search firmware symbols (IntelliSense-style).</li>";
            }
            const footer = document.getElementById("symbol-search-footer");
            if (footer) {
                footer.textContent = "";
            }
            return;
        }
        if (list) {
            list.innerHTML = "<li>Searching…</li>";
        }
        void searchFirmwareSymbols(q, { limit: 80, kinds })
            .then(res => {
                renderSymbolSearchResults(
                    res.nodes,
                    res.status,
                    res.message || res.summary,
                    res.nodes.length
                );
            })
            .catch(err => {
                renderSymbolSearchResults([], "error", err?.message ?? String(err));
            });
    };
    input.addEventListener("input", () => {
        if (symbolSearchDebounceTimer) {
            clearTimeout(symbolSearchDebounceTimer);
        }
        symbolSearchDebounceTimer = setTimeout(runSearch, 280);
    });
    if (kindSel) {
        kindSel.addEventListener("change", runSearch);
    }
    runSearch();
}

/** Toggle literal vs resource inputs in widget text inspector fields. */
function wireWidgetTextModeToggles() {
    if (!inspectorForm) {
        return;
    }
    inspectorForm.querySelectorAll("select[name$='Mode']").forEach(sel => {
        if (!(sel instanceof HTMLSelectElement) || sel.dataset.wired) {
            return;
        }
        if (!/^textMode$|^labelMode$/.test(sel.name)) {
            return;
        }
        sel.dataset.wired = "1";
        const base = sel.name.replace(/Mode$/, "");
        const sync = () => {
            const literal = inspectorForm.querySelector(`input[name="${base}"]`);
            const ref = inspectorForm.querySelector(`select[name="${base}Ref"]`);
            const isResource = sel.value === "resource";
            if (literal instanceof HTMLInputElement) {
                literal.hidden = isResource;
            }
            if (ref instanceof HTMLSelectElement) {
                ref.hidden = !isResource;
            }
        };
        sel.addEventListener("change", sync);
        sync();
    });
}

/** Add/Remove buttons for the project-level styles + data-fields panels in the page inspector. */
function wireProjectStylesAndFieldsActions() {
    if (!inspectorForm || !currentProject) return;

    const addStyle = inspectorForm.querySelector(`[data-proj-style-add="1"]`);
    if (addStyle && !addStyle.dataset.wired) {
        addStyle.dataset.wired = "1";
        addStyle.addEventListener("click", () => {
            const next = (currentProject.styles ?? []).slice();
            const id = nextUniqueIdAmong(next.map(s => s.id), "style");
            next.push({ id, props: {} });
            vscode.postMessage({
                type: "updatePage",
                pageIndex: currentPageIndex,
                patch: { projStyles: next }
            });
        });
    }
    inspectorForm.querySelectorAll(`[data-proj-style-remove]`).forEach(btn => {
        if (btn.dataset.wired) return;
        btn.dataset.wired = "1";
        btn.addEventListener("click", () => {
            const idx = Number(/** @type {HTMLElement} */ (btn).dataset.projStyleRemove);
            if (!Number.isInteger(idx)) return;
            const next = (currentProject.styles ?? []).slice();
            next.splice(idx, 1);
            vscode.postMessage({
                type: "updatePage",
                pageIndex: currentPageIndex,
                patch: { projStyles: next }
            });
        });
    });

    const addProp = inspectorForm.querySelector(`[data-proj-prop-add="1"]`);
    if (addProp && !addProp.dataset.wired) {
        addProp.dataset.wired = "1";
        addProp.addEventListener("click", () => {
            const next = getPreviewProperties().slice();
            const id = nextUniqueIdAmong(next.map(f => f.id), "prop");
            next.push({ id, type: "string", default: "", direction: "unknown" });
            vscode.postMessage({
                type: "updatePage",
                pageIndex: currentPageIndex,
                patch: { projModelProperties: next }
            });
        });
    }
    inspectorForm.querySelectorAll(`[data-proj-prop-remove]`).forEach(btn => {
        if (btn.dataset.wired) return;
        btn.dataset.wired = "1";
        btn.addEventListener("click", () => {
            const idx = Number(/** @type {HTMLElement} */ (btn).dataset.projPropRemove);
            if (!Number.isInteger(idx)) return;
            const next = getPreviewProperties().slice();
            next.splice(idx, 1);
            vscode.postMessage({
                type: "updatePage",
                pageIndex: currentPageIndex,
                patch: { projModelProperties: next }
            });
        });
    });
}

function nextUniqueIdAmong(existing, prefix) {
    const set = new Set(existing);
    for (let i = 1; i < 10000; i++) {
        const id = `${prefix}_${i}`;
        if (!set.has(id)) return id;
    }
    return `${prefix}_${Date.now()}`;
}

/** @returns {{ id: string, path: string, uri: string }[]} */
function listProjectImageAssets() {
    const out = [];
    for (const entry of currentProject?.images ?? []) {
        const id = String(entry?.id ?? "").trim();
        if (!id) {
            continue;
        }
        out.push({
            id,
            path: String(entry?.path ?? "").trim(),
            uri: imageAssetUris[id] ?? ""
        });
    }
    return out;
}

function imageSrcInspectorHtml(comp) {
    const src = String(comp.src ?? "");
    const entry =
        currentProject?.images?.find(e => e.id === src) ?? null;
    const pathHint = entry?.path ?? "";
    const hint = pathHint
        ? `File: ${pathHint}`
        : "Type an asset id or use Browse to register a PNG/JPEG/BMP in project.images[].";
    return (
        `<div class="field"><label>Image source (asset id)</label>` +
        `<div class="inspector-path-row">` +
        `<div class="image-src-combobox">` +
        `<input type="text" name="src" value="${esc(src)}" autocomplete="off" spellcheck="false" placeholder="Type id…" aria-autocomplete="list" aria-expanded="false" />` +
        `<div class="image-asset-dropdown" hidden role="listbox"></div>` +
        `</div>` +
        `<button type="button" class="tb-btn-small btn-browse-image-src" data-component-id="${esc(comp.id)}">Browse...</button>` +
        `</div>` +
        `<p class="inspector-field-hint">${esc(hint)}</p></div>`
    );
}

function filterImageAssetsByPrefix(query) {
    const q = query.trim().toLowerCase();
    const all = listProjectImageAssets();
    if (!q) {
        return all;
    }
    return all.filter(
        a => a.id.toLowerCase().startsWith(q) || a.path.toLowerCase().startsWith(q)
    );
}

function renderImageAssetDropdown(dropdown, query, activeId) {
    if (!dropdown) {
        return;
    }
    const matches = filterImageAssetsByPrefix(query);
    dropdown.innerHTML = "";
    if (matches.length === 0) {
        const empty = document.createElement("div");
        empty.className = "image-asset-dropdown-empty";
        empty.textContent = query.trim()
            ? "No matching assets — try Browse…"
            : "No assets yet — use Browse…";
        dropdown.appendChild(empty);
        return;
    }
    for (const asset of matches) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "image-asset-option";
        btn.setAttribute("role", "option");
        btn.dataset.assetId = asset.id;
        if (asset.id === activeId) {
            btn.setAttribute("aria-selected", "true");
        }
        if (asset.uri) {
            const img = document.createElement("img");
            img.className = "image-asset-thumb";
            img.src = asset.uri;
            img.alt = "";
            btn.appendChild(img);
        } else {
            const ph = document.createElement("span");
            ph.className = "image-asset-thumb-placeholder";
            ph.setAttribute("aria-hidden", "true");
            btn.appendChild(ph);
        }
        const text = document.createElement("span");
        text.className = "image-asset-option-text";
        const idLine = document.createElement("span");
        idLine.className = "image-asset-option-id";
        idLine.textContent = asset.id;
        text.appendChild(idLine);
        if (asset.path) {
            const pathLine = document.createElement("span");
            pathLine.className = "image-asset-option-path";
            pathLine.textContent = asset.path;
            text.appendChild(pathLine);
        }
        btn.appendChild(text);
        dropdown.appendChild(btn);
    }
}

function wireImageInspectorActions() {
    const browseBtn = inspectorForm?.querySelector(".btn-browse-image-src");
    if (browseBtn instanceof HTMLButtonElement && !browseBtn.dataset.wired) {
        browseBtn.dataset.wired = "1";
        browseBtn.addEventListener("click", e => {
            e.preventDefault();
            const componentId = browseBtn.getAttribute("data-component-id");
            if (!componentId) {
                return;
            }
            vscode.postMessage({
                type: "pickImageSource",
                pageIndex: currentPageIndex,
                componentId
            });
        });
    }

    const combobox = inspectorForm?.querySelector(".image-src-combobox");
    if (!(combobox instanceof HTMLElement) || combobox.dataset.wired) {
        return;
    }
    combobox.dataset.wired = "1";

    const input = combobox.querySelector('input[name="src"]');
    const dropdown = combobox.querySelector(".image-asset-dropdown");
    if (!(input instanceof HTMLInputElement) || !(dropdown instanceof HTMLElement)) {
        return;
    }

    let pickerCloseTimer = null;
    let pickerSuppressOpen = false;

    const showDropdown = () => {
        if (pickerSuppressOpen) {
            return;
        }
        renderImageAssetDropdown(dropdown, input.value, input.value.trim());
        dropdown.hidden = false;
        input.setAttribute("aria-expanded", "true");
    };

    const hideDropdown = () => {
        dropdown.hidden = true;
        input.setAttribute("aria-expanded", "false");
    };

    const scheduleHideDropdown = () => {
        if (pickerCloseTimer) {
            clearTimeout(pickerCloseTimer);
        }
        pickerCloseTimer = setTimeout(() => {
            pickerCloseTimer = null;
            hideDropdown();
        }, 180);
    };

    const pickAsset = id => {
        if (pickerCloseTimer) {
            clearTimeout(pickerCloseTimer);
            pickerCloseTimer = null;
        }
        pickerSuppressOpen = true;
        input.value = id;
        hideDropdown();
        commitInspector();
        if (currentProject && selectedComponentOrder.length === 1) {
            const page = currentProject.pages[currentPageIndex];
            const comp = page
                ? findComponentById(page.components, selectedComponentOrder[0])
                : null;
            if (comp && comp.type === "image") {
                comp.src = id;
            }
            scheduleImageOverlaySync();
        }
        queueMicrotask(() => {
            pickerSuppressOpen = false;
            input.focus();
        });
    };

    input.addEventListener("input", () => {
        showDropdown();
    });

    input.addEventListener("blur", () => {
        scheduleHideDropdown();
    });

    input.addEventListener("keydown", e => {
        if (e.key === "Escape") {
            hideDropdown();
            return;
        }
        if (e.key === "ArrowDown") {
            if (dropdown.hidden) {
                showDropdown();
            }
            e.preventDefault();
            return;
        }
        if (e.key === "Enter" && !dropdown.hidden) {
            const first = dropdown.querySelector(".image-asset-option");
            if (first instanceof HTMLElement && first.dataset.assetId) {
                e.preventDefault();
                pickAsset(first.dataset.assetId);
            }
        }
    });

    dropdown.addEventListener("pointerdown", e => {
        const opt = e.target instanceof Element ? e.target.closest(".image-asset-option") : null;
        if (!opt || !(opt instanceof HTMLElement)) {
            return;
        }
        e.preventDefault();
        const id = opt.dataset.assetId;
        if (id) {
            pickAsset(id);
        }
    });
}

/**
 * Contextual hint under firmware / symbol index status (avoids error-like text when ready).
 * @returns {string}
 */
function renderSymbolIndexHintHtml() {
    switch (symbolIndexStatus) {
        case "ready":
            return (
                `Search works like IDE IntelliSense — type a name and results come from clangd. ` +
                `Click a struct or variable to expand members.`
            );
        case "missing_clangd":
            return `Run <strong>EmbeddedFlow: Install requirements</strong> to download clangd, or set <code>embeddedflow.clangdPath</code>.`;
        case "missing_firmware":
            return `Set <strong>Firmware project path</strong> above (relative to .embf or absolute), or use <strong>Browse…</strong>.`;
        case "error":
            return symbolIndexSummary
                ? esc(symbolIndexSummary)
                : "clangd error — check Output → embeddedflow.";
        case "idle":
        default:
            if (!compileCommandsPath) {
                return `Build the firmware project first so <code>build/compile_commands.json</code> exists.`;
            }
            return `Set firmware path above, then type in the search box. Use <strong>Reconnect clangd</strong> after a rebuild.`;
    }
}

function symbolKindLabel(kind) {
    switch (kind) {
        case "function":
            return "Function";
        case "variable":
            return "Global";
        case "field":
            return "Field";
        case "struct":
            return "Struct";
        case "enum":
            return "Enum";
        case "typedef":
            return "Typedef";
        default:
            return "Symbol";
    }
}

/** Widget properties bindable to firmware C symbols (BU1). */
const WIDGET_C_BIND_PROPS = {
    label: ["text"],
    slider: ["value"],
    bar: ["value"],
    arc: ["value"],
    knob: ["value"]
};

const C_BIND_PROP_LABELS = {
    text: "Text",
    value: "Value"
};

/** @type {{ compId: string; property: string } | null} */
let symbolBindPickerTarget = null;
let symbolBindPickerDebounce = null;

function sourceIdFromSymbol(symbol) {
    const base = String(symbol || "sym")
        .replace(/[^a-zA-Z0-9_]/g, "_")
        .replace(/^([0-9])/, "_$1");
    return `src_${base}`;
}

function getProjectDataSources() {
    return currentProject?.dataModel?.sources ?? [];
}

function getProjectDataBindings() {
    return currentProject?.dataModel?.bindings ?? [];
}

function findDataBindingForTarget(compId, property) {
    const target = `${compId}.${property}`;
    return getProjectDataBindings().find(b => b.target === target);
}

function formatDataBindingPath(binding) {
    if (!binding) {
        return "";
    }
    const src = getProjectDataSources().find(s => s.id === binding.sourceId);
    const root = src?.symbol ?? binding.sourceId;
    return binding.path ? `${root}.${binding.path}` : root;
}

function upsertDataSource(sources, pick) {
    const next = sources.slice();
    const existing = next.find(s => s.symbol === pick.rootSymbol);
    if (existing) {
        return { sources: next, sourceId: existing.id };
    }
    const id = sourceIdFromSymbol(pick.rootSymbol);
    const uniqueId = next.some(s => s.id === id)
        ? `${id}_${next.length + 1}`
        : id;
    next.push({
        id: uniqueId,
        kind: pick.kind === "function" ? "function" : "global",
        symbol: pick.rootSymbol,
        ...(pick.typeHint ? { type: pick.typeHint } : {})
    });
    return { sources: next, sourceId: uniqueId };
}

function applyDataBindingPick(compId, property, pick) {
    if (!currentProject || !pick?.rootSymbol) {
        return;
    }
    const { sources, sourceId } = upsertDataSource(getProjectDataSources(), pick);
    const target = `${compId}.${property}`;
    const bindings = getProjectDataBindings().slice();
    const idx = bindings.findIndex(b => b.target === target);
    const entry = {
        id: idx >= 0 ? bindings[idx].id : `bind_${compId}_${property}`,
        target,
        sourceId,
        path: pick.memberPath || ""
    };
    if (idx >= 0) {
        bindings[idx] = { ...bindings[idx], ...entry };
    } else {
        bindings.push(entry);
    }
    vscode.postMessage({
        type: "updatePage",
        pageIndex: currentPageIndex,
        patch: { projDataSources: sources, projDataBindings: bindings }
    });
    closeSymbolBindPicker();
}

function clearDataBinding(compId, property) {
    const target = `${compId}.${property}`;
    const bindings = getProjectDataBindings().filter(b => b.target !== target);
    vscode.postMessage({
        type: "updatePage",
        pageIndex: currentPageIndex,
        patch: { projDataBindings: bindings.length ? bindings : null }
    });
}

function closeSymbolBindPicker() {
    symbolBindPickerTarget = null;
    const el = document.getElementById("symbol-bind-picker");
    if (el) {
        el.hidden = true;
    }
}

function openSymbolBindPicker(compId, property) {
    if (symbolIndexStatus !== "ready") {
        return;
    }
    symbolBindPickerTarget = { compId, property };
    const el = document.getElementById("symbol-bind-picker");
    if (!el) {
        return;
    }
    el.hidden = false;
    const title = document.getElementById("symbol-bind-picker-title");
    if (title) {
        title.textContent = `Bind ${C_BIND_PROP_LABELS[property] || property} → C symbol`;
    }
    const input = /** @type {HTMLInputElement | null} */ (
        document.getElementById("symbol-bind-picker-query")
    );
    if (input) {
        input.value = "";
        input.focus();
    }
    renderSymbolBindPickerResults([], "ready", "Type to search firmware symbols.");
    wireSymbolBindPickerOnce();
}

function renderSymbolBindPickerResults(nodes, status, message) {
    const list = document.getElementById("symbol-bind-picker-results");
    if (!list) {
        return;
    }
    list.innerHTML = "";
    if (status !== "ready") {
        const li = document.createElement("li");
        li.textContent = message || status || "clangd not ready";
        list.appendChild(li);
        return;
    }
    if (!nodes.length) {
        const li = document.createElement("li");
        li.textContent = message || "No matching symbols";
        list.appendChild(li);
        return;
    }
    for (const node of nodes) {
        appendSymbolResultRow(list, node, 0, {
            onPick: pick => {
                if (symbolBindPickerTarget) {
                    applyDataBindingPick(
                        symbolBindPickerTarget.compId,
                        symbolBindPickerTarget.property,
                        pick
                    );
                }
            }
        });
    }
}

function wireSymbolBindPickerOnce() {
    const root = document.getElementById("symbol-bind-picker");
    if (!root || root.dataset.wired) {
        return;
    }
    root.dataset.wired = "1";
    const backdrop = root.querySelector(".symbol-bind-picker-backdrop");
    const closeBtn = document.getElementById("symbol-bind-picker-close");
    const input = /** @type {HTMLInputElement | null} */ (
        document.getElementById("symbol-bind-picker-query")
    );
    const kindSel = /** @type {HTMLSelectElement | null} */ (
        document.getElementById("symbol-bind-picker-kind")
    );
    const runSearch = () => {
        if (!input) {
            return;
        }
        const q = input.value.trim();
        if (!q) {
            renderSymbolBindPickerResults([], "ready", "Type to search firmware symbols.");
            return;
        }
        const kinds = kindSel?.value ? [kindSel.value] : undefined;
        renderSymbolBindPickerResults([], "ready", "Searching…");
        void searchFirmwareSymbols(q, { limit: 60, kinds })
            .then(res => {
                renderSymbolBindPickerResults(
                    res.nodes,
                    res.status,
                    res.message || res.summary
                );
            })
            .catch(err => {
                renderSymbolBindPickerResults([], "error", err?.message ?? String(err));
            });
    };
    if (backdrop) {
        backdrop.addEventListener("click", closeSymbolBindPicker);
    }
    if (closeBtn) {
        closeBtn.addEventListener("click", e => {
            e.preventDefault();
            closeSymbolBindPicker();
        });
    }
    if (input) {
        input.addEventListener("input", () => {
            if (symbolBindPickerDebounce) {
                clearTimeout(symbolBindPickerDebounce);
            }
            symbolBindPickerDebounce = setTimeout(runSearch, 280);
        });
    }
    if (kindSel) {
        kindSel.addEventListener("change", runSearch);
    }
    window.addEventListener("keydown", e => {
        if (e.key === "Escape" && root && !root.hidden) {
            closeSymbolBindPicker();
        }
    });
}

function inspectorCBindingsSection(comp) {
    const props = WIDGET_C_BIND_PROPS[comp.type];
    if (!props?.length) {
        return "";
    }
    const canPick = symbolIndexStatus === "ready";
    let rows = "";
    for (const prop of props) {
        const binding = findDataBindingForTarget(comp.id, prop);
        const path = formatDataBindingPath(binding);
        rows +=
            `<div class="c-bind-row" data-c-bind-row="${esc(prop)}">` +
            `<label>${esc(C_BIND_PROP_LABELS[prop] || prop)}</label>` +
            `<div class="c-bind-current">` +
            (path
                ? `<code class="c-bind-path">${esc(path)}</code>`
                : `<span class="c-bind-none">(not bound)</span>`) +
            `</div>` +
            `<div class="c-bind-actions">` +
            `<button type="button" class="tb-btn-small" data-c-bind-pick="${esc(prop)}" ${
                canPick ? "" : "disabled"
            }>Bind Data…</button>` +
            (path
                ? `<button type="button" class="tb-btn-small" data-c-bind-clear="${esc(prop)}">Clear</button>`
                : "") +
            `</div></div>`;
    }
    const hint =
        symbolIndexStatus === "ready"
            ? "Pick a firmware symbol; expand structs to bind members."
            : symbolIndexStatus === "missing_firmware"
              ? "Set firmware project path on the page inspector first."
              : symbolIndexStatus === "missing_clangd"
                ? "Install clangd via EmbeddedFlow: Install requirements."
                : "Link firmware and clangd to bind C symbols.";
    return (
        `<div class="inspector-group-title">Bind Data</div>` +
        `<p class="c-bind-intro">${esc(hint)}</p>` +
        rows
    );
}

/** Short path for display (prefer main/… under firmware root). */
function formatSymbolFilePath(filePath) {
    if (!filePath || typeof filePath !== "string") {
        return "";
    }
    const norm = filePath.replace(/\\/g, "/");
    const root = (firmwarePathResolved || "").replace(/\\/g, "/");
    if (root && norm.toLowerCase().startsWith(root.toLowerCase() + "/")) {
        return norm.slice(root.length + 1);
    }
    const mainIdx = norm.toLowerCase().indexOf("/main/");
    if (mainIdx >= 0) {
        return norm.slice(mainIdx + 1);
    }
    const parts = norm.split("/");
    return parts.length > 2 ? parts.slice(-3).join("/") : norm;
}

/**
 * Full HTML block for inspecting the active page (.embf pages[] entry + project.theme.dark).
 * @param {object} page
 * @param {object} project
 */
function renderPageInspectorHtml(page, project) {
    let html =
        `<div id="inspector-readonly"><strong>${esc(page.id)}</strong> · Page &amp; project</div>` +
        `<div class="inspector-group-title">Page</div>` +
        fieldText("page_display_name", "Tab / page name", page.name ?? "") +
        `<div class="field"><p style="font-size:11px;color:#888;margin:0 0 8px;line-height:1.35;">Leave background empty so the LVGL default theme (light/dark) sets the screen color.</p></div>` +
        fieldColor("page_backgroundColor", "Screen background (#hex)", page.backgroundColor ?? "") +
        `<div class="row2">${fieldCheck("page_scrollX", "Scroll X", !!page.scrollX)}${fieldCheck("page_scrollY", "Scroll Y", !!page.scrollY)}</div>` +
        `<div class="inspector-group-title">Project</div>` +
        fieldText("proj_name", "Name", (project.project && project.project.name) || "") +
        fieldSelect(
            "proj_lvglVersion",
            "LVGL version",
            [
                { value: "8.4.0", label: "8.4.0" },
                { value: "9.2.2", label: "9.2.2" },
                { value: "9.3.0", label: "9.3.0" },
                { value: "9.4.0", label: "9.4.0" },
                { value: "9.5.0", label: "9.5.0" }
            ],
            (project.project && project.project.lvglVersion) || "9.5.0"
        ) +
        fieldTextarea(
            "proj_description",
            "Description",
            (project.project && project.project.description) || ""
        ) +
        `<div class="inspector-group-title">Firmware / symbols</div>` +
        fieldText(
            "proj_firmwarePath",
            "Firmware project path",
            (project.project && project.project.firmwarePath) || ""
        ) +
        `<button type="button" class="tb-btn-small" id="btn-browse-firmware">Browse…</button>` +
        `<button type="button" class="tb-btn-small" id="btn-refresh-symbol-index">Reconnect clangd</button>` +
        `<div class="field"><p style="font-size:11px;color:#888;margin:0 0 8px;line-height:1.35;">` +
        `Resolved: <code>${esc(firmwarePathResolved || "(not set)")}</code><br/>` +
        (compileCommandsPath
            ? `compile_commands: <code>${esc(compileCommandsPath)}</code><br/>`
            : "") +
        `clangd: <code class="sym-status sym-status-${esc(symbolIndexStatus)}">${esc(symbolIndexStatus)}</code>` +
        (symbolIndexSummary ? ` — ${esc(symbolIndexSummary)}` : "") +
        `<br/>${renderSymbolIndexHintHtml()}` +
        `</p></div>` +
        `<div class="field"><label for="symbol-search-query">Search firmware symbols</label>` +
        `<p class="symbol-search-intro">Type to search — like IntelliSense. Click structs and globals to see members.</p>` +
        `<div class="row2 symbol-search-filters">` +
        `<input type="search" id="symbol-search-query" autocomplete="off" spellcheck="false" placeholder="e.g. app_data, lv_label_set_text…" ` +
        `${symbolIndexStatus === "ready" ? "" : "disabled"} />` +
        `<select id="symbol-kind-filter" title="Filter by symbol kind" ${symbolIndexStatus === "ready" ? "" : "disabled"}>` +
        `<option value="">All kinds</option>` +
        `<option value="function">Functions</option>` +
        `<option value="variable">Globals</option>` +
        `<option value="field">Fields</option>` +
        `<option value="struct">Structs</option>` +
        `<option value="enum">Enums</option>` +
        `</select></div>` +
        `<ul id="symbol-search-results" class="symbol-search-results" aria-live="polite"></ul>` +
        `<p id="symbol-search-footer" class="symbol-search-footer"></p>` +
        `</div>` +
        `<div class="inspector-group-title">Code generation</div>` +
        fieldSelect(
            "proj_lvglInclude",
            "LVGL header include",
            [
                { value: "lvgl/lvgl.h", label: '#include "lvgl/lvgl.h"' },
                { value: "lvgl.h", label: '#include "lvgl.h"' }
            ],
            (project.project && project.project.lvglInclude) || "lvgl/lvgl.h"
        ) +
        fieldText(
            "proj_outputPath",
            "Output folder (saved in .embf)",
            (project.project && project.project.outputPath) || ""
        ) +
        `<button type="button" class="tb-btn-small" id="btn-browse-codegen-output">Browse...</button>` +
        `<div class="field"><p style="font-size:11px;color:#888;margin:0 0 8px;line-height:1.35;">` +
        `Resolved: <code>${esc(codegenOutputResolved || "(workspace default or ui_output next to .embf)")}</code><br/>` +
        `Relative to the .embf file, or absolute. On first Generate C Code you will be asked if empty.` +
        `</p></div>` +
        `<div class="inspector-group-title">String resources</div>` +
        fieldText(
            "proj_stringsPath",
            "Strings file (.res)",
            (project.project && project.project.stringsPath) || "strings.res"
        ) +
        `<button type="button" class="tb-btn-small" id="btn-open-strings-res">Edit string table…</button>` +
        `<div class="field"><p style="font-size:11px;color:#888;margin:0 0 8px;line-height:1.35;">` +
        `Path to translation table (must end in <code>.res</code>). Default: <code>strings.res</code> next to the .embf file.` +
        (stringsResLoadError
            ? `<br/><span style="color:var(--vscode-errorForeground);">${esc(stringsResLoadError)}</span>`
            : "") +
        `</p></div>` +
        `<div class="inspector-group-title">Display</div>` +
        `<div class="row2">` +
        fieldNum("disp_width", "Width", project.display.width, 1, DISPLAY_DIMENSION_MAX) +
        fieldNum("disp_height", "Height", project.display.height, 1, DISPLAY_DIMENSION_MAX) +
        `</div>` +
        fieldSelect(
            "disp_bitDepth",
            "Bit depth",
            [
                { value: "16", label: "16" },
                { value: "24", label: "24" },
                { value: "32", label: "32" }
            ],
            String(project.display.bitDepth)
        ) +
        fieldSelect(
            "disp_colorFormat",
            "Color format",
            [
                { value: "RGB565", label: "RGB565" },
                { value: "RGB888", label: "RGB888" },
                { value: "ARGB8888", label: "ARGB8888" },
                { value: "L8", label: "L8" },
                { value: "AL88", label: "AL88" }
            ],
            project.display.colorFormat
        ) +
        fieldSelect(
            "disp_orientation",
            "Orientation",
            [
                { value: "portrait", label: "portrait" },
                { value: "landscape", label: "landscape" },
                { value: "portrait_flipped", label: "portrait_flipped" },
                { value: "landscape_flipped", label: "landscape_flipped" }
            ],
            project.display.orientation
        ) +
        fieldSelect(
            "disp_direction",
            "Text direction",
            [
                { value: "ltr", label: "ltr" },
                { value: "rtl", label: "rtl" }
            ],
            project.display.direction
        ) +
        fieldNum("disp_dpi", "DPI (optional)", project.display.dpi ?? "") +
        fieldCheck("disp_round", "Round panel (preview clip)", !!project.display.round) +
        `<div class="inspector-group-title">Theme</div>` +
        fieldCheck("proj_theme_dark", "Dark mode", !!(project.theme && project.theme.dark)) +
        fieldColor(
            "theme_primaryColor",
            "Primary color",
            (project.theme && project.theme.primaryColor) || ""
        ) +
        fieldColor(
            "theme_secondaryColor",
            "Secondary color",
            (project.theme && project.theme.secondaryColor) || ""
        );

    html += projectStylesPanelHtml(project);
    html += projectPropertiesPanelHtml(project);
    return html;
}

function projectStylesPanelHtml(project) {
    const styles = project.styles ?? [];
    let inner = "";
    if (styles.length === 0) {
        inner += `<p style="font-size:11px;color:#888;margin:0 0 6px;">No named styles yet.</p>`;
    } else {
        inner += `<div data-proj-styles-host="1">`;
        styles.forEach((s, i) => {
            inner +=
                `<div class="proj-style-row" data-proj-style-idx="${i}">` +
                `<div class="row2"><div class="field"><label>id</label>` +
                `<input type="text" data-proj-style-field="id" value="${esc(s.id)}" /></div>` +
                `<div class="field"><label>name</label>` +
                `<input type="text" data-proj-style-field="name" value="${esc(s.name ?? "")}" /></div></div>` +
                `<div class="field"><label>props (JSON)</label>` +
                `<textarea data-proj-style-field="props" rows="3" spellcheck="false">${esc(
                    JSON.stringify(s.props ?? {}, null, 0)
                )}</textarea></div>` +
                `<button type="button" class="tb-btn-small" data-proj-style-remove="${i}">Remove</button>` +
                `</div>`;
        });
        inner += `</div>`;
    }
    return (
        `<div class="inspector-group-title">Named styles ` +
        `<button type="button" class="tb-btn-small" data-proj-style-add="1" title="Add named style">+</button></div>` +
        inner
    );
}

function projectPropertiesPanelHtml(project) {
    const props = getPreviewPropertiesFromProject(project);
    let inner = "";
    if (props.length === 0) {
        inner +=
            `<p style="font-size:11px;color:#888;margin:0 0 6px;">No properties yet. Used for preview mocks only (Phase 1 — no codegen).</p>`;
    } else {
        inner += `<div data-proj-props-host="1">`;
        props.forEach((f, i) => {
            const sel = (cur, opts) =>
                opts.map(v => `<option value="${esc(v)}" ${v === cur ? "selected" : ""}>${esc(v)}</option>`).join("");
            const showRange = f.type === "int" || f.type === "float";
            const dir = f.direction ?? "unknown";
            inner +=
                `<div class="proj-prop-row" data-proj-prop-idx="${i}">` +
                `<div class="row2"><div class="field"><label>id</label>` +
                `<input type="text" data-proj-prop-field="id" value="${esc(f.id)}" /></div>` +
                `<div class="field"><label>type</label>` +
                `<select data-proj-prop-field="type">${sel(f.type, ["string", "int", "float", "bool"])}</select></div></div>` +
                `<div class="field"><label>default</label>` +
                `<input type="text" data-proj-prop-field="default" value="${esc(
                    f.default === undefined ? "" : String(f.default)
                )}" /></div>` +
                (showRange
                    ? `<div class="row2"><div class="field"><label>min</label>` +
                      `<input type="number" data-proj-prop-field="min" value="${esc(
                          f.min === undefined ? "" : String(f.min)
                      )}" step="any" /></div>` +
                      `<div class="field"><label>max</label>` +
                      `<input type="number" data-proj-prop-field="max" value="${esc(
                          f.max === undefined ? "" : String(f.max)
                      )}" step="any" /></div></div>`
                    : "") +
                `<div class="field"><label>direction</label>` +
                `<select data-proj-prop-field="direction">${sel(dir, ["unknown", "push", "pull"])}</select></div>` +
                `<button type="button" class="tb-btn-small" data-proj-prop-remove="${i}">Remove</button>` +
                `</div>`;
        });
        inner += `</div>`;
    }
    return (
        `<div class="inspector-group-title">Properties ` +
        `<button type="button" class="tb-btn-small" data-proj-prop-add="1" title="Add property">+</button></div>` +
        inner
    );
}

function getPreviewPropertiesFromProject(project) {
    if (!project) return [];
    if (project.model?.properties !== undefined) {
        return project.model.properties;
    }
    const legacy = project.dataModel?.fields;
    return Array.isArray(legacy) ? legacy : [];
}

function esc(s) {
    return String(s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/"/g, "&quot;");
}

// ── LVGL symbol helpers (for Roller options) ──────────────────────────────────
// LVGL's built-in symbols are FontAwesome glyphs stored in the private-use area
// (see `lv_symbol_def.h`). Many editor fonts render them as □, so we present a
// readable token in the inspector textarea and convert back on save.
const LV_SYMBOL_TOKENS = [
    ["LV_SYMBOL_SETTINGS", "\uf013"],
    ["LV_SYMBOL_EYE_OPEN", "\uf06e"],
    ["LV_SYMBOL_TINT", "\uf043"],
    ["LV_SYMBOL_LIST", "\uf00b"],
    ["LV_SYMBOL_POWER", "\uf011"],
    ["LV_SYMBOL_EDIT", "\uf304"]
];
const LV_SYMBOL_TO_GLYPH = new Map(LV_SYMBOL_TOKENS);
const LV_GLYPH_TO_SYMBOL = new Map(LV_SYMBOL_TOKENS.map(([k, v]) => [v, k]));

function displayRollerOptionLine(line) {
    if (!line) return line;
    const first = line[0];
    const sym = LV_GLYPH_TO_SYMBOL.get(first);
    if (!sym) return line;
    // Replace leading glyph with a readable token; keep spacing stable.
    return line.replace(first, sym);
}

function storeRollerOptionLine(line) {
    const t = String(line ?? "");
    for (const [sym, glyph] of LV_SYMBOL_TOKENS) {
        if (t.startsWith(sym)) {
            return glyph + t.slice(sym.length);
        }
    }
    return t;
}

/** Consensus sentinel for homogeneous multi-inspector fields. */
const INSP_MIXED = Symbol.for("embeddedflow.inspect.mixed");
function isInspMixed(v) {
    return v === INSP_MIXED;
}

function deepInspectEqual(a, b) {
    if (a === b) {
        return true;
    }
    if (a === undefined || b === undefined || a === null || b === null) {
        return a === b;
    }
    if (typeof a === "number" && typeof b === "number") {
        return Number.isFinite(a) && Number.isFinite(b) && a === b;
    }
    return JSON.stringify(a) === JSON.stringify(b);
}

/** Consensus for floating / integer JSON fields (slider, arc, spinner, …). */
function consensusNumeric(comps, key) {
    const raw = comps.map(c => /** @type {Record<string, unknown>} */ (c)[key]);
    if (!raw.every(v => deepInspectEqual(v, raw[0]))) {
        return INSP_MIXED;
    }
    const n = Number(raw[0]);
    return Number.isFinite(n) ? n : INSP_MIXED;
}

/** Consensus for integer-ish widget fields (`selectedIndex`, layout x/y, …). */
function consensusNum(comps, key, fallback = 0) {
    const n = consensusNumeric(comps, key);
    if (isInspMixed(n)) return INSP_MIXED;
    return Number.isFinite(n) ? Math.round(Number(n)) : fallback;
}

function consensusBool(comps, key) {
    const v0 = !!/** @type {object} */ (comps[0])[key];
    if (comps.every(c => !!/** @type {object} */ (c)[key] === v0)) {
        return v0;
    }
    return INSP_MIXED;
}

function consensusStr(comps, key) {
    const v0 = String(/** @type {object} */ (comps[0])[key] ?? "");
    if (comps.every(c => String(/** @type {object} */ (c)[key] ?? "") === v0)) {
        return v0;
    }
    return INSP_MIXED;
}

function consensusEnumStr(comps, key, emptyMeans = "") {
    const v0 = /** @type {object} */ (comps[0])[key];
    const s0 = typeof v0 === "string" ? v0 : emptyMeans;
    if (comps.every(c => String(/** @type {object} */ (c)[key] ?? emptyMeans) === s0)) {
        return s0;
    }
    return INSP_MIXED;
}

/** @param {object[]} comps */
function consensusOptionsLines(comps) {
    const lines0 = (/** @type {Record<string, unknown>} */ (comps[0]).options ?? []).map(String);
    if (
        comps.every(c =>
            deepInspectEqual((/** @type {Record<string, unknown>} */ (c).options ?? []).map(String), lines0)
        )
    ) {
        return lines0;
    }
    return INSP_MIXED;
}

/** @param {object[]} comps */
function consensusLinePointsText(comps) {
    const t0 = (/** @type {object} */ (comps[0]).points ?? [])
        .map(p => `${p.x}, ${p.y}`)
        .join("\n");
    if (
        comps.every(c =>
            deepInspectEqual(
                (/** @type {object} */ (c).points ?? []).map(p => ({ x: p.x, y: p.y })),
                (/** @type {object} */ (comps[0]).points ?? []).map(p => ({ x: p.x, y: p.y }))
            )
        )
    ) {
        return t0;
    }
    return INSP_MIXED;
}

/** @param {object[]} comps */
function consensusStylesModel(comps) {
    /** @type {Record<string, unknown>} */
    const out = {};
    const strKeys = ["bgColor", "indicatorColor", "textColor", "borderColor", "fontFamily"];
    for (const k of strKeys) {
        const v0 = String((comps[0].styles ?? {})[k] ?? "");
        if (comps.every(c => String((c.styles ?? {})[k] ?? "") === v0)) {
            out[k] = v0;
        } else {
            out[k] = INSP_MIXED;
        }
    }

    const numStyle = (key, pred) => {
        const vals = comps.map(c => (c.styles ?? {})[key]);
        if (vals.every(v => deepInspectEqual(v, vals[0])) && (pred ? pred(vals[0]) : true)) {
            return vals[0];
        }
        return INSP_MIXED;
    };

    out.bgOpacity = numStyle("bgOpacity", v => v === undefined || v === null || v === "" || Number.isFinite(Number(v)));
    out.borderWidth = numStyle("borderWidth", () => true);
    out.borderRadius = numStyle("borderRadius", () => true);
    out.fontSize = numStyle("fontSize", () => true);

    const pad0 = (comps[0].styles ?? {}).padding;
    if (comps.every(c => deepInspectEqual((c.styles ?? {}).padding, pad0))) {
        out.padding = pad0;
    } else {
        out.padding = INSP_MIXED;
    }

    const al0 = String((comps[0].styles ?? {}).align ?? "");
    if (comps.every(c => String((c.styles ?? {}).align ?? "") === al0)) {
        out.align = al0;
    } else {
        out.align = INSP_MIXED;
    }

    return out;
}

/** @param {object[]} comps */
function consensusEventsModel(comps) {
    const e0 = comps[0].events ?? [];
    const s0 = JSON.stringify(e0);
    if (comps.every(c => JSON.stringify(c.events ?? []) === s0)) {
        return e0;
    }
    return INSP_MIXED;
}

/** @param {object[]} comps */
function buildConsensusWidgetModel(comps) {
    const t = comps[0].type;
    /** @type {Record<string, unknown>} */
    const m = {};
    switch (t) {
        case "label":
            m.text = consensusStr(comps, "text");
            m.longMode = consensusEnumStr(comps, "longMode", "");
            break;
        case "button":
            m.label = consensusStr(comps, "label");
            break;
        case "image":
            m.src = consensusStr(comps, "src");
            break;
        case "slider":
            m.min = consensusNumeric(comps, "min");
            m.max = consensusNumeric(comps, "max");
            m.value = consensusNumeric(comps, "value");
            break;
        case "bar":
            m.min = consensusNumeric(comps, "min");
            m.max = consensusNumeric(comps, "max");
            m.value = consensusNumeric(comps, "value");
            m.mode = consensusEnumStr(comps, "mode", "");
            break;
        case "arc":
            m.min = consensusNumeric(comps, "min");
            m.max = consensusNumeric(comps, "max");
            m.value = consensusNumeric(comps, "value");
            m.startAngle = consensusNumeric(comps, "startAngle");
            m.endAngle = consensusNumeric(comps, "endAngle");
            m.mode = consensusEnumStr(comps, "mode", "");
            break;
        case "knob":
            m.min = consensusNumeric(comps, "min");
            m.max = consensusNumeric(comps, "max");
            m.value = consensusNumeric(comps, "value");
            m.startAngle = consensusNumeric(comps, "startAngle");
            m.endAngle = consensusNumeric(comps, "endAngle");
            m.indicatorColor = consensusStr(comps, "indicatorColor");
            break;
        case "switch":
            m.checked = consensusBool(comps, "checked");
            break;
        case "checkbox":
            m.text = consensusStr(comps, "text");
            m.checked = consensusBool(comps, "checked");
            break;
        case "dropdown":
            m.options = consensusOptionsLines(comps);
            m.selectedIndex = consensusNum(comps, "selectedIndex", 0);
            break;
        case "roller":
            m.options = consensusOptionsLines(comps);
            m.selectedIndex = consensusNum(comps, "selectedIndex", 0);
            m.mode = consensusEnumStr(comps, "mode", "");
            break;
        case "textarea":
            m.text = consensusStr(comps, "text");
            m.placeholder = consensusStr(comps, "placeholder");
            m.oneLine = consensusBool(comps, "oneLine");
            break;
        case "spinner":
            m.speed = consensusNumeric(comps, "speed");
            m.arcLength = consensusNumeric(comps, "arcLength");
            break;
        case "line": {
            m.linePointsText = consensusLinePointsText(comps);
            m.rounded = consensusBool(comps, "rounded");
            break;
        }
        case "container": {
            const l0 = /** @type {unknown} */ (/** @type {Record<string, unknown>} */ (comps[0]).layout);
            const s0 =
                typeof l0 === "string" && /^(none|flex|grid)$/.test(l0) ? l0 : "none";
            if (
                comps.every(c => {
                    const lv = /** @type {Record<string, unknown>} */ (c).layout;
                    const s =
                        typeof lv === "string" && /^(none|flex|grid)$/.test(lv) ? lv : "none";
                    return s === s0;
                })
            ) {
                m.layout = s0;
            } else {
                m.layout = INSP_MIXED;
            }
            m.flexFlow = consensusEnumStr(comps, "flexFlow", "");
            break;
        }
        default:
            break;
    }
    return m;
}

function refreshMixedCheckboxes(inspectorRoot) {
    if (!inspectorRoot) {
        return;
    }
    for (const el of inspectorRoot.querySelectorAll("input.inspector-mixed-cb[type=\"checkbox\"]")) {
        if (el instanceof HTMLInputElement) {
            el.indeterminate = true;
        }
    }
}

/** Parses #rgb / #rrggbb / #rrggbbaa into #rrggbb for &lt;input type="color"&gt;; null if unrecognized. */
function tryParseCssHex(text) {
    const t = String(text ?? "").trim();
    if (!t) return null;
    const hex = t.startsWith("#") ? t.slice(1) : t;
    if (/^[0-9a-fA-F]{8}$/.test(hex)) {
        return `#${hex.slice(0, 6).toLowerCase()}`;
    }
    if (/^[0-9a-fA-F]{6}$/.test(hex)) {
        return `#${hex.toLowerCase()}`;
    }
    if (/^[0-9a-fA-F]{3}$/.test(hex)) {
        const [a, b, c] = hex.split("");
        return `#${a}${a}${b}${b}${c}${c}`.toLowerCase();
    }
    return null;
}

const INSPECTOR_COLOR_PICKER_FALLBACK = "#5a6570";

function fieldNum(name, label, value, min, max) {
    const minAttr = min !== undefined ? ` min="${min}"` : "";
    const maxAttr = max !== undefined ? ` max="${max}"` : "";
    const commitAttr =
        name === "disp_width" || name === "disp_height" || name === "disp_dpi"
            ? ` data-inspector-commit="blur"`
            : "";
    return `<div class="field"><label>${esc(label)}</label><input type="number" name="${esc(name)}" value="${Number(value)}" step="1"${minAttr}${maxAttr}${commitAttr} /></div>`;
}

function fieldText(name, label, value) {
    return `<div class="field"><label>${esc(label)}</label><input type="text" name="${esc(name)}" value="${esc(value ?? "")}" /></div>`;
}

function fieldColor(name, label, value) {
    const pickerVal = tryParseCssHex(value) ?? INSPECTOR_COLOR_PICKER_FALLBACK;
    const safeBg = esc(pickerVal);
    return `<div class="field"><label>${esc(label)}</label><div class="inspector-color-row">
<input type="text" name="${esc(name)}" value="${esc(value ?? "")}" autocomplete="off" spellcheck="false" placeholder="#hex" />
<div class="inspector-color-swatch-wrap" title="Pick color">
<span class="inspector-color-face" style="background-color:${safeBg}" aria-hidden="true"></span>
<input type="color" class="inspector-color-picker-native" value="${safeBg}" title="Pick color" aria-label="Pick ${esc(label)}" />
</div>
</div></div>`;
}

function fieldCheck(name, label, checked) {
    const c = checked ? " checked" : "";
    return `<div class="field check-row"><label><input type="checkbox" name="${esc(name)}"${c} /> ${esc(label)}</label></div>`;
}

function fieldTextarea(name, label, value) {
    return `<div class="field"><label>${esc(label)}</label><textarea name="${esc(name)}">${esc(value ?? "")}</textarea></div>`;
}

function fieldNumFloat(name, label, value, step = "any") {
    const v = value !== undefined && value !== null ? Number(value) : 0;
    const shown = Number.isFinite(v) ? String(v) : "0";
    return `<div class="field"><label>${esc(label)}</label><input type="number" name="${esc(name)}" value="${shown}" step="${step}" /></div>`;
}

function fieldFloat(name, label, value) {
    return fieldNumFloat(name, label, value, "any");
}

function stylePaddingToLabel(padding) {
    if (padding === undefined || padding === null) return "";
    if (typeof padding === "number") return String(padding);
    if (Array.isArray(padding)) return padding.join(", ");
    return "";
}

/** @param {{value: string, label: string}[]} options */
function fieldSelect(name, label, options, current) {
    const cur = current ?? "";
    const opts = options
        .map(
            o =>
                `<option value="${esc(o.value)}"${o.value === cur ? " selected" : ""}>${esc(o.label)}</option>`
        )
        .join("");
    return `<div class="field"><label>${esc(label)}</label><select name="${esc(name)}">${opts}</select></div>`;
}

const INSPECT_MIX_SEL = "__insp_mixed__";

function mixNum(name, label, v) {
    if (isInspMixed(v)) {
        return (
            `<div class="field" data-inspector-mixed="1"><label>${esc(label)}</label>` +
            `<input type="number" name="${esc(name)}" value="" placeholder="(mixed)" step="1" /></div>`
        );
    }
    return fieldNum(name, label, Number(v));
}

function mixFloat(name, label, v) {
    if (isInspMixed(v)) {
        return (
            `<div class="field" data-inspector-mixed="1"><label>${esc(label)}</label>` +
            `<input type="number" name="${esc(name)}" value="" placeholder="(mixed)" step="any" /></div>`
        );
    }
    return fieldFloat(name, label, v);
}

function mixText(name, label, val) {
    if (isInspMixed(val)) {
        return (
            `<div class="field" data-inspector-mixed="1"><label>${esc(label)}</label>` +
            `<input type="text" name="${esc(name)}" value="" placeholder="(mixed)" /></div>`
        );
    }
    return fieldText(name, label, val ?? "");
}

function mixWidgetText(name, label, val) {
    if (isInspMixed(val)) {
        return (
            `<div class="field widget-text-field" data-inspector-mixed="1"><label>${esc(label)}</label>` +
            `<select name="${esc(name)}Mode" disabled><option>(mixed)</option></select>` +
            `<input type="text" name="${esc(name)}" value="" placeholder="(mixed)" disabled /></div>`
        );
    }
    return widgetTextFieldHtml(name, label, val);
}

function widgetTextFieldHtml(name, label, val) {
    const mode = widgetTextMode(val);
    const literal = widgetTextLiteral(val);
    const refKey = widgetTextRefKey(val);
    const keys = stringResourceKeys.length ? stringResourceKeys : refKey ? [refKey] : [];
    const keyOptions =
        `<option value="">— select key —</option>` +
        keys
            .map(k => `<option value="${esc(k)}"${k === refKey ? " selected" : ""}>${esc(k)}</option>`)
            .join("") +
        (refKey && !keys.includes(refKey)
            ? `<option value="${esc(refKey)}" selected>${esc(refKey)} (missing)</option>`
            : "");
    const missingHint =
        mode === "resource" && refKey && currentStringsRes && !keys.includes(refKey)
            ? `<p class="inspector-field-hint" style="color:var(--vscode-errorForeground);margin:4px 0 0;">Key "${esc(refKey)}" is not defined in strings.res</p>`
            : "";
    return (
        `<div class="field widget-text-field"><label>${esc(label)}</label>` +
        `<div class="row2">` +
        `<select name="${esc(name)}Mode">` +
        `<option value="literal"${mode === "literal" ? " selected" : ""}>Literal</option>` +
        `<option value="resource"${mode === "resource" ? " selected" : ""}>String resource</option>` +
        `</select>` +
        `<select name="${esc(name)}Ref"${mode === "resource" ? "" : " hidden"}>${keyOptions}</select>` +
        `</div>` +
        `<input type="text" name="${esc(name)}" value="${esc(literal)}"${mode === "literal" ? "" : " hidden"} placeholder="Text" />` +
        missingHint +
        `</div>`
    );
}

function readWidgetTextPatch(fieldName) {
    if (!inspectorForm) {
        return undefined;
    }
    const modeEl = inspectorForm.elements.namedItem(`${fieldName}Mode`);
    if (modeEl instanceof HTMLSelectElement && modeEl.closest("[data-inspector-mixed]")) {
        return undefined;
    }
    if (modeEl instanceof HTMLSelectElement && modeEl.value === "resource") {
        const refEl = inspectorForm.elements.namedItem(`${fieldName}Ref`);
        const key =
            refEl instanceof HTMLSelectElement
                ? refEl.value.trim()
                : refEl instanceof HTMLInputElement
                  ? refEl.value.trim()
                  : "";
        if (!key) {
            return null;
        }
        return { ref: key };
    }
    const textEl = inspectorForm.elements.namedItem(fieldName);
    if (textEl instanceof HTMLInputElement && textEl.closest("[data-inspector-mixed]") && textEl.value.trim() === "") {
        return undefined;
    }
    if (textEl instanceof HTMLInputElement) {
        return textEl.value;
    }
    return undefined;
}

function mixTextarea(name, label, val) {
    if (isInspMixed(val)) {
        return (
            `<div class="field" data-inspector-mixed="1"><label>${esc(label)}</label>` +
            `<textarea name="${esc(name)}" placeholder="(mixed)"></textarea></div>`
        );
    }
    return fieldTextarea(name, label, typeof val === "string" ? val : "");
}

function mixSelect(name, label, options, current) {
    if (isInspMixed(current)) {
        const opts =
            `<option value="${esc(INSPECT_MIX_SEL)}" selected>(mixed)</option>` +
            options
                .map(
                    o =>
                        `<option value="${esc(o.value)}">${esc(o.label)}</option>`
                )
                .join("");
        return `<div class="field" data-inspector-mixed="1"><label>${esc(label)}</label><select name="${esc(name)}">${opts}</select></div>`;
    }
    return fieldSelect(name, label, options, current);
}

function mixCheck(name, label, v) {
    if (isInspMixed(v)) {
        return (
            `<div class="field check-row" data-inspector-mixed="1"><label>` +
            `<input type="checkbox" name="${esc(name)}" class="inspector-mixed-cb" /> ${esc(label)}` +
            `</label></div>`
        );
    }
    return fieldCheck(name, label, !!v);
}

function mixColor(name, label, value) {
    if (isInspMixed(value)) {
        const fb = INSPECTOR_COLOR_PICKER_FALLBACK;
        return `<div class="field" data-inspector-mixed="1"><label>${esc(label)}</label><div class="inspector-color-row">
<input type="text" name="${esc(name)}" value="" autocomplete="off" spellcheck="false" placeholder="(mixed)" />
<div class="inspector-color-swatch-wrap" title="Pick color">
<span class="inspector-color-face" style="background-color:${esc(fb)}" aria-hidden="true"></span>
<input type="color" class="inspector-color-picker-native" value="${esc(fb)}" title="Pick color" aria-label="Pick ${esc(label)}" />
</div>
</div></div>`;
    }
    return fieldColor(name, label, typeof value === "string" ? value : "");
}

function mixNumOpt(name, label, value) {
    if (isInspMixed(value)) {
        return (
            `<div class="field" data-inspector-mixed="1"><label>${esc(label)}</label>` +
            `<input type="number" name="${esc(name)}" value="" placeholder="(mixed)" step="1" /></div>`
        );
    }
    return fieldNumOpt(name, label, value);
}

function mixNumFloatOpt(name, label, value, step = "any") {
    if (isInspMixed(value)) {
        return (
            `<div class="field" data-inspector-mixed="1"><label>${esc(label)}</label>` +
            `<input type="number" name="${esc(name)}" value="" placeholder="(mixed)" step="${esc(step)}" /></div>`
        );
    }
    return fieldNumFloatOpt(name, label, value, step);
}

function mixPaddingRow(paddingVal) {
    const padHint = "(number or top,left or top,right,bottom,left)";
    if (isInspMixed(paddingVal)) {
        return (
            `<div class="field" data-inspector-mixed="1"><label>Padding ${esc(padHint)}</label>` +
            `<input type="text" name="style_padding" value="" placeholder="(mixed)"></div>`
        );
    }
    return (
        `<div class="field"><label>Padding ${esc(padHint)}</label>` +
        `<input type="text" name="style_padding" value="${esc(stylePaddingToLabel(paddingVal))}" placeholder="e.g. 8 or 8, 16"></div>`
    );
}

function inspectorLayoutFieldsHtml(layoutM) {
    return (
        `<div class="inspector-group-title">Layout</div>` +
        `<div class="row2">${mixNum("x", "X", layoutM.x)}${mixNum("y", "Y", layoutM.y)}</div>` +
        `<div class="row2">${mixNum("width", "Width", layoutM.width)}${mixNum("height", "Height", layoutM.height)}</div>` +
        `${mixCheck("hidden", "Hidden", layoutM.hidden)}` +
        `<div class="row2">${mixCheck("scrollX", "Scroll X", layoutM.scrollX)}${mixCheck("scrollY", "Scroll Y", layoutM.scrollY)}</div>`
    );
}

/**
 * Shared type-specific inspector fields (`m` may be one component object or consensus model).
 * @param {string} type
 * @param {Record<string, unknown>} m
 */
function widgetTypeSpecificFieldsHtml(type, m) {
    let html = "";
    switch (type) {
        case "label":
            html += mixWidgetText("text", "Text", /** @type {unknown} */ (m.text));
            html += mixSelect("longMode", "Long mode", [
                { value: "", label: "(default)" },
                { value: "wrap", label: "wrap" },
                { value: "dot", label: "dot" },
                { value: "scroll", label: "scroll" },
                { value: "clip", label: "clip" }
            ], /** @type {unknown} */ (m.longMode) ?? "");
            break;
        case "button":
            html += mixWidgetText("label", "Label text", /** @type {unknown} */ (m.label));
            break;
        case "image":
            html += mixText("src", "Asset id", /** @type {unknown} */ (m.src));
            break;
        case "slider":
            html +=
                `<div class="row2">${mixFloat("min", "Min", /** @type {unknown} */ (m.min))}${mixFloat(
                    "max",
                    "Max",
                    /** @type {unknown} */ (m.max)
                )}</div>`;
            html += mixFloat("value", "Value", /** @type {unknown} */ (m.value));
            break;
        case "bar":
            html +=
                `<div class="row2">${mixFloat("min", "Min", /** @type {unknown} */ (m.min))}${mixFloat(
                    "max",
                    "Max",
                    /** @type {unknown} */ (m.max)
                )}</div>`;
            html += mixFloat("value", "Value", /** @type {unknown} */ (m.value));
            html += mixSelect("bar_mode", "Mode", [
                { value: "", label: "(default)" },
                { value: "normal", label: "normal" },
                { value: "symmetrical", label: "symmetrical" },
                { value: "range", label: "range" }
            ], /** @type {unknown} */ (m.mode) ?? "");
            break;
        case "arc":
            html +=
                `<div class="row2">${mixFloat("min", "Min", /** @type {unknown} */ (m.min))}${mixFloat(
                    "max",
                    "Max",
                    /** @type {unknown} */ (m.max)
                )}</div>`;
            html += mixFloat("value", "Value", /** @type {unknown} */ (m.value));
            html +=
                `<div class="row2">${mixFloat(
                    "startAngle",
                    "Start °",
                    /** @type {unknown} */ (m.startAngle)
                )}${mixFloat("endAngle", "End °", /** @type {unknown} */ (m.endAngle))}</div>`;
            html += mixSelect("arc_mode", "Mode", [
                { value: "", label: "(default)" },
                { value: "normal", label: "normal" },
                { value: "reverse", label: "reverse" },
                { value: "symmetrical", label: "symmetrical" }
            ], /** @type {unknown} */ (m.mode) ?? "");
            break;
        case "knob":
            html +=
                `<div class="row2">${mixFloat("min", "Min", /** @type {unknown} */ (m.min))}${mixFloat(
                    "max",
                    "Max",
                    /** @type {unknown} */ (m.max)
                )}</div>`;
            html += mixFloat("value", "Value", /** @type {unknown} */ (m.value));
            html +=
                `<div class="row2">${mixFloat(
                    "startAngle",
                    "Start °",
                    /** @type {unknown} */ (m.startAngle)
                )}${mixFloat("endAngle", "End °", /** @type {unknown} */ (m.endAngle))}</div>`;
            html += mixText("indicatorColor", "Indicator color (#hex)", /** @type {unknown} */ (m.indicatorColor));
            break;
        case "switch":
            html += mixCheck("checked", "Checked", /** @type {unknown} */ (m.checked));
            break;
        case "checkbox":
            html += mixWidgetText("text", "Label text", /** @type {unknown} */ (m.text));
            html += mixCheck("checked", "Checked", /** @type {unknown} */ (m.checked));
            break;
        case "dropdown":
            html += mixTextarea(
                "options",
                "Options (one per line)",
                isInspMixed(/** @type {unknown} */ (m.options))
                    ? INSP_MIXED
                    : (/** @type {unknown[]} */ (m.options ?? [])).join("\n")
            );
            html += mixNum("selectedIndex", "Selected index", /** @type {unknown} */ (m.selectedIndex) ?? 0);
            break;
        case "roller":
            // LVGL symbol glyphs live in the private-use area (e.g. \uF013). Most editor fonts
            // don't render them, so show readable tokens in the inspector while still storing
            // the real LVGL symbols in the `.embf`.
            html += mixTextarea(
                "options",
                "Options (one per line)",
                isInspMixed(/** @type {unknown} */ (m.options))
                    ? INSP_MIXED
                    : (/** @type {unknown[]} */ (m.options ?? []))
                        .map(v => displayRollerOptionLine(String(v ?? "")))
                        .join("\n")
            );
            html += mixNum("selectedIndex", "Selected index", /** @type {unknown} */ (m.selectedIndex) ?? 0);
            html += mixSelect("roller_mode", "Mode", [
                { value: "", label: "(default)" },
                { value: "normal", label: "normal" },
                { value: "infinite", label: "infinite" }
            ], /** @type {unknown} */ (m.mode) ?? "");
            break;
        case "textarea":
            html += mixTextarea("textareaText", "Text", /** @type {unknown} */ (m.text ?? ""));
            html += mixText("placeholder", "Placeholder", /** @type {unknown} */ (m.placeholder ?? ""));
            html += mixCheck("oneLine", "Single line", /** @type {unknown} */ (m.oneLine));
            break;
        case "spinner":
            html += mixNumFloatOpt(
                "speed",
                "Speed (ms)",
                /** @type {unknown} */ (m.speed ?? 1000),
                "1"
            );
            html += mixNumFloatOpt(
                "arcLength",
                "Arc length (°)",
                /** @type {unknown} */ (m.arcLength ?? 60),
                "1"
            );
            break;
        case "line":
            html += mixTextarea("linePoints", "Points (x,y per line)", /** @type {unknown} */ (m.linePointsText));
            html += mixCheck("rounded", "Rounded corners", /** @type {unknown} */ (m.rounded));
            break;
        case "container": {
            const rawLayout = /** @type {unknown} */ (/** @type {Record<string, unknown>} */ (m).layout);
            const layoutSel = isInspMixed(rawLayout)
                ? INSPECT_MIXED
                : typeof rawLayout === "string" && /^(none|flex|grid)$/.test(rawLayout)
                  ? rawLayout
                  : "none";
            html += mixSelect(
                "layout",
                "Layout",
                [
                    { value: "none", label: "none" },
                    { value: "flex", label: "flex" },
                    { value: "grid", label: "grid" }
                ],
                layoutSel
            );
            html += mixSelect("flexFlow", "Flex flow (flex)", [
                { value: "", label: "(default)" },
                { value: "row", label: "row" },
                { value: "column", label: "column" },
                { value: "row_wrap", label: "row_wrap" },
                { value: "column_wrap", label: "column_wrap" }
            ], /** @type {unknown} */ (m.flexFlow) ?? "");
            html += `<div class="field"><p style="font-size:11px;color:#888;line-height:1.35;margin:0;">Nested widgets: edit JSON or attach from tooling; not listed here.</p></div>`;
            break;
        }
        case "panel":
            html += `<div class="field"><p style="font-size:11px;color:#888;line-height:1.35;margin:0;">Panel holds child widgets. Edit children in the .embf file.</p></div>`;
            break;
        default:
            break;
    }
    return html;
}

/**
 * Appearance + Events block (solo `styles`/`events`, or homogeneous multi consensus models).
 * @param {Record<string, unknown>} sm styles field bag (possibly INSP_MIXED per key)
 * @param {unknown} eventsVal events array or INSP_MIXED
 */
function inspectorAppearancesFromModels(sm, eventsVal) {
    const alignForSelect = isInspMixed(sm.align)
        ? INSP_MIXED
        : String(typeof sm.align === "string" ? sm.align : "");
    let html =
        `<div class="inspector-group-title">Appearance</div>` +
        mixColor("style_bgColor", "Bg color (#hex)", sm.bgColor ?? "") +
        mixColor("style_indicatorColor", "Indicator color", sm.indicatorColor ?? "") +
        mixNumFloatOpt(
            "style_bgOpacity",
            "Bg opacity (0–255)",
            /** @type {unknown} */ (sm.bgOpacity),
            "1"
        ) +
        mixColor("style_textColor", "Text color", sm.textColor ?? "") +
        mixColor("style_borderColor", "Border color", sm.borderColor ?? "") +
        `<div class="row2">${mixNumOpt("style_borderWidth", "Border width", /** @type {unknown} */ (sm.borderWidth))}${mixNumOpt("style_borderRadius", "Corner radius", /** @type {unknown} */ (sm.borderRadius))}</div>` +
        `${mixPaddingRow(/** @type {unknown} */ (sm.padding))}` +
        mixNumOpt("style_fontSize", "Font size (px)", /** @type {unknown} */ (sm.fontSize)) +
        mixText("style_fontFamily", "Font family", /** @type {unknown} */ (sm.fontFamily ?? "")) +
        mixSelect(
            "style_align",
            "Text align",
            [
                { value: "", label: "(default)" },
                { value: "left", label: "Left" },
                { value: "center", label: "Center" },
                { value: "right", label: "Right" }
            ],
            alignForSelect
        );

    html += `<div class="inspector-group-title">Events (JSON)</div>`;
    if (isInspMixed(eventsVal)) {
        html +=
            `<div class="field" data-inspector-mixed="1"><label title='JSON array: [{ "trigger", "actions" }]'>Handlers</label>` +
            `<textarea id="inspector-events-json" name="eventsJson" rows="5" spellcheck="false" placeholder="(mixed)"></textarea></div>`;
    } else {
        const evPretty = JSON.stringify(eventsVal ?? [], null, 2);
        html += `<div class="field"><label title='JSON array: [{ "trigger", "actions" }]'>Handlers</label><textarea id="inspector-events-json" name="eventsJson" rows="5" spellcheck="false">${esc(evPretty)}</textarea></div>`;
    }
    return html;
}

function typeModelFromComp(comp) {
    const m = /** @type {Record<string, unknown>} */ ({ ...(comp ?? {}) });
    if (comp && comp.type === "line") {
        m.linePointsText = (comp.points ?? [])
            .map(p => `${p.x}, ${p.y}`)
            .join("\n");
    }
    return m;
}

function inspectorAppearancesSection(comp) {
    return inspectorAppearancesFromModels(comp.styles ?? {}, comp.events ?? []);
}

// ── Bindings / named styles / animations (per-widget) ────────────────────────

const NUMERIC_BINDING_WIDGETS = new Set(["slider", "bar", "arc", "knob"]);

/**
 * "Named styles", "Bindings", and "Animations" inspector sections.
 * Each renders only when the project has the relevant declarations (project.styles[],
 * model.properties / dataModel.fields) — otherwise hidden.
 */
function inspectorBindingsAndStylesSection(comp) {
    let html = "";

    const styles = currentProject?.styles ?? [];
    if (styles.length > 0) {
        const refs = Array.isArray(comp.styleRefs) ? comp.styleRefs : [];
        html +=
            `<div class="inspector-group-title">Named styles</div>` +
            `<div class="field"><div class="styleref-list" data-styleref-host="1">` +
            styles
                .map(
                    s =>
                        `<label class="styleref-row"><input type="checkbox" data-styleref="${esc(s.id)}" ${
                            refs.includes(s.id) ? "checked" : ""
                        }/> <span class="styleref-name">${esc(s.name || s.id)}</span><span class="styleref-id">${esc(s.id)}</span></label>`
                )
                .join("") +
            `</div></div>`;
    }

    if (NUMERIC_BINDING_WIDGETS.has(comp.type)) {
        const fields = getPreviewProperties().filter(
            f => f && (f.type === "int" || f.type === "float")
        );
        if (fields.length > 0) {
            const current = comp.bindings?.value ?? "";
            html +=
                `<div class="inspector-group-title">Binding (preview fields)</div>` +
                `<div class="field"><label>Value bound to</label>` +
                `<select name="binding_value" data-binding-prop="value">` +
                `<option value="">(none)</option>` +
                fields
                    .map(
                        f =>
                            `<option value="${esc(f.id)}" ${
                                f.id === current ? "selected" : ""
                            }>${esc(f.id)} (${esc(f.type)})</option>`
                    )
                    .join("") +
                `</select></div>`;
        }
    }

    html += inspectorCBindingsSection(comp);

    const anims = Array.isArray(comp.animations) ? comp.animations : [];
    html +=
        `<div class="inspector-group-title">Animations` +
        ` <button type="button" class="tb-btn-small" data-anim-add="1" title="Add animation">+</button></div>` +
        `<div class="field" data-anim-host="1">` +
        (anims.length === 0
            ? `<p style="font-size:11px;color:#888;margin:0 0 4px;">No animations.</p>`
            : anims.map((a, i) => animationRowHtml(a, i)).join("")) +
        `</div>`;

    return html;
}

const ANIM_PROPS = ["x", "y", "width", "height", "opacity"];
const ANIM_EASINGS = ["linear", "ease_in", "ease_out", "ease_in_out", "overshoot", "bounce", "step"];

/**
 * Wire add/remove buttons + checkbox/select changes for the new bindings + styles + anim
 * inspector blocks. Commits via the normal debounced inspector flow.
 */
function wireBindingsInspectorActions(comp) {
    if (!inspectorForm) return;

    inspectorForm.querySelectorAll("[data-c-bind-pick]").forEach(btn => {
        if (btn.dataset.wired) return;
        btn.dataset.wired = "1";
        btn.addEventListener("click", e => {
            e.preventDefault();
            const prop = /** @type {HTMLElement} */ (btn).dataset.cBindPick;
            if (prop && selectedComponentOrder.length === 1) {
                openSymbolBindPicker(selectedComponentOrder[0], prop);
            }
        });
    });
    inspectorForm.querySelectorAll("[data-c-bind-clear]").forEach(btn => {
        if (btn.dataset.wired) return;
        btn.dataset.wired = "1";
        btn.addEventListener("click", e => {
            e.preventDefault();
            const prop = /** @type {HTMLElement} */ (btn).dataset.cBindClear;
            if (prop && selectedComponentOrder.length === 1) {
                clearDataBinding(selectedComponentOrder[0], prop);
            }
        });
    });

    const animHost = inspectorForm.querySelector(`[data-anim-host="1"]`);
    const animAddBtn = inspectorForm.querySelector(`[data-anim-add="1"]`);
    if (animAddBtn && !animAddBtn.dataset.wired) {
        animAddBtn.dataset.wired = "1";
        animAddBtn.addEventListener("click", () => {
            const existing = Array.isArray(comp.animations) ? comp.animations.slice() : [];
            existing.push({ property: "x", from: 0, to: 100, duration: 400, easing: "ease_out" });
            if (selectedComponentOrder.length === 1) {
                vscode.postMessage({
                    type: "updateWidget",
                    pageIndex: currentPageIndex,
                    componentId: selectedComponentOrder[0],
                    patch: { animations: existing }
                });
            }
        });
    }
    if (animHost) {
        animHost.querySelectorAll(`[data-anim-remove]`).forEach(btn => {
            if (btn.dataset.wired) return;
            btn.dataset.wired = "1";
            btn.addEventListener("click", () => {
                const idx = Number(/** @type {HTMLElement} */ (btn).dataset.animRemove);
                if (!Number.isInteger(idx)) return;
                const existing = Array.isArray(comp.animations) ? comp.animations.slice() : [];
                existing.splice(idx, 1);
                if (selectedComponentOrder.length === 1) {
                    vscode.postMessage({
                        type: "updateWidget",
                        pageIndex: currentPageIndex,
                        componentId: selectedComponentOrder[0],
                        patch: { animations: existing }
                    });
                }
            });
        });
    }
}

function animationRowHtml(a, i) {
    const sel = (cur, options) =>
        options
            .map(v => `<option value="${esc(v)}" ${v === cur ? "selected" : ""}>${esc(v)}</option>`)
            .join("");
    return (
        `<div class="anim-row" data-anim-idx="${i}">` +
        `<div class="row2"><div class="field"><label>Property</label>` +
        `<select data-anim-field="property">${sel(a.property ?? "x", ANIM_PROPS)}</select></div>` +
        `<div class="field"><label>Easing</label>` +
        `<select data-anim-field="easing">${sel(a.easing ?? "linear", ANIM_EASINGS)}</select></div></div>` +
        `<div class="row2"><div class="field"><label>From</label>` +
        `<input type="number" data-anim-field="from" value="${esc(a.from ?? 0)}" step="any" /></div>` +
        `<div class="field"><label>To</label>` +
        `<input type="number" data-anim-field="to" value="${esc(a.to ?? 0)}" step="any" /></div></div>` +
        `<div class="row2"><div class="field"><label>Duration (ms)</label>` +
        `<input type="number" data-anim-field="duration" value="${esc(a.duration ?? 500)}" step="1" min="0" /></div>` +
        `<div class="field"><label>Delay (ms)</label>` +
        `<input type="number" data-anim-field="delay" value="${esc(a.delay ?? "")}" step="1" min="0" /></div></div>` +
        `<div class="row2"><div class="field"><label>Repeat (-1 ∞)</label>` +
        `<input type="number" data-anim-field="repeat" value="${esc(a.repeat ?? "")}" step="1" /></div>` +
        `<div class="field"><label>Playback</label>` +
        `<input type="checkbox" data-anim-field="playback" ${a.playback ? "checked" : ""} /></div></div>` +
        `<button type="button" class="tb-btn-small" data-anim-remove="${i}">Remove</button>` +
        `</div>`
    );
}

function fieldNumOpt(name, label, value) {
    let shown = "";
    if (value !== undefined && value !== null && value !== "") {
        const n = Math.round(Number(value));
        shown = Number.isFinite(n) ? String(n) : "";
    }
    return `<div class="field"><label>${esc(label)}</label><input type="number" name="${esc(name)}" value="${esc(shown)}" step="1" /></div>`;
}

function fieldNumFloatOpt(name, label, value, step = "any") {
    let shown = "";
    if (value !== undefined && value !== null && value !== "") {
        const n = Number(value);
        shown = Number.isFinite(n) ? String(n) : "";
    }
    return `<div class="field"><label>${esc(label)}</label><input type="number" name="${esc(name)}" value="${esc(shown)}" step="${step}" /></div>`;
}
/**
 * Keeps caret/cursor alive when redraw replaces innerHTML (e.g. after preview reload).
 * @typedef {{
 *   tag: string,
 *   name: string,
 *   inputType: string | null,
 *   selStart: number | null,
 *   selEnd: number | null,
 *   scrollTop: number | null,
 *   scrollLeft: number | null
 * }} InspectorFocusSnap
 */

/** True when focus is in an editable inspector control (typing in Properties). */
function isInspectorFieldFocused() {
    const ae = document.activeElement;
    return (
        !!inspectorForm &&
        ae instanceof HTMLElement &&
        inspectorForm.contains(ae) &&
        (ae instanceof HTMLInputElement ||
            ae instanceof HTMLTextAreaElement ||
            ae instanceof HTMLSelectElement)
    );
}

/** @returns {InspectorFocusSnap | null} */
function snapshotInspectorFocus() {
    if (!inspectorForm) {
        return null;
    }
    const ae = document.activeElement;
    if (!(ae instanceof HTMLElement) || !inspectorForm.contains(ae)) {
        return null;
    }
    if (
        ae instanceof HTMLInputElement ||
        ae instanceof HTMLTextAreaElement ||
        ae instanceof HTMLSelectElement
    ) {
        const name = ae.getAttribute("name");
        if (!name) {
            return null;
        }
        const tag = ae.tagName.toLowerCase();
        /** @type {string | null} */
        let inputType = ae instanceof HTMLInputElement ? ae.type : null;
        /** @type {number | null} */
        let selStart = null;
        /** @type {number | null} */
        let selEnd = null;
        if (
            "selectionStart" in ae &&
            typeof ae.selectionStart === "number" &&
            typeof ae.selectionEnd === "number"
        ) {
            selStart = ae.selectionStart;
            selEnd = ae.selectionEnd;
        }
        /** @type {number | null} */
        let scrollTop = null;
        /** @type {number | null} */
        let scrollLeft = null;
        if (ae instanceof HTMLTextAreaElement) {
            scrollTop = ae.scrollTop;
            scrollLeft = ae.scrollLeft;
        }
        return { tag, name, inputType, selStart, selEnd, scrollTop, scrollLeft };
    }
    return null;
}

/** @param {InspectorFocusSnap | null} snap */
function restoreInspectorFocus(snap) {
    if (!snap?.name || !inspectorForm) {
        return;
    }
    const item = inspectorForm.elements.namedItem(snap.name);
    if (!item || item instanceof RadioNodeList) {
        return;
    }
    if (!(item instanceof HTMLElement)) {
        return;
    }
    if (item.tagName.toLowerCase() !== snap.tag) {
        return;
    }
    if (
        snap.inputType !== null &&
        item instanceof HTMLInputElement &&
        item.type !== snap.inputType
    ) {
        return;
    }

    item.focus();

    if (
        (item instanceof HTMLInputElement || item instanceof HTMLTextAreaElement) &&
        snap.selStart != null &&
        snap.selEnd != null &&
        typeof item.setSelectionRange === "function"
    ) {
        try {
            const len = ("value" in item ? item.value : "").length;
            const a = Math.max(0, Math.min(snap.selStart, len));
            const b = Math.max(0, Math.min(snap.selEnd, len));
            item.setSelectionRange(a, b);
        } catch {
            /* e.g. some number/date inputs disallow selection APIs */
        }
    }

    if (item instanceof HTMLTextAreaElement && snap.scrollTop != null && snap.scrollLeft != null) {
        const top = snap.scrollTop;
        const left = snap.scrollLeft;
        queueMicrotask(() => {
            item.scrollTop = top;
            item.scrollLeft = left;
        });
    }
}

function renderInspector() {
    if (!inspectorEmpty || !inspectorForm || !inspectorDelete) {
        return;
    }
    if (!designMode || !currentProject) {
        inspectorEmpty.hidden = false;
        inspectorForm.hidden = true;
        inspectorForm.innerHTML = "";
        inspectorDelete.disabled = true;
        return;
    }
    const page = currentProject.pages[currentPageIndex];

    if (inspectorShowingPage && page) {
        inspectorEmpty.hidden = true;
        inspectorForm.hidden = false;
        inspectorDelete.disabled = true;

        const inspectorFocusSnap = snapshotInspectorFocus();
        inspectorSyncing = true;
        inspectorForm.innerHTML = renderPageInspectorHtml(page, currentProject);
        inspectorSyncing = false;

        wirePageInspectorActions();

        if (inspectorFocusSnap) {
            requestAnimationFrame(() => {
                queueMicrotask(() => restoreInspectorFocus(inspectorFocusSnap));
            });
        }
        return;
    }

    if (selectedComponentOrder.length >= 2 && page) {
        inspectorEmpty.hidden = true;
        inspectorForm.hidden = false;
        inspectorDelete.disabled = false;

        const ids = [...selectedComponentOrder];
        const comps = ids.map(id => findComponentById(page.components, id)).filter(Boolean);
        const homogeneous =
            comps.length === ids.length &&
            comps.length >= 2 &&
            comps.every(c => c.type === comps[0].type);

        const inspectorFocusSnap = snapshotInspectorFocus();
        inspectorSyncing = true;
        inspectorForm.innerHTML =
            groupEditBannerHtml() +
            (homogeneous
                ? renderHomogeneousMultiInspectorHtml(ids, comps)
                : renderMultiInspectorHtml(ids));
        inspectorSyncing = false;
        refreshMixedCheckboxes(inspectorForm);
        wireWidgetTextModeToggles();

        if (inspectorFocusSnap) {
            requestAnimationFrame(() => {
                queueMicrotask(() => restoreInspectorFocus(inspectorFocusSnap));
            });
        }
        return;
    }

    const soloId = selectedComponentOrder.length === 1 ? selectedComponentOrder[0] : null;
    const comp =
        soloId && page ? findComponentById(page.components, soloId) : null;
    if (!soloId || !comp) {
        inspectorEmpty.hidden = false;
        inspectorForm.hidden = true;
        inspectorForm.innerHTML = "";
        inspectorDelete.disabled = true;
        return;
    }

    inspectorEmpty.hidden = true;
    inspectorForm.hidden = false;
    inspectorDelete.disabled = false;

    const inspectorFocusSnap = snapshotInspectorFocus();

    inspectorSyncing = true;
    let html = groupEditBannerHtml();
    html += `<div id="inspector-readonly"><strong>${esc(comp.id)}</strong> · ${esc(comp.type)}</div>`;
    html += inspectorLayoutFieldsHtml({
        x: comp.x,
        y: comp.y,
        width: comp.width,
        height: comp.height,
        hidden: !!comp.hidden,
        scrollX: !!comp.scrollX,
        scrollY: !!comp.scrollY
    });
    html += zOrderInspectorHtml();
    {
        const ch = comp.children;
        if (
            (comp.type === "container" || comp.type === "panel") &&
            Array.isArray(ch) &&
            ch.length > 0
        ) {
            html +=
                `<div class="inspector-group-title">Group</div>` +
                `<div class="inspector-layout-grid">` +
                (!groupEditContainerId
                    ? layoutToolbarButton("edit-group-contents", "Edit contents")
                    : "") +
                layoutToolbarButton("ungroup-widget", "Ungroup") +
                layoutToolbarButton("save-group-to-library", "Save to library") +
                `</div>`;
        }
    }
    html += `<div class="inspector-group-title">${esc(comp.type)}</div>`;
    if (comp.type === "image") {
        html += imageSrcInspectorHtml(comp);
    } else {
        html += widgetTypeSpecificFieldsHtml(comp.type, typeModelFromComp(comp));
    }
    html += inspectorAppearancesSection(comp);
    html += inspectorBindingsAndStylesSection(comp);

    inspectorForm.innerHTML = html;
    inspectorSyncing = false;

    refreshMixedCheckboxes(inspectorForm);
    wireImageInspectorActions();
    wireBindingsInspectorActions(comp);
    wireWidgetTextModeToggles();

    if (inspectorFocusSnap) {
        requestAnimationFrame(() => {
            queueMicrotask(() => restoreInspectorFocus(inspectorFocusSnap));
        });
    }
}

function parsePaddingInput(raw) {
    const t = raw.trim();
    if (!t) return undefined;
    if (/^\d+$/.test(t)) {
        const n = parseInt(t, 10);
        return Number.isFinite(n) && n >= 0 ? n : undefined;
    }
    const parts = t
        .split(/[, ]+/)
        .map(s => s.trim())
        .filter(Boolean)
        .map(Number);
    if (
        parts.length >= 2 &&
        parts.length <= 4 &&
        parts.every(n => Number.isFinite(n) && Number.isInteger(n) && n >= 0)
    ) {
        return parts;
    }
    return undefined;
}

function buildStyleSnapshotFromInspector() {
    if (!inspectorForm) {
        return {};
    }
    /** @returns {HTMLInputElement | null} Hex fields use duplicate-prone ids; prefer querySelector. */
    const textInputNamed = id =>
        /** @type {HTMLInputElement | null} */ (
            inspectorForm.querySelector(`input[type="text"][name="${id}"]`)
        );

    /** @type {Record<string, unknown>} */
    const s = {};

    const snapSkip = el => {
        if (!(el instanceof HTMLElement)) return false;
        if (!el.closest("[data-inspector-mixed]")) return false;
        if (el instanceof HTMLSelectElement && el.value === INSPECT_MIX_SEL) return true;
        return "value" in el && typeof el.value === "string" && el.value.trim() === "";
    };

    const setStr = (id, key) => {
        const el = textInputNamed(id);
        if (!(el instanceof HTMLInputElement)) return;
        if (snapSkip(el)) return;
        const t = el.value.trim();
        s[key] = t === "" ? null : t;
    };

    setStr("style_bgColor", "bgColor");
    setStr("style_indicatorColor", "indicatorColor");
    setStr("style_textColor", "textColor");
    setStr("style_borderColor", "borderColor");
    setStr("style_fontFamily", "fontFamily");

    const sop = inspectorForm.elements.namedItem("style_bgOpacity");
    if (sop instanceof HTMLInputElement && !snapSkip(sop)) {
        if (sop.value.trim() === "") {
            s.bgOpacity = null;
        } else {
            const v = Number(sop.value);
            s.bgOpacity = Number.isFinite(v) ? Math.min(255, Math.max(0, Math.round(v))) : null;
        }
    }

    const sbw = inspectorForm.elements.namedItem("style_borderWidth");
    if (sbw instanceof HTMLInputElement && !snapSkip(sbw)) {
        if (sbw.value.trim() === "") {
            s.borderWidth = null;
        } else {
            const v = Number(sbw.value);
            s.borderWidth = Number.isFinite(v) ? Math.round(Math.max(0, v)) : null;
        }
    }

    const sbr = inspectorForm.elements.namedItem("style_borderRadius");
    if (sbr instanceof HTMLInputElement && !snapSkip(sbr)) {
        if (sbr.value.trim() === "") {
            s.borderRadius = null;
        } else {
            const v = Number(sbr.value);
            s.borderRadius = Number.isFinite(v) ? Math.round(Math.max(0, v)) : null;
        }
    }

    const sfz = inspectorForm.elements.namedItem("style_fontSize");
    if (sfz instanceof HTMLInputElement && !snapSkip(sfz)) {
        if (sfz.value.trim() === "") {
            s.fontSize = null;
        } else {
            const v = Number(sfz.value);
            const n = Number.isFinite(v) ? Math.round(v) : NaN;
            s.fontSize = n >= 4 ? n : null;
        }
    }

    const spd = inspectorForm.elements.namedItem("style_padding");
    if (spd instanceof HTMLInputElement && !snapSkip(spd)) {
        const raw = spd.value.trim();
        if (raw === "") {
            s.padding = null;
        } else {
            const p = parsePaddingInput(spd.value);
            if (p !== undefined) {
                s.padding = p;
            }
        }
    }

    const alignEl = inspectorForm.elements.namedItem("style_align");
    if (alignEl instanceof HTMLSelectElement && !snapSkip(alignEl)) {
        const t = alignEl.value.trim();
        s.align = t === "" ? null : t;
    }

    return s;
}

function readInspectorPatch() {
    if (!inspectorForm) {
        return {};
    }
    const page = currentProject?.pages?.[currentPageIndex];
    const selectedId = selectedComponentOrder.length === 1 ? selectedComponentOrder[0] : null;
    const selectedComp =
        selectedId && page ? findComponentById(page.components, selectedId) : null;
    const selectedType = selectedComp?.type ?? "";
    /** @type {Record<string, unknown>} */
    const patch = {};
    const num = name => {
        const el = inspectorForm.elements.namedItem(name);
        if (!(el instanceof HTMLInputElement) || el.type !== "number") return;
        if (el.closest("[data-inspector-mixed]") && el.value.trim() === "") return;
        const v = Number(el.value);
        if (Number.isFinite(v)) {
            patch[name] = v;
        }
    };
    const floatOrOmit = name => {
        const el = inspectorForm.elements.namedItem(name);
        if (!(el instanceof HTMLInputElement) || el.type !== "number") return;
        if (el.closest("[data-inspector-mixed]") && el.value.trim() === "") return;
        if (el.value.trim() === "") {
            return;
        }
        const v = Number(el.value);
        if (Number.isFinite(v)) {
            patch[name] = v;
        }
    };
    const chk = name => {
        const el = inspectorForm.elements.namedItem(name);
        if (!(el instanceof HTMLInputElement) || el.type !== "checkbox") return;
        if (el.indeterminate) return;
        patch[name] = el.checked;
    };

    num("x");
    num("y");
    num("width");
    num("height");
    chk("hidden");

    const layoutEl = inspectorForm.elements.namedItem("layout");
    if (layoutEl instanceof HTMLSelectElement && layoutEl.value !== INSPECT_MIX_SEL) {
        patch.layout = layoutEl.value;
    }

    const flexFlowEl = inspectorForm.elements.namedItem("flexFlow");
    if (flexFlowEl instanceof HTMLSelectElement && flexFlowEl.value !== INSPECT_MIX_SEL) {
        patch.flexFlow = flexFlowEl.value;
    }

    const longModeEl = inspectorForm.elements.namedItem("longMode");
    if (longModeEl instanceof HTMLSelectElement && longModeEl.value !== INSPECT_MIX_SEL) {
        patch.longMode = longModeEl.value;
    }

    const barModeEl = inspectorForm.elements.namedItem("bar_mode");
    if (
        barModeEl instanceof HTMLSelectElement &&
        barModeEl.value !== INSPECT_MIX_SEL &&
        barModeEl.value !== undefined
    ) {
        patch.mode = barModeEl.value;
    }

    const arcModeEl = inspectorForm.elements.namedItem("arc_mode");
    if (
        arcModeEl instanceof HTMLSelectElement &&
        arcModeEl.value !== INSPECT_MIX_SEL &&
        arcModeEl.value !== undefined
    ) {
        patch.mode = arcModeEl.value;
    }

    const rollerModeEl = inspectorForm.elements.namedItem("roller_mode");
    if (
        rollerModeEl instanceof HTMLSelectElement &&
        rollerModeEl.value !== INSPECT_MIX_SEL &&
        rollerModeEl.value !== undefined
    ) {
        patch.mode = rollerModeEl.value;
    }

    const optionsEl = inspectorForm.elements.namedItem("options");
    if (optionsEl instanceof HTMLTextAreaElement) {
        if (!(optionsEl.closest("[data-inspector-mixed]") && optionsEl.value.trim() === "")) {
            const rawLines = optionsEl.value
                .split("\n")
                .map(s => s.trim())
                .filter(Boolean);
            patch.options =
                selectedType === "roller"
                    ? rawLines.map(storeRollerOptionLine)
                    : rawLines;
        }
    }

    const linePtsEl = inspectorForm.elements.namedItem("linePoints");
    if (linePtsEl instanceof HTMLTextAreaElement) {
        if (!(linePtsEl.closest("[data-inspector-mixed]") && linePtsEl.value.trim() === "")) {
            const lines = linePtsEl.value.split(/[\r\n]+/).map(s => s.trim()).filter(Boolean);
            const pts = [];
            for (const ln of lines) {
                const m = ln.split(/[, ]+/).map(p => Number(p.trim()));
                if (m.length >= 2 && Number.isFinite(m[0]) && Number.isFinite(m[1])) {
                    pts.push({ x: Math.round(m[0]), y: Math.round(m[1]) });
                }
            }
            if (pts.length >= 2) {
                patch.points = pts;
            }
        }
    }

    chk("rounded");

    const taTextEl = inspectorForm.elements.namedItem("textareaText");
    if (taTextEl instanceof HTMLTextAreaElement) {
        if (!(taTextEl.closest("[data-inspector-mixed]") && taTextEl.value.trim() === "")) {
            patch.text = taTextEl.value;
        }
    } else if (selectedType === "label" || selectedType === "checkbox") {
        const wt = readWidgetTextPatch("text");
        if (wt !== undefined) {
            patch.text = wt;
        }
    } else {
        const textEl = inspectorForm.elements.namedItem("text");
        if (
            textEl instanceof HTMLInputElement &&
            !(textEl.closest("[data-inspector-mixed]") && textEl.value.trim() === "")
        ) {
            patch.text = textEl.value;
        }
    }

    chk("oneLine");

    const phEl = inspectorForm.elements.namedItem("placeholder");
    if (
        phEl instanceof HTMLInputElement &&
        !(phEl.closest("[data-inspector-mixed]") && phEl.value.trim() === "")
    ) {
        patch.placeholder = phEl.value;
    }

    if (selectedType === "button") {
        const wl = readWidgetTextPatch("label");
        if (wl !== undefined) {
            patch.label = wl;
        }
    } else {
        const labelEl = inspectorForm.elements.namedItem("label");
        if (
            labelEl instanceof HTMLInputElement &&
            !(labelEl.closest("[data-inspector-mixed]") && labelEl.value.trim() === "")
        ) {
            patch.label = labelEl.value;
        }
    }

    const srcEl = inspectorForm.elements.namedItem("src");
    if (
        srcEl instanceof HTMLInputElement &&
        !(srcEl.closest("[data-inspector-mixed]") && srcEl.value.trim() === "")
    ) {
        patch.src = srcEl.value;
    }

    floatOrOmit("min");
    floatOrOmit("max");
    floatOrOmit("value");
    floatOrOmit("startAngle");
    floatOrOmit("endAngle");

    floatOrOmit("speed");
    floatOrOmit("arcLength");

    const selIdx = inspectorForm.elements.namedItem("selectedIndex");
    if (!(selIdx instanceof HTMLInputElement) || selIdx.type !== "number") {
        /* skip */
    } else if (selIdx.closest("[data-inspector-mixed]") && selIdx.value.trim() === "") {
        /* omit — keep each widget */
    } else if (selIdx.value.trim() !== "") {
        const v = Number(selIdx.value);
        if (Number.isFinite(v)) {
            patch.selectedIndex = Math.round(v);
        }
    }

    chk("checked");

    const styles = buildStyleSnapshotFromInspector();
    if (Object.keys(styles).length) {
        patch.styles = styles;
    }

    const evEl = inspectorForm.elements.namedItem("eventsJson");
    if (evEl instanceof HTMLTextAreaElement) {
        if (!(evEl.closest("[data-inspector-mixed]") && evEl.value.trim() === "")) {
            try {
                const parsed = JSON.parse(evEl.value);
                if (Array.isArray(parsed)) {
                    patch.events = parsed;
                }
            } catch {
                /* invalid JSON: omit */
            }
        }
    }

    const stylerefHost = inspectorForm.querySelector(`[data-styleref-host="1"]`);
    if (stylerefHost) {
        const checked = [
            .../** @type {NodeListOf<HTMLInputElement>} */ (
                stylerefHost.querySelectorAll(`input[type="checkbox"][data-styleref]`)
            )
        ]
            .filter(el => el.checked)
            .map(el => el.dataset.styleref || "")
            .filter(Boolean);
        patch.styleRefs = checked;
    }

    const bindSel = /** @type {HTMLSelectElement | null} */ (
        inspectorForm.querySelector(`select[data-binding-prop]`)
    );
    if (bindSel) {
        const prop = bindSel.dataset.bindingProp || "value";
        if (bindSel.value) {
            patch.bindings = { [prop]: bindSel.value };
        } else {
            patch.bindings = null;
        }
    }

    const animHost = inspectorForm.querySelector(`[data-anim-host="1"]`);
    if (animHost) {
        const rows = [.../** @type {NodeListOf<HTMLElement>} */ (animHost.querySelectorAll(".anim-row"))];
        const parsed = rows
            .map(row => {
                /** @type {Record<string, unknown>} */
                const a = {};
                row.querySelectorAll(`[data-anim-field]`).forEach(el => {
                    const f = /** @type {HTMLElement} */ (el);
                    const key = f.dataset.animField || "";
                    if (!key) return;
                    if (f instanceof HTMLInputElement && f.type === "checkbox") {
                        if (f.checked) a[key] = true;
                    } else if (f instanceof HTMLInputElement && f.type === "number") {
                        if (f.value.trim() !== "") {
                            const n = Number(f.value);
                            if (Number.isFinite(n)) a[key] = n;
                        }
                    } else if (f instanceof HTMLSelectElement) {
                        a[key] = f.value;
                    }
                });
                if (typeof a.property !== "string") return null;
                if (typeof a.from !== "number" || typeof a.to !== "number") return null;
                return a;
            })
            .filter(Boolean);
        patch.animations = parsed;
    }

    return patch;
}

/** Parse a display dimension from an inspector number input (1…4096). Returns undefined if invalid or empty. */
function parseDisplayDimensionInput(input) {
    if (!(input instanceof HTMLInputElement) || input.value.trim() === "") {
        return undefined;
    }
    const n = Number(input.value);
    if (!Number.isFinite(n) || n < 1 || n > DISPLAY_DIMENSION_MAX) {
        return undefined;
    }
    return Math.round(n);
}

/** True for inspector controls that should commit on blur/change, not on each input keystroke. */
function inspectorCommitOnBlur(el) {
    return el instanceof HTMLElement && el.dataset.inspectorCommit === "blur";
}

/** Build patch object for page / project / display / theme inspector. */
function readPageInspectorPatch() {
    if (!inspectorForm || !inspectorShowingPage || !currentProject) {
        return {};
    }

    /** @type {Record<string, unknown>} */
    const patch = {};

    const pn = inspectorForm.elements.namedItem("page_display_name");
    if (pn instanceof HTMLInputElement) {
        const t = pn.value.trim();
        if (t) {
            patch.pageName = t;
        }
    }

    const bgIn = inspectorForm.querySelector(`input[type="text"][name="page_backgroundColor"]`);
    if (bgIn instanceof HTMLInputElement) {
        const t = bgIn.value.trim();
        patch.backgroundColor = t === "" ? null : t;
    }

    const sx = inspectorForm.elements.namedItem("page_scrollX");
    if (sx instanceof HTMLInputElement) {
        patch.pageScrollX = sx.checked;
    }
    const sy = inspectorForm.elements.namedItem("page_scrollY");
    if (sy instanceof HTMLInputElement) {
        patch.pageScrollY = sy.checked;
    }

    const projName = inspectorForm.elements.namedItem("proj_name");
    if (projName instanceof HTMLInputElement) {
        const t = projName.value.trim();
        if (t) {
            patch.projName = t;
        }
    }

    const lvSel = inspectorForm.elements.namedItem("proj_lvglVersion");
    if (lvSel instanceof HTMLSelectElement && lvSel.value) {
        patch.projLvglVersion = lvSel.value;
    }

    const desc = inspectorForm.elements.namedItem("proj_description");
    if (desc instanceof HTMLTextAreaElement) {
        patch.projDescription = desc.value.trim() === "" ? null : desc.value;
    }

    const outPath = inspectorForm.elements.namedItem("proj_outputPath");
    if (outPath instanceof HTMLInputElement) {
        patch.projOutputPath = outPath.value.trim() === "" ? null : outPath.value.trim();
    }

    const firmwarePath = inspectorForm.elements.namedItem("proj_firmwarePath");
    if (firmwarePath instanceof HTMLInputElement) {
        patch.projFirmwarePath = firmwarePath.value.trim() === "" ? null : firmwarePath.value.trim();
    }

    const stringsPath = inspectorForm.elements.namedItem("proj_stringsPath");
    if (stringsPath instanceof HTMLInputElement) {
        const t = stringsPath.value.trim();
        if (t === "" || t === "strings.res") {
            patch.projStringsPath = null;
        } else if (/\.res$/i.test(t)) {
            patch.projStringsPath = t;
        }
    }

    const lvInc = inspectorForm.elements.namedItem("proj_lvglInclude");
    if (lvInc instanceof HTMLSelectElement && lvInc.value) {
        patch.projLvglInclude = lvInc.value;
    }

    const dw = inspectorForm.elements.namedItem("disp_width");
    if (dw instanceof HTMLInputElement) {
        const n = parseDisplayDimensionInput(dw);
        if (n !== undefined) {
            patch.dispWidth = n;
        }
    }
    const dh = inspectorForm.elements.namedItem("disp_height");
    if (dh instanceof HTMLInputElement) {
        const n = parseDisplayDimensionInput(dh);
        if (n !== undefined) {
            patch.dispHeight = n;
        }
    }
    const bd = inspectorForm.elements.namedItem("disp_bitDepth");
    if (bd instanceof HTMLSelectElement && bd.value) {
        patch.dispBitDepth = Number(bd.value);
    }
    const cf = inspectorForm.elements.namedItem("disp_colorFormat");
    if (cf instanceof HTMLSelectElement && cf.value) {
        patch.dispColorFormat = cf.value;
    }
    const ori = inspectorForm.elements.namedItem("disp_orientation");
    if (ori instanceof HTMLSelectElement && ori.value) {
        patch.dispOrientation = ori.value;
    }
    const dir = inspectorForm.elements.namedItem("disp_direction");
    if (dir instanceof HTMLSelectElement && dir.value) {
        patch.dispDirection = dir.value;
    }
    const dpi = inspectorForm.elements.namedItem("disp_dpi");
    if (dpi instanceof HTMLInputElement) {
        patch.dispDpi = dpi.value.trim() === "" ? null : Number(dpi.value);
    }
    const round = inspectorForm.elements.namedItem("disp_round");
    if (round instanceof HTMLInputElement) {
        patch.dispRound = round.checked;
    }

    const d = inspectorForm.elements.namedItem("proj_theme_dark");
    if (d instanceof HTMLInputElement) {
        patch.themeDark = d.checked;
    }

    const prim = inspectorForm.querySelector(`input[type="text"][name="theme_primaryColor"]`);
    if (prim instanceof HTMLInputElement) {
        const t = prim.value.trim();
        patch.themePrimaryColor = t === "" ? null : t;
    }
    const sec = inspectorForm.querySelector(`input[type="text"][name="theme_secondaryColor"]`);
    if (sec instanceof HTMLInputElement) {
        const t = sec.value.trim();
        patch.themeSecondaryColor = t === "" ? null : t;
    }

    const stylesHost = inspectorForm.querySelector(`[data-proj-styles-host="1"]`);
    if (stylesHost && currentProject) {
        const rows = [.../** @type {NodeListOf<HTMLElement>} */ (stylesHost.querySelectorAll(".proj-style-row"))];
        const out = rows
            .map(row => {
                const get = key =>
                    /** @type {HTMLInputElement | HTMLTextAreaElement | null} */ (
                        row.querySelector(`[data-proj-style-field="${key}"]`)
                    );
                const idEl = get("id");
                const nameEl = get("name");
                const propsEl = get("props");
                const id = idEl?.value.trim();
                if (!id) return null;
                let props = {};
                if (propsEl && propsEl.value.trim()) {
                    try {
                        const parsed = JSON.parse(propsEl.value);
                        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                            props = parsed;
                        }
                    } catch {
                        return null;
                    }
                }
                const entry = { id, props };
                if (nameEl && nameEl.value.trim()) entry.name = nameEl.value.trim();
                return entry;
            })
            .filter(Boolean);
        patch.projStyles = out;
    }

    const propsHost = inspectorForm.querySelector(`[data-proj-props-host="1"]`);
    if (propsHost && currentProject) {
        const rows = [.../** @type {NodeListOf<HTMLElement>} */ (propsHost.querySelectorAll(".proj-prop-row"))];
        const out = rows
            .map(row => {
                const get = key =>
                    /** @type {HTMLInputElement | HTMLSelectElement | null} */ (
                        row.querySelector(`[data-proj-prop-field="${key}"]`)
                    );
                const idEl = get("id");
                const typeEl = get("type");
                const defEl = get("default");
                const minEl = get("min");
                const maxEl = get("max");
                const dirEl = get("direction");
                const id = idEl?.value.trim();
                const type = typeEl?.value;
                if (!id || !type) return null;
                const entry = { id, type };
                if (defEl && defEl.value !== "") {
                    const raw = defEl.value;
                    let parsed;
                    switch (type) {
                        case "int": {
                            const n = Number(raw);
                            if (Number.isFinite(n) && Number.isInteger(n)) parsed = n;
                            break;
                        }
                        case "float": {
                            const n = Number(raw);
                            if (Number.isFinite(n)) parsed = n;
                            break;
                        }
                        case "bool":
                            parsed = raw === "true" || raw === "1";
                            break;
                        case "string":
                        default:
                            parsed = raw;
                    }
                    if (parsed !== undefined) entry.default = parsed;
                }
                if ((type === "int" || type === "float") && minEl && minEl.value !== "") {
                    const n = Number(minEl.value);
                    if (Number.isFinite(n)) entry.min = n;
                }
                if ((type === "int" || type === "float") && maxEl && maxEl.value !== "") {
                    const n = Number(maxEl.value);
                    if (Number.isFinite(n)) entry.max = n;
                }
                if (dirEl && dirEl.value && dirEl.value !== "unknown") {
                    entry.direction = dirEl.value;
                }
                return entry;
            })
            .filter(Boolean);
        patch.projModelProperties = out;
    }

    return patch;
}

function commitInspector() {
    if (inspectorSyncing || !currentProject) {
        return;
    }
    if (inspectorDebounce) {
        clearTimeout(inspectorDebounce);
        inspectorDebounce = null;
    }

    if (inspectorShowingPage) {
        const patch = readPageInspectorPatch();
        if (Object.keys(patch).length === 0) {
            return;
        }
        vscode.postMessage({
            type: "updatePage",
            pageIndex: currentPageIndex,
            patch
        });
        return;
    }

    if (selectedComponentOrder.length >= 2) {
        const page = currentProject.pages[currentPageIndex];
        if (!page) {
            return;
        }
        const ids = [...selectedComponentOrder];
        const comps = ids.map(id => findComponentById(page.components, id)).filter(Boolean);
        const homogeneous =
            comps.length === ids.length &&
            comps.length >= 2 &&
            comps.every(c => c.type === comps[0].type);
        if (!homogeneous) {
            return;
        }
        const patch = readInspectorPatch();
        if (Object.keys(patch).length === 0) {
            return;
        }
        vscode.postMessage({
            type: "bulkPatchWidgets",
            pageIndex: currentPageIndex,
            updates: ids.map(componentId => ({ componentId, patch }))
        });
        return;
    }

    if (selectedComponentOrder.length !== 1) {
        return;
    }
    const selectedComponentId = selectedComponentOrder[0];
    vscode.postMessage({
        type: "updateWidget",
        pageIndex: currentPageIndex,
        componentId: selectedComponentId,
        patch: readInspectorPatch()
    });
}

/** Coalesce picker input+change in one animation frame before commit */
let inspectorColorCommitRaf = null;
function scheduleCommitAfterColorPick() {
    if (inspectorColorCommitRaf !== null) {
        return;
    }
    inspectorColorCommitRaf = requestAnimationFrame(() => {
        inspectorColorCommitRaf = null;
        queueMicrotask(() => commitInspector());
    });
}

function syncInspectorColorRowFromPicker(pickerEl) {
    const row = pickerEl.closest(".inspector-color-row");
    const textIn = row?.querySelector('input[type="text"]');
    const face = row?.querySelector(".inspector-color-face");
    const v = pickerEl.value.toLowerCase();
    if (textIn instanceof HTMLInputElement) {
        textIn.value = v;
    }
    if (face instanceof HTMLElement) {
        face.style.backgroundColor = v;
    }
}

if (inspectorForm) {
    inspectorForm.addEventListener("input", e => {
        if (inspectorSyncing) {
            return;
        }
        if (
            e.target instanceof HTMLInputElement &&
            e.target.type === "text" &&
            e.target.closest(".inspector-color-row")
        ) {
            const row = e.target.closest(".inspector-color-row");
            const nat = row?.querySelector(".inspector-color-picker-native");
            const face = row?.querySelector(".inspector-color-face");
            const h = tryParseCssHex(e.target.value);
            if (h && nat instanceof HTMLInputElement) {
                nat.value = h;
                if (face instanceof HTMLElement) {
                    face.style.backgroundColor = h;
                }
            }
        }
        if (
            e.target instanceof HTMLInputElement &&
            e.target.type === "color" &&
            e.target.classList.contains("inspector-color-picker-native")
        ) {
            syncInspectorColorRowFromPicker(e.target);
            scheduleCommitAfterColorPick();
            return;
        }
        if (inspectorCommitOnBlur(e.target)) {
            return;
        }
        if (inspectorDebounce) {
            clearTimeout(inspectorDebounce);
        }
        inspectorDebounce = setTimeout(() => {
            inspectorDebounce = null;
            commitInspector();
        }, 550);
    });
    inspectorForm.addEventListener("change", e => {
        if (inspectorSyncing) {
            return;
        }
        if (
            e.target instanceof HTMLInputElement &&
            e.target.type === "color" &&
            e.target.classList.contains("inspector-color-picker-native")
        ) {
            syncInspectorColorRowFromPicker(e.target);
            scheduleCommitAfterColorPick();
            return;
        }
        commitInspector();
    });
    inspectorForm.addEventListener("click", e => {
        const btn = e.target instanceof Element ? e.target.closest("[data-layout-act]") : null;
        if (!btn || inspectorSyncing) {
            return;
        }
        const act = btn.getAttribute("data-layout-act");
        if (act) {
            e.preventDefault();
            applyLayoutAct(act);
        }
    });
}

if (inspectorDelete) {
    inspectorDelete.addEventListener("click", () => {
        if (!selectedComponentOrder.length) {
            return;
        }
        if (selectedComponentOrder.length > 1) {
            vscode.postMessage({
                type: "bulkDeleteWidgets",
                pageIndex: currentPageIndex,
                componentIds: [...selectedComponentOrder]
            });
            return;
        }
        vscode.postMessage({
            type: "deleteWidget",
            pageIndex: currentPageIndex,
            componentId: selectedComponentOrder[0]
        });
    });
}

document.addEventListener("keydown", e => {
    if (e.ctrlKey || e.metaKey) {
        const t = e.target;
        const inInspectorField =
            t instanceof Element && !!t.closest("#inspector-form");
        if (!inInspectorField) {
            if (e.key === "z" || e.key === "Z") {
                e.preventDefault();
                if (e.shiftKey) {
                    postRedo();
                } else {
                    postUndo();
                }
                return;
            }
            if (e.key === "y" || e.key === "Y") {
                e.preventDefault();
                postRedo();
                return;
            }
        }
    }
    if (!designMode) {
        return;
    }
    const t = e.target;
    if (
        t instanceof HTMLInputElement ||
        t instanceof HTMLTextAreaElement ||
        t instanceof HTMLSelectElement
    ) {
        return;
    }
    if ((e.ctrlKey || e.metaKey) && currentProject) {
        const page = currentProject.pages[currentPageIndex];
        if (e.key === "c" || e.key === "C") {
            if (selectedComponentOrder.length && page) {
                e.preventDefault();
                designClipboard = selectedComponentOrder
                    .map(id => findComponentById(page.components, id))
                    .filter(Boolean)
                    .map(c => JSON.parse(JSON.stringify(c)));
            }
            return;
        }
        if (e.key === "v" || e.key === "V") {
            if (designClipboard?.length) {
                e.preventDefault();
                vscode.postMessage({
                    type: "pasteWidgets",
                    pageIndex: currentPageIndex,
                    components: designClipboard
                });
            }
            return;
        }
        if (e.key === "d" || e.key === "D") {
            if (selectedComponentOrder.length) {
                e.preventDefault();
                vscode.postMessage({
                    type: "duplicateWidgets",
                    pageIndex: currentPageIndex,
                    componentIds: [...selectedComponentOrder]
                });
            }
            return;
        }
    }
    if (e.key === "Escape") {
        if (groupEditContainerId) {
            exitGroupEditMode(true);
            return;
        }
        clearInspectorSelection();
        return;
    }
    if ((e.key === "Delete" || e.key === "Backspace") && selectedComponentOrder.length) {
        e.preventDefault();
        if (selectedComponentOrder.length > 1) {
            vscode.postMessage({
                type: "bulkDeleteWidgets",
                pageIndex: currentPageIndex,
                componentIds: [...selectedComponentOrder]
            });
        } else {
            vscode.postMessage({
                type: "deleteWidget",
                pageIndex: currentPageIndex,
                componentId: selectedComponentOrder[0]
            });
        }
    }
});

function setupDesignOverlay() {
    if (!designOverlay) {
        return;
    }
    designOverlay.addEventListener("pointerdown", e => {
        if (!designMode || !currentProject) {
            return;
        }
        const page = currentProject.pages[currentPageIndex];
        if (!page) {
            return;
        }
        designOverlay.setPointerCapture(e.pointerId);
        const { x, y } = overlayCoords(e);
        const additive = e.ctrlKey || e.metaKey;
        const extend = e.shiftKey;

        function releaseCap() {
            try {
                designOverlay.releasePointerCapture(e.pointerId);
            } catch {
                /* ignore */
            }
        }

        if (selectedComponentOrder.length === 1 && e.detail < 2) {
            const resizeId = selectedComponentOrder[0];
            const handle = hitTestResizeHandle(page, x, y, resizeId);
            if (handle) {
                const loc = locateComponentParent(page, resizeId);
                if (loc) {
                    resizeState = {
                        id: resizeId,
                        handle,
                        startX: loc.comp.x,
                        startY: loc.comp.y,
                        startW: loc.comp.width,
                        startH: loc.comp.height,
                        pointerX: x,
                        pointerY: y,
                        parentAbsX: loc.parentAbsX,
                        parentAbsY: loc.parentAbsY,
                        preview: {
                            x: loc.comp.x,
                            y: loc.comp.y,
                            width: loc.comp.width,
                            height: loc.comp.height
                        }
                    };
                    pendingDrag = null;
                    dragState = null;
                    marqueeState = null;
                    drawDesignOverlay();
                    e.preventDefault();
                    return;
                }
            }
        }

        if (e.altKey && e.detail < 2) {
            const hitAlt = hitTestAt(page, x, y);
            if (hitAlt) {
                const altId = groupEditContainerId
                    ? hitAlt.comp.id
                    : unitedSelectionId(page.components, hitAlt.comp.id);
                vscode.postMessage({
                    type: "duplicateWidgets",
                    pageIndex: currentPageIndex,
                    componentIds: [altId]
                });
                releaseCap();
                e.preventDefault();
                return;
            }
        }

        let hit = hitTestAt(page, x, y);

        if (
            groupEditContainerId &&
            hit &&
            hit.comp.id !== groupEditContainerId &&
            !isDescendantOf(page.components, hit.comp.id, groupEditContainerId)
        ) {
            groupEditContainerId = null;
            renderToolbarWidgetSelect();
        }

        // Double-click: enter group-edit mode, or select the deepest widget while editing.
        if (e.detail >= 2) {
            if (hit) {
                const gid = findEnclosingGroupId(page.components, hit.comp.id);
                if (gid && !groupEditContainerId) {
                    enterGroupEditMode(gid, hit.comp.id === gid ? null : hit.comp.id);
                } else {
                    selectedComponentOrder = [hit.comp.id];
                    inspectorShowingPage = false;
                    dragState = null;
                    pendingDrag = null;
                    marqueeState = null;
                    drawDesignOverlay();
                    renderInspector();
                    syncToolbarWidgetSelect();
                }
            }
            releaseCap();
            e.preventDefault();
            return;
        }

        if (!hit) {
            if (e.detail >= 2) {
                showInsertWidgetPicker(x, y);
                releaseCap();
                e.preventDefault();
                return;
            }
            marqueeState = {
                ox: x,
                oy: y,
                x,
                y,
                shift: extend,
                ctrl: additive
            };
            e.preventDefault();
            return;
        }

        const hid = groupEditContainerId
            ? hit.comp.id
            : unitedSelectionId(page.components, hit.comp.id);

        if (additive) {
            const ix = selectedComponentOrder.indexOf(hid);
            if (ix >= 0) {
                selectedComponentOrder.splice(ix, 1);
            } else {
                selectedComponentOrder.push(hid);
            }
            inspectorShowingPage = false;
            dragState = null;
            pendingDrag = null;
            marqueeState = null;
            drawDesignOverlay();
            renderInspector();
            releaseCap();
            return;
        }

        if (extend) {
            if (!selectedComponentOrder.includes(hid)) {
                selectedComponentOrder.push(hid);
            }
            inspectorShowingPage = false;
        } else {
            if (!selectedComponentOrder.includes(hid)) {
                selectedComponentOrder = [hid];
            }
            inspectorShowingPage = false;
        }

        const dragItems = selectedComponentOrder.map(id => {
            const b = getAbsBounds(page, id);
            if (!b) {
                return null;
            }
            return { id, startAbsX: b.x, startAbsY: b.y, width: b.width, height: b.height };
        }).filter(Boolean);

        if (dragItems.length === 0) {
            releaseCap();
            return;
        }

        marqueeState = null;

        pendingDrag = {
            pointerX: x,
            pointerY: y,
            items: /** @type {{ id: string; startAbsX: number; startAbsY: number; width: number; height: number }[]} */ (
                dragItems
            )
        };
        dragState = null;
        drawDesignOverlay();
        renderInspector();
        e.preventDefault();
    });

    designOverlay.addEventListener("pointermove", e => {
        if (!designMode) {
            return;
        }
        if (resizeState) {
            const page = currentProject?.pages[currentPageIndex];
            if (page) {
                const { x, y } = overlayCoords(e);
                let preview = boundsFromResize(resizeState.handle, resizeState, x, y);
                if (designGridEnabled) {
                    preview = {
                        x: snapToGrid(resizeState.parentAbsX + preview.x) - resizeState.parentAbsX,
                        y: snapToGrid(resizeState.parentAbsY + preview.y) - resizeState.parentAbsY,
                        width: Math.max(
                            MIN_WIDGET_SIZE,
                            snapToGrid(preview.width)
                        ),
                        height: Math.max(
                            MIN_WIDGET_SIZE,
                            snapToGrid(preview.height)
                        )
                    };
                }
                resizeState.preview = preview;
                drawDesignOverlay();
            }
            e.preventDefault();
            return;
        }
        if (pendingDrag && !dragState) {
            const { x, y } = overlayCoords(e);
            const dx = x - pendingDrag.pointerX;
            const dy = y - pendingDrag.pointerY;
            if (Math.abs(dx) > DESIGN_DRAG_THRESHOLD || Math.abs(dy) > DESIGN_DRAG_THRESHOLD) {
                dragState = {
                    pointerX: pendingDrag.pointerX,
                    pointerY: pendingDrag.pointerY,
                    dx: 0,
                    dy: 0,
                    snapGuides: [],
                    items: pendingDrag.items
                };
                pendingDrag = null;
            }
        }
        if (marqueeState && !dragState) {
            const { x, y } = overlayCoords(e);
            marqueeState.x = x;
            marqueeState.y = y;
            drawDesignOverlay();
            e.preventDefault();
            return;
        }
        if (!dragState) {
            return;
        }
        const { x, y } = overlayCoords(e);
        const rawDx = x - dragState.pointerX;
        const rawDy = y - dragState.pointerY;
        const page = currentProject?.pages[currentPageIndex];
        if (page) {
            const exclude = new Set(dragState.items.map(it => it.id));
            const snapped = magneticSnapAdjust(page, dragState.items, rawDx, rawDy, exclude);
            dragState.dx = snapped.dx;
            dragState.dy = snapped.dy;
            dragState.snapGuides = snapped.guides;
        } else {
            dragState.dx = rawDx;
            dragState.dy = rawDy;
            dragState.snapGuides = [];
        }
        drawDesignOverlay();
        e.preventDefault();
    });

    designOverlay.addEventListener("pointerup", e => {
        const releaseCaptureSafe = () => {
            try {
                designOverlay.releasePointerCapture(e.pointerId);
            } catch {
                /* ignore */
            }
        };

        if (!designMode) {
            marqueeState = null;
            releaseCaptureSafe();
            return;
        }

        // Rubber-band marquee (started on empty canvas)
        if (marqueeState && !dragState) {
            const page = currentProject?.pages[currentPageIndex];
            if (page && currentProject) {
                const m = marqueeState;
                const dxM = Math.abs(m.x - m.ox);
                const dyM = Math.abs(m.y - m.oy);
                const isMarquee = dxM >= MARQUEE_DRAG_THRESHOLD || dyM >= MARQUEE_DRAG_THRESHOLD;

                if (!isMarquee) {
                    if (!m.shift && !m.ctrl) {
                        selectPageInspector();
                    }
                } else {
                    const norm = normalizedMarqueeRect(m);
                    let picks = idsInMarqueeRect(page, norm);
                    if (groupEditContainerId) {
                        picks = picks.filter(
                            id =>
                                id === groupEditContainerId ||
                                isDescendantOf(page.components, id, groupEditContainerId)
                        );
                    } else {
                        picks = collapseToUnitedSelection(page.components, picks);
                    }

                    if (m.ctrl) {
                        let next = [...selectedComponentOrder];
                        for (const id of picks) {
                            const ix = next.indexOf(id);
                            if (ix >= 0) {
                                next.splice(ix, 1);
                            } else {
                                next.push(id);
                            }
                        }
                        selectedComponentOrder = next;
                        if (next.length === 0) {
                            selectPageInspector();
                        } else {
                            inspectorShowingPage = false;
                        }
                    } else if (m.shift) {
                        const next = [...selectedComponentOrder];
                        for (const id of picks) {
                            if (!next.includes(id)) {
                                next.push(id);
                            }
                        }
                        selectedComponentOrder = next;
                        if (next.length > 0) {
                            inspectorShowingPage = false;
                        }
                    } else {
                        selectedComponentOrder = picks;
                        if (picks.length === 0) {
                            selectPageInspector();
                        } else {
                            inspectorShowingPage = false;
                        }
                    }
                }
            }
            marqueeState = null;
            drawDesignOverlay();
            renderInspector();
            releaseCaptureSafe();
            e.preventDefault();
            return;
        }

        pendingDrag = null;

        if (resizeState && currentProject) {
            const p = resizeState.preview;
            if (p) {
                vscode.postMessage({
                    type: "bulkPatchWidgets",
                    pageIndex: currentPageIndex,
                    updates: [
                        {
                            componentId: resizeState.id,
                            patch: {
                                x: p.x,
                                y: p.y,
                                width: p.width,
                                height: p.height
                            }
                        }
                    ]
                });
            }
            resizeState = null;
            drawDesignOverlay();
            renderInspector();
            releaseCaptureSafe();
            e.preventDefault();
            return;
        }

        if (!dragState || !currentProject) {
            drawDesignOverlay();
            renderInspector();
            releaseCaptureSafe();
            e.preventDefault();
            return;
        }
        const { x, y } = overlayCoords(e);
        const dx = x - dragState.pointerX;
        const dy = y - dragState.pointerY;
        const moved = Math.abs(dx) > DESIGN_DRAG_THRESHOLD || Math.abs(dy) > DESIGN_DRAG_THRESHOLD;
        if (moved) {
            const moves = dragState.items.map(it => {
                let absX = Math.round(it.startAbsX + dx);
                let absY = Math.round(it.startAbsY + dy);
                if (designGridEnabled) {
                    absX = snapToGrid(absX);
                    absY = snapToGrid(absY);
                }
                return { componentId: it.id, absX, absY };
            });
            vscode.postMessage({
                type: "bulkMoveWidgets",
                pageIndex: currentPageIndex,
                moves
            });
        }
        dragState = null;
        drawDesignOverlay();
        renderInspector();
        releaseCaptureSafe();
        e.preventDefault();
    });

    designOverlay.addEventListener("dragover", e => {
        if (!designMode) {
            return;
        }
        if (e.dataTransfer?.types.includes(PALETTE_DRAG_MIME)) {
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
        }
    });
    designOverlay.addEventListener("drop", e => {
        if (!designMode || !currentProject) {
            return;
        }
        const widgetType = e.dataTransfer?.getData(PALETTE_DRAG_MIME);
        if (!widgetType) {
            return;
        }
        e.preventDefault();
        const { x, y } = overlayCoords(e);
        hideInsertWidgetPicker();
        postAddWidgetAt(widgetType, x, y);
    });

    designOverlay.addEventListener("pointercancel", e => {
        dragState = null;
        pendingDrag = null;
        marqueeState = null;
        resizeState = null;
        drawDesignOverlay();
        renderInspector();
        try {
            designOverlay.releasePointerCapture(e.pointerId);
        } catch {
            /* ignore */
        }
    });
}

setupDesignOverlay();
setDesignPointerMode();

window.addEventListener("resize", () => {
    resizeDesignOverlay();
    drawDesignOverlay();
});

/** Scroll the preview viewport when the display is larger than the panel. */
function scrollPreviewContainer(e) {
    if (!canvasContainer) {
        return false;
    }
    const maxY = canvasContainer.scrollHeight - canvasContainer.clientHeight;
    const maxX = canvasContainer.scrollWidth - canvasContainer.clientWidth;
    if (maxY <= 0 && maxX <= 0) {
        return false;
    }
    const prevTop = canvasContainer.scrollTop;
    const prevLeft = canvasContainer.scrollLeft;
    canvasContainer.scrollTop = Math.max(0, Math.min(maxY, prevTop + e.deltaY));
    canvasContainer.scrollLeft = Math.max(0, Math.min(maxX, prevLeft + e.deltaX));
    return canvasContainer.scrollTop !== prevTop || canvasContainer.scrollLeft !== prevLeft;
}

function onPreviewWheel(e) {
    if (scrollPreviewContainer(e)) {
        e.preventDefault();
        return;
    }
    if (designMode) {
        return;
    }
    if (!wasmReady || !WasmModule || !canvas) {
        return;
    }
    e.preventDefault();
    const delta = Math.sign(e.deltaY);
    const fn = WasmModule._embf_on_wheel ?? WasmModule._onMouseWheelEvent;
    fn?.(delta, 0);
}

if (canvasContainer) {
    canvasContainer.addEventListener("wheel", onPreviewWheel, { passive: false });
}
if (designOverlay) {
    designOverlay.addEventListener("wheel", onPreviewWheel, { passive: false });
}

// ── Input forwarding (LVGL interaction when design mode is off) ───────────────
function canvasDisplayCoords(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = displayWidth / rect.width;
    const scaleY = displayHeight / rect.height;
    return {
        x: Math.round((e.clientX - rect.left) * scaleX),
        y: Math.round((e.clientY - rect.top) * scaleY)
    };
}

if (canvas) {
    canvas.addEventListener("pointerdown", e => {
        if (!designMode) {
            const c = canvasDisplayCoords(e);
            canvasSwipeTrack = { ox: c.x, oy: c.y, x: c.x, y: c.y };
        }
        canvas.setPointerCapture(e.pointerId);
        sendPointer(e, true, 4);
    });
    canvas.addEventListener("pointermove", e => {
        if (!designMode && canvasSwipeTrack) {
            const c = canvasDisplayCoords(e);
            canvasSwipeTrack.x = c.x;
            canvasSwipeTrack.y = c.y;
        }
        const drag = e.buttons > 0;
        sendPointer(e, drag, drag ? 1 : 0);
    });
    canvas.addEventListener("pointerup", e => {
        let consumedSwipe = false;
        if (!designMode && canvasSwipeTrack) {
            const sdx = canvasSwipeTrack.x - canvasSwipeTrack.ox;
            const sdy = canvasSwipeTrack.y - canvasSwipeTrack.oy;
            consumedSwipe = tryExecutePageSwipe(sdx, sdy);
            canvasSwipeTrack = null;
        }
        if (!consumedSwipe) {
            sendPointer(e, false, 4);
        }
        try {
            canvas.releasePointerCapture(e.pointerId);
        } catch {
            /* ignore if not captured */
        }
    });
    canvas.addEventListener("pointercancel", e => {
        canvasSwipeTrack = null;
        sendPointer(e, false, 4);
        try {
            canvas.releasePointerCapture(e.pointerId);
        } catch {
            /* ignore */
        }
    });

    canvas.addEventListener("wheel", onPreviewWheel, { passive: false });

    canvas.addEventListener("keydown", e => {
        if (!wasmReady || !WasmModule) return;
        const fn = WasmModule._embf_on_key ?? WasmModule._onKeyPressed;
        fn?.(e.key.charCodeAt(0));
    });
}

function sendPointer(e, pressed, pumpLevel) {
    if (!wasmReady || !WasmModule || !canvas) return;
    const { x, y } = canvasDisplayCoords(e);
    forwardPointerToLvgl(x, y, pressed, pumpLevel);
}

/** Send pointer to WASM in display coordinates (used by canvas + design-mode taps). */
function forwardPointerToLvgl(x, y, pressed, pumpLevel = 0) {
    if (!wasmReady || !WasmModule) {
        return;
    }
    const fn = WasmModule._embf_on_pointer ?? WasmModule._onPointerEvent;
    fn?.(x, y, pressed ? 1 : 0);
    if (pumpLevel > 0) {
        pumpLvglAfterPointer(pumpLevel);
    }
}

/** Tap at display coords — press/release so LVGL fires CLICKED and the event queue drains. */
function forwardPointerTapToLvgl(x, y) {
    forwardPointerToLvgl(x, y, true, 4);
    forwardPointerToLvgl(x, y, false, 4);
}

/**
 * Run LVGL timer handler a few times then drain our event queue.
 * @param iterations how many `lv_timer_handler` passes (4 catches fast click between frames)
 */
function pumpLvglAfterPointer(iterations) {
    if (!wasmReady || !WasmModule || typeof WasmModule._embf_main_loop !== "function") return;
    for (let i = 0; i < iterations; i++) {
        WasmModule._embf_main_loop();
    }
    drainEventQueue();
}

// ── Page navigation ───────────────────────────────────────────────────────────

/**
 * @param {number} idx
 * @param {{ skipTabSync?: boolean }} [options]
 */
function navigateToPageIndex(idx, options = {}) {
    if (!currentProject) {
        return;
    }
    const max = currentProject.pages.length - 1;
    const next = Math.min(Math.max(0, idx), Math.max(0, max));
    const page = currentProject.pages[next];

    if (!options.skipTabSync && page) {
        const existing = workspaceTabs.find(t => t.kind === "page" && t.pageId === page.id);
        if (existing && existing.id !== activeWorkspaceTabId) {
            activateWorkspaceTab(existing.id);
            return;
        }
        const active = getActiveWorkspaceTab();
        if (active?.kind === "flow") {
            openPageTabByIndex(next, true);
            return;
        }
        if (active?.kind === "page") {
            active.pageId = page.id;
            renderWorkspaceTabs();
        }
    }

    if (next === currentPageIndex) {
        renderPageList();
        renderWorkspaceTabs();
        return;
    }
    currentPageIndex = next;
    pageSelectProgrammatic = true;
    if (pageSelect) {
        pageSelect.value = String(next);
    }
    pageSelectProgrammatic = false;
    groupEditContainerId = null;
    selectedComponentOrder = [];
    inspectorShowingPage = true;
    dragState = null;
    pendingDrag = null;
    marqueeState = null;
    resizeState = null;
    hideInsertWidgetPicker();
    if (wasmReady && WasmModule) {
        const navOpts = designMode ? undefined : { anim: "fade_in", time: 220 };
        switchToPage(currentProject, next, navOpts);
    } else {
        buildUiFromProject(currentProject, next);
    }
    syncImagePreviewOverlays();
    drawDesignOverlay();
    renderInspector();
    renderPageList();
    renderToolbarWidgetSelect();
    renderWidgetTree();
    scheduleImageOverlaySync();
    if (options.skipTabSync && page) {
        const active = getActiveWorkspaceTab();
        if (active?.kind === "page") {
            active.pageId = page.id;
            renderWorkspaceTabs();
        }
    }
}

/** Cycle-safe check: is `descendantId` inside `ancestorId`'s subtree? */
function isDescendantInTree(components, ancestorId, descendantId) {
    const ancestor = findComponentById(components, ancestorId);
    if (!ancestor || !ancestor.children?.length) {
        return false;
    }
    return !!findComponentById(ancestor.children, descendantId);
}

const TREE_DRAG_MIME = "application/x-embeddedflow-tree-id";
/** @type {{ srcId: string; dropIndicator: HTMLElement | null }} */
const treeDragState = { srcId: "", dropIndicator: null };

function clearTreeDropIndicators() {
    if (!widgetTreeEl) return;
    widgetTreeEl
        .querySelectorAll(".widget-tree-btn.drop-into,.widget-tree-btn.drop-before,.widget-tree-btn.drop-after")
        .forEach(el => el.classList.remove("drop-into", "drop-before", "drop-after"));
}

/** Hit test pointer Y within button rect → "before" | "into" | "after". */
function computeTreeDropZone(btn, clientY) {
    const r = btn.getBoundingClientRect();
    const rel = clientY - r.top;
    if (rel < r.height * 0.25) return "before";
    if (rel > r.height * 0.75) return "after";
    return "into";
}

function isContainerType(t) {
    return t === "container" || t === "panel";
}

function postTreeReparent(srcId, parentId, beforeId) {
    vscode.postMessage({
        type: "reparentWidget",
        pageIndex: currentPageIndex,
        componentId: srcId,
        parentId,
        beforeId: beforeId ?? null
    });
}

function renderWidgetTree() {
    if (!widgetTreeEl || !currentProject) {
        return;
    }
    const page = currentProject.pages[currentPageIndex];
    if (!page) {
        widgetTreeEl.innerHTML = "";
        return;
    }
    widgetTreeEl.innerHTML = "";

    /** @param {object[]} components @param {number} depth @param {string | null} parentId */
    function appendBranch(components, depth, parentId) {
        for (const c of components ?? []) {
            const li = document.createElement("li");
            const btn = document.createElement("button");
            btn.type = "button";
            const active = selectedComponentOrder.includes(c.id);
            btn.className = "widget-tree-btn" + (active ? " active" : "");
            btn.dataset.componentId = c.id;
            btn.dataset.parentId = parentId ?? "";
            btn.dataset.componentType = c.type || "";
            btn.draggable = true;
            btn.style.paddingLeft = `${8 + depth * 12}px`;
            const typeSpan = document.createElement("span");
            typeSpan.className = "tree-type";
            typeSpan.textContent = c.type || "widget";
            btn.appendChild(typeSpan);
            btn.appendChild(document.createTextNode(c.id));
            btn.addEventListener("click", () => {
                if (groupEditContainerId) {
                    selectedComponentOrder = [c.id];
                    inspectorShowingPage = false;
                    drawDesignOverlay();
                    renderInspector();
                    syncToolbarWidgetSelect();
                    renderWidgetTree();
                } else {
                    setSelection(c.id);
                }
            });

            btn.addEventListener("dragstart", ev => {
                treeDragState.srcId = c.id;
                if (ev.dataTransfer) {
                    ev.dataTransfer.effectAllowed = "move";
                    ev.dataTransfer.setData(TREE_DRAG_MIME, c.id);
                    ev.dataTransfer.setData("text/plain", c.id);
                }
                btn.classList.add("dragging");
            });
            btn.addEventListener("dragend", () => {
                btn.classList.remove("dragging");
                treeDragState.srcId = "";
                clearTreeDropIndicators();
            });
            btn.addEventListener("dragover", ev => {
                const srcId = treeDragState.srcId;
                if (!srcId || srcId === c.id) {
                    return;
                }
                const page2 = currentProject?.pages[currentPageIndex];
                if (!page2) return;
                if (isDescendantInTree(page2.components, srcId, c.id)) {
                    return;
                }
                const zone = computeTreeDropZone(btn, ev.clientY);
                if (zone === "into" && !isContainerType(c.type)) {
                    clearTreeDropIndicators();
                    btn.classList.add("drop-after");
                    ev.preventDefault();
                    if (ev.dataTransfer) ev.dataTransfer.dropEffect = "move";
                    return;
                }
                clearTreeDropIndicators();
                if (zone === "into") {
                    btn.classList.add("drop-into");
                } else if (zone === "before") {
                    btn.classList.add("drop-before");
                } else {
                    btn.classList.add("drop-after");
                }
                ev.preventDefault();
                if (ev.dataTransfer) ev.dataTransfer.dropEffect = "move";
            });
            btn.addEventListener("dragleave", () => {
                btn.classList.remove("drop-into", "drop-before", "drop-after");
            });
            btn.addEventListener("drop", ev => {
                ev.preventDefault();
                const srcId =
                    (ev.dataTransfer && ev.dataTransfer.getData(TREE_DRAG_MIME)) ||
                    treeDragState.srcId;
                clearTreeDropIndicators();
                if (!srcId || srcId === c.id) return;
                const page2 = currentProject?.pages[currentPageIndex];
                if (!page2) return;
                if (isDescendantInTree(page2.components, srcId, c.id)) return;
                let zone = computeTreeDropZone(btn, ev.clientY);
                if (zone === "into" && !isContainerType(c.type)) {
                    zone = "after";
                }
                if (zone === "into") {
                    postTreeReparent(srcId, c.id, null);
                } else if (zone === "before") {
                    postTreeReparent(srcId, parentId, c.id);
                } else {
                    const siblings =
                        parentId === null
                            ? page2.components
                            : (findComponentById(page2.components, parentId)?.children ?? []);
                    const idx = siblings.findIndex(x => x.id === c.id);
                    const next = siblings[idx + 1];
                    postTreeReparent(srcId, parentId, next ? next.id : null);
                }
            });

            li.appendChild(btn);
            widgetTreeEl.appendChild(li);
            if (c.children?.length) {
                appendBranch(c.children, depth + 1, c.id);
            }
        }
    }
    appendBranch(page.components, 0, null);

    /** Allow drop on empty tree area → move to page root (append). */
    widgetTreeEl.addEventListener("dragover", ev => {
        const srcId = treeDragState.srcId;
        if (!srcId) return;
        if (/** @type {HTMLElement} */ (ev.target).closest(".widget-tree-btn")) return;
        ev.preventDefault();
        if (ev.dataTransfer) ev.dataTransfer.dropEffect = "move";
    });
    widgetTreeEl.addEventListener("drop", ev => {
        const srcId =
            (ev.dataTransfer && ev.dataTransfer.getData(TREE_DRAG_MIME)) || treeDragState.srcId;
        clearTreeDropIndicators();
        if (!srcId) return;
        if (/** @type {HTMLElement} */ (ev.target).closest(".widget-tree-btn")) return;
        ev.preventDefault();
        postTreeReparent(srcId, null, null);
    });
}

function updatePageSidebarActions() {
    const multi = (currentProject?.pages.length ?? 0) > 1;
    if (btnPageRemove instanceof HTMLButtonElement) {
        btnPageRemove.disabled = !multi;
    }
    if (btnPageRename instanceof HTMLButtonElement) {
        btnPageRename.disabled = !currentProject;
    }
    if (btnPageAdd instanceof HTMLButtonElement) {
        btnPageAdd.disabled = !currentProject;
    }
}

function syncToolbarWidgetSelect() {
    if (!toolbarWidgetSelect) {
        return;
    }
    pageWidgetPickerProgrammatic = true;
    if (!inspectorShowingPage && selectedComponentOrder.length === 1) {
        const id = selectedComponentOrder[0];
        const hasOption = [...toolbarWidgetSelect.options].some(o => o.value === id);
        toolbarWidgetSelect.value = hasOption ? id : "";
    } else {
        toolbarWidgetSelect.value = "";
    }
    pageWidgetPickerProgrammatic = false;
}

function renderToolbarWidgetSelect() {
    if (!toolbarWidgetSelect) {
        return;
    }
    if (!currentProject) {
        toolbarWidgetSelect.innerHTML = "";
        const empty = document.createElement("option");
        empty.value = "";
        empty.textContent = "—";
        toolbarWidgetSelect.appendChild(empty);
        toolbarWidgetSelect.disabled = true;
        return;
    }
    const page = currentProject.pages[currentPageIndex];
    let flat = flatComponentsListWithDepth(page?.components);
    if (groupEditContainerId) {
        const group = findComponentById(page?.components, groupEditContainerId);
        flat = group
            ? [{ comp: group, depth: 0 }, ...flatComponentsListWithDepth(group.children, 1)]
            : flat.filter(({ comp }) => comp.id === groupEditContainerId);
    }
    toolbarWidgetSelect.innerHTML = "";
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = flat.length ? "Select widget…" : "No widgets";
    toolbarWidgetSelect.appendChild(placeholder);
    for (const { comp, depth } of flat) {
        const opt = document.createElement("option");
        opt.value = comp.id;
        const indent = depth > 0 ? "\u00a0\u00a0".repeat(depth) : "";
        const typeLabel = comp.type || "widget";
        opt.textContent = `${indent}${typeLabel} — ${comp.id}`;
        toolbarWidgetSelect.appendChild(opt);
    }
    toolbarWidgetSelect.disabled = flat.length === 0;
    syncToolbarWidgetSelect();
}

function renderPageList() {
    if (!pageListEl || !currentProject) {
        updatePageSidebarActions();
        return;
    }
    pageListEl.innerHTML = "";
    currentProject.pages.forEach((p, i) => {
        const li = document.createElement("li");
        const btn = document.createElement("button");
        btn.type = "button";
        const tabOpen = workspaceTabs.some(t => t.kind === "page" && t.pageId === p.id);
        const tabActive = i === currentPageIndex && isWorkspacePageActive();
        btn.className =
            "page-list-item" +
            (tabActive ? " active" : "") +
            (tabOpen && !tabActive ? " open" : "");
        btn.title = tabOpen
            ? "Open in workspace (Ctrl+click for another tab)"
            : "Open page in workspace tab";
        btn.dataset.pageIndex = String(i);
        const name = document.createElement("span");
        name.className = "page-list-name";
        name.textContent = p.name || `Page ${i + 1}`;
        const idSpan = document.createElement("span");
        idSpan.className = "page-list-id";
        idSpan.textContent = p.id;
        btn.appendChild(name);
        btn.appendChild(idSpan);
        btn.addEventListener("click", e => {
            if (e.ctrlKey || e.metaKey) {
                const tab = { id: nextWorkspaceTabId(), kind: "page", pageId: p.id };
                workspaceTabs.push(tab);
                activateWorkspaceTab(tab.id);
            } else {
                openPageTabByIndex(i, true);
            }
        });
        li.appendChild(btn);
        pageListEl.appendChild(li);
    });
    updatePageSidebarActions();
    renderWidgetTree();
}

if (designGridCheck) {
    designGridCheck.addEventListener("change", () => {
        designGridEnabled = !!designGridCheck.checked;
        drawDesignOverlay();
    });
}

if (designRulersCheck) {
    designRulersCheck.addEventListener("change", () => {
        designRulersEnabled = !!designRulersCheck.checked;
        if (displayWrapper) {
            displayWrapper.classList.toggle("no-rulers", !designRulersEnabled);
        }
        refreshPreviewLayoutAfterPanelChange();
        drawRulers();
    });
}

/** Pick a tick step (logical px) so labels don't overlap at the current zoom. */
function pickRulerStep(zoom) {
    const cssPerLogical = zoom;
    const minorTargetCss = 6;
    const minor = Math.max(1, Math.ceil(minorTargetCss / cssPerLogical));
    const candidates = [1, 2, 5, 10, 20, 25, 50, 100, 200, 500, 1000];
    const minorStep = candidates.find(v => v >= minor) ?? candidates[candidates.length - 1];
    const labelTargetCss = 60;
    const labelMin = Math.max(minorStep, Math.ceil(labelTargetCss / cssPerLogical));
    const labelStep = candidates.find(v => v >= labelMin && v % minorStep === 0) ?? labelMin;
    return { minor: minorStep, label: labelStep };
}

function drawRulers() {
    if (!designRulersEnabled || !displayWidth || !displayHeight) {
        return;
    }
    const dpr = getPreviewDpr();
    const { minor, label } = pickRulerStep(previewZoom);

    if (rulerTop) {
        const ctxTop = rulerTop.getContext("2d");
        if (ctxTop) {
            ctxTop.setTransform(dpr, 0, 0, dpr, 0, 0);
            const w = rulerTop.width / dpr;
            const h = rulerTop.height / dpr;
            ctxTop.fillStyle = "#1f1f1f";
            ctxTop.fillRect(0, 0, w, h);
            ctxTop.strokeStyle = "#666";
            ctxTop.fillStyle = "#bbb";
            ctxTop.font = "9px ui-sans-serif, system-ui, sans-serif";
            ctxTop.textBaseline = "top";
            ctxTop.lineWidth = 1;
            for (let lx = 0; lx <= displayWidth; lx += minor) {
                const x = Math.round(lx * previewZoom) + 0.5;
                const big = lx % label === 0;
                ctxTop.beginPath();
                ctxTop.moveTo(x, big ? h - 9 : h - 4);
                ctxTop.lineTo(x, h);
                ctxTop.stroke();
                if (big) {
                    ctxTop.fillText(String(lx), x + 2, 2);
                }
            }
            ctxTop.strokeStyle = "#3c3c3c";
            ctxTop.beginPath();
            ctxTop.moveTo(0, h - 0.5);
            ctxTop.lineTo(w, h - 0.5);
            ctxTop.stroke();
        }
    }
    if (rulerLeft) {
        const ctxLeft = rulerLeft.getContext("2d");
        if (ctxLeft) {
            ctxLeft.setTransform(dpr, 0, 0, dpr, 0, 0);
            const w = rulerLeft.width / dpr;
            const h = rulerLeft.height / dpr;
            ctxLeft.fillStyle = "#1f1f1f";
            ctxLeft.fillRect(0, 0, w, h);
            ctxLeft.strokeStyle = "#666";
            ctxLeft.fillStyle = "#bbb";
            ctxLeft.font = "9px ui-sans-serif, system-ui, sans-serif";
            ctxLeft.textBaseline = "top";
            ctxLeft.lineWidth = 1;
            for (let ly = 0; ly <= displayHeight; ly += minor) {
                const y = Math.round(ly * previewZoom) + 0.5;
                const big = ly % label === 0;
                ctxLeft.beginPath();
                ctxLeft.moveTo(big ? w - 9 : w - 4, y);
                ctxLeft.lineTo(w, y);
                ctxLeft.stroke();
                if (big) {
                    ctxLeft.save();
                    ctxLeft.translate(2, y + 2);
                    ctxLeft.rotate(-Math.PI / 2);
                    ctxLeft.textBaseline = "top";
                    ctxLeft.textAlign = "right";
                    ctxLeft.fillText(String(ly), 0, 0);
                    ctxLeft.restore();
                }
            }
            ctxLeft.strokeStyle = "#3c3c3c";
            ctxLeft.beginPath();
            ctxLeft.moveTo(w - 0.5, 0);
            ctxLeft.lineTo(w - 0.5, h);
            ctxLeft.stroke();
        }
    }
}

// ── Canvas pan (Space+drag / middle mouse) ───────────────────────────────────
/** @type {{ startX: number; startY: number; scrollLeft: number; scrollTop: number; pointerId: number } | null} */
let canvasPanState = null;
let canvasPanArmed = false;

function setCanvasPanArmed(on) {
    if (canvasPanArmed === on) return;
    canvasPanArmed = on;
    if (canvasContainer) {
        canvasContainer.classList.toggle("pan-armed", on && !canvasPanState);
    }
}

window.addEventListener("keydown", ev => {
    if (ev.code === "Space") {
        const target = /** @type {HTMLElement | null} */ (ev.target);
        if (
            target &&
            (target.tagName === "INPUT" ||
                target.tagName === "TEXTAREA" ||
                target.tagName === "SELECT" ||
                target.isContentEditable)
        ) {
            return;
        }
        if (!canvasPanArmed) {
            setCanvasPanArmed(true);
            ev.preventDefault();
        }
    }
});
window.addEventListener("keyup", ev => {
    if (ev.code === "Space" && canvasPanArmed && !canvasPanState) {
        setCanvasPanArmed(false);
    }
});
window.addEventListener("blur", () => {
    if (!canvasPanState) {
        setCanvasPanArmed(false);
    }
});

if (canvasContainer) {
    canvasContainer.addEventListener("pointerdown", ev => {
        const middleButton = ev.button === 1;
        if (!middleButton && !canvasPanArmed) return;
        canvasPanState = {
            startX: ev.clientX,
            startY: ev.clientY,
            scrollLeft: canvasContainer.scrollLeft,
            scrollTop: canvasContainer.scrollTop,
            pointerId: ev.pointerId
        };
        canvasContainer.setPointerCapture(ev.pointerId);
        canvasContainer.classList.add("pan-active");
        canvasContainer.classList.remove("pan-armed");
        ev.preventDefault();
        ev.stopPropagation();
    }, true);
    canvasContainer.addEventListener("pointermove", ev => {
        if (!canvasPanState || ev.pointerId !== canvasPanState.pointerId) return;
        canvasContainer.scrollLeft = canvasPanState.scrollLeft - (ev.clientX - canvasPanState.startX);
        canvasContainer.scrollTop = canvasPanState.scrollTop - (ev.clientY - canvasPanState.startY);
    }, true);
    function endPan(ev) {
        if (!canvasPanState || ev.pointerId !== canvasPanState.pointerId) return;
        try {
            canvasContainer.releasePointerCapture(ev.pointerId);
        } catch (_) {
            /* ignore */
        }
        canvasPanState = null;
        canvasContainer.classList.remove("pan-active");
        canvasContainer.classList.toggle("pan-armed", canvasPanArmed);
    }
    canvasContainer.addEventListener("pointerup", endPan, true);
    canvasContainer.addEventListener("pointercancel", endPan, true);
    canvasContainer.addEventListener("auxclick", ev => {
        if (ev.button === 1) ev.preventDefault();
    });
}

if (btnPlayAnimations) {
    btnPlayAnimations.addEventListener("click", () => {
        const r = playWidgetAnimationsOnCurrentPage();
        if (!r.ok && r.reason) {
            if (statusEl) {
                statusEl.textContent = r.reason;
            }
            log("warn", `play animations: ${r.reason}`);
        } else if (statusEl && r.started) {
            statusEl.textContent = `Playing ${r.started} animation(s)…`;
        }
    });
}

if (btnThemeToggle) {
    btnThemeToggle.addEventListener("click", () => {
        if (!currentProject || !wasmReady) {
            return;
        }
        // Persist the toggle into `project.theme.dark` so it survives every inspector-edit
        // reload (previously this only set a transient `previewDarkOverride` that was wiped
        // by the next reload, causing the preview to snap back to the JSON-saved theme).
        previewDarkOverride = null;
        const currentDark = !!currentProject.theme?.dark;
        vscode.postMessage({
            type: "updatePage",
            pageIndex: currentPageIndex,
            patch: { themeDark: !currentDark }
        });
    });
}

if (btnPageAdd) {
    btnPageAdd.addEventListener("click", () => {
        vscode.postMessage({ type: "addPage" });
    });
}

if (btnPageRemove) {
    btnPageRemove.addEventListener("click", () => {
        if (!currentProject || currentProject.pages.length <= 1) {
            return;
        }
        vscode.postMessage({ type: "removePage", pageIndex: currentPageIndex });
    });
}

if (btnPageRename) {
    btnPageRename.addEventListener("click", () => {
        if (!currentProject) {
            return;
        }
        vscode.postMessage({ type: "renamePage", pageIndex: currentPageIndex });
    });
}

// ── Page selector (toolbar) ───────────────────────────────────────────────────
if (pageSelect) {
    pageSelect.addEventListener("change", () => {
        if (!currentProject || pageSelectProgrammatic) {
            return;
        }
        const idx = parseInt(pageSelect.value, 10) || 0;
        navigateToPageIndex(idx);
    });
}

if (toolbarWidgetSelect) {
    toolbarWidgetSelect.addEventListener("change", () => {
        if (pageWidgetPickerProgrammatic || !currentProject) {
            return;
        }
        const compId = toolbarWidgetSelect.value;
        if (!compId) {
            selectPageInspector();
            return;
        }
        setSelection(compId);
    });
}

if (previewLocaleSelect) {
    previewLocaleSelect.addEventListener("change", () => {
        previewLocale = previewLocaleSelect.value;
        refreshPreviewLocaleText();
    });
}

if (paletteSearch) {
    paletteSearch.addEventListener("input", () => filterPaletteSearch());
}

if (previewBezelCheck) {
    previewBezelCheck.addEventListener("change", () => {
        syncPreviewBezel();
        refreshPreviewLayoutAfterPanelChange();
    });
}

if (btnOpenProjectSettings) {
    btnOpenProjectSettings.addEventListener("click", () => {
        // The page/project/display inspector only renders in Design mode (renderInspector()
        // early-returns when designMode is false). Force-enable it so the button always works,
        // regardless of whether the user is currently in Run mode.
        if (!designMode) {
            designMode = true;
            if (designModeCheck instanceof HTMLInputElement) {
                designModeCheck.checked = true;
            }
            setDesignPointerMode();
        }
        // Un-collapse the right Properties panel via the persisted-state path so the
        // toggle button glyph (‹/›), tooltip, and stored collapse flag stay in sync.
        if (panelCollapseState.inspectorCollapsed) {
            panelCollapseState.inspectorCollapsed = false;
            savePanelCollapseState();
            applyPanelCollapseState();
        }
        selectPageInspector();
    });
}

document.addEventListener("click", e => {
    if (!(e.target instanceof Element) || !insertWidgetPicker?.classList.contains("open")) {
        return;
    }
    if (!e.target.closest("#insert-widget-picker")) {
        hideInsertWidgetPicker();
    }
});

if (sidebarPanelComponents) {
    sidebarPanelComponents.addEventListener("dragstart", e => {
        const t = e.target;
        if (!(t instanceof Element)) {
            return;
        }
        const btn = t.closest("[data-widget]");
        if (!btn || !(btn instanceof HTMLElement)) {
            return;
        }
        const widgetType = btn.getAttribute("data-widget");
        if (!widgetType || !e.dataTransfer) {
            return;
        }
        e.dataTransfer.setData(PALETTE_DRAG_MIME, widgetType);
        e.dataTransfer.effectAllowed = "copy";
    });
    sidebarPanelComponents.addEventListener("click", e => {
        const t = e.target;
        if (!(t instanceof Element)) {
            return;
        }
        const libBtn = t.closest("[data-library]");
        if (libBtn && currentProject) {
            const libraryId = libBtn.getAttribute("data-library");
            if (libraryId) {
                vscode.postMessage({
                    type: "insertLibraryComponent",
                    pageIndex: currentPageIndex,
                    libraryId
                });
            }
            return;
        }
        const btn = t.closest("[data-widget]");
        if (!btn || !currentProject) {
            return;
        }
        const widgetType = btn.getAttribute("data-widget");
        if (!widgetType) {
            return;
        }
        vscode.postMessage({ type: "addWidget", pageIndex: currentPageIndex, widgetType });
    });
    sidebarPanelComponents.addEventListener("contextmenu", e => {
        const t = e.target;
        if (!(t instanceof Element)) {
            return;
        }
        const libBtn = t.closest("[data-library]");
        if (!libBtn || !currentProject) {
            return;
        }
        const libraryId = libBtn.getAttribute("data-library");
        if (!libraryId) {
            return;
        }
        e.preventDefault();
        const entry = currentProject.componentLibrary?.find(x => x.id === libraryId);
        const label = entry?.name ?? libraryId;
        if (!confirm(`Remove "${label}" from My components?`)) {
            return;
        }
        vscode.postMessage({ type: "removeLibraryEntry", libraryId });
    });
}

function populatePageSelect(pages) {
    if (!pageSelect) {
        return;
    }
    pageSelect.innerHTML = "";
    pages.forEach((p, i) => {
        const opt = document.createElement("option");
        opt.value = String(i);
        opt.textContent = p.name;
        pageSelect.appendChild(opt);
    });
}

renderInspector();

// ── UI helpers ─────────────────────────────────────────────────────────────────
function showLoading(visible) {
    if (loadingOverlay) {
        loadingOverlay.style.display = visible ? "flex" : "none";
    }
}

function showError(message) {
    showLoading(false);
    if (errorOverlay) {
        errorOverlay.style.display = "block";
        errorOverlay.textContent = message;
    }
}

function hideError() {
    if (errorOverlay) {
        errorOverlay.style.display = "none";
        errorOverlay.textContent = "";
    }
}

function setStatus(text) {
    if (statusEl) {
        statusEl.textContent = text;
    }
}

// ── Color helper ───────────────────────────────────────────────────────────────
/**
 * Parse a CSS hex color string (#rgb, #rrggbb, #rrggbbaa) into an lv_color32_t
 * packed as a 32-bit integer (ARGB8888 — A in high byte, B in low byte).
 */
function parseColor(hex) {
    hex = hex.replace("#", "");
    let r, g, b, a = 255;
    if (hex.length === 3) {
        r = parseInt(hex[0] + hex[0], 16);
        g = parseInt(hex[1] + hex[1], 16);
        b = parseInt(hex[2] + hex[2], 16);
    } else if (hex.length === 6) {
        r = parseInt(hex.slice(0, 2), 16);
        g = parseInt(hex.slice(2, 4), 16);
        b = parseInt(hex.slice(4, 6), 16);
    } else if (hex.length === 8) {
        r = parseInt(hex.slice(0, 2), 16);
        g = parseInt(hex.slice(2, 4), 16);
        b = parseInt(hex.slice(4, 6), 16);
        a = parseInt(hex.slice(6, 8), 16);
    } else {
        return 0;
    }
    return ((a << 24) | (r << 16) | (g << 8) | b) >>> 0;
}
