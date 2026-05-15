// @ts-check
/// <reference lib="dom" />
"use strict";

/**
 * EmbeddedFlow Webview — LVGL canvas renderer
 *
 * Communication protocol (host → webview):
 *   { type: "load",  payload: WebviewLoadPayload — optional suppressLoadingSpinner for soft JSON refresh }
 *   { type: "error", message: string }
 *
 * Communication protocol (webview → host):
 *   { type: "ready" }
 *   { type: "log", level: "info"|"warn"|"error", text: string }
 *   { type: "addWidget", pageIndex: number, widgetType: string }
 *   { type: "moveWidget", pageIndex: number, componentId: string, x: number, y: number }
 *   { type: "updateWidget", pageIndex: number, componentId: string, patch: object }
 *   { type: "updatePage", pageIndex: number, patch: object }
 *   { type: "deleteWidget", pageIndex: number, componentId: string }
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
const widgetPalette = document.getElementById("widget-palette");
const canvasContainer = document.getElementById("canvas-container");
const statusEl = document.getElementById("status");
const inspectorEmpty = document.getElementById("inspector-empty");
const inspectorForm = document.getElementById("inspector-form");
const inspectorDelete = document.getElementById("inspector-delete");
const btnUndo = document.getElementById("btn-undo");
const btnRedo = document.getElementById("btn-redo");
const previewZoomSelect = /** @type {HTMLSelectElement | null} */ (
    document.getElementById("preview-zoom")
);
const displayWrapper = document.getElementById("display-wrapper");
/** @type {ReturnType<typeof setTimeout> | null} */
let inspectorDebounce = null;
let inspectorSyncing = false;

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

/**
 * Preview-only rendering (WASM stays at logical panel size).
 * Device bit depth / color format from JSON apply to generated firmware, not here.
 */
/** @type {HTMLCanvasElement | null} 1:1 LVGL framebuffer */
let frameCanvas = null;
/** @type {CanvasRenderingContext2D | null} */
let frameCtx = null;
/** Integer CSS pixels per logical LVGL pixel (1–4). */
let previewZoom = 1;
/** @type {"auto" | 1 | 2 | 3 | 4} */
let previewZoomMode = "auto";
/** @type {ResizeObserver | null} */
let previewLayoutObserver = null;
/** @type {import("../src/types/embf").EmbfProject | null} */
let currentProject = null;
/** @type {string | null} last loaded wasm js uri */
let loadedWasmJsUri = null;

/** `null` = use JSON `project.theme.dark`; otherwise preview-only dark override (e.g. from `set_theme` action). */
let previewDarkOverride = null;

/** Skip duplicate rebuild when `pageSelect.value` is set from code (navigate). */
let pageSelectProgrammatic = false;

/** Active page index (0-based); preserved across project reloads. */
let currentPageIndex = 0;

/** Design mode: select and drag widgets (updates .embf); off = LVGL interaction. */
let designMode = true;

/** @type {string | null} */
let selectedComponentId = null;

/** When true, inspector edits the active page / project theme instead of a widget. */
let inspectorShowingPage = false;

/** @type {{ id: string, pointerX: number, pointerY: number, compX: number, compY: number, absX: number, absY: number, width: number, height: number, previewX: number, previewY: number } | null} */
let dragState = null;

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
window.addEventListener("message", event => {
    const msg = event.data;
    if (msg.type === "load") {
        handleLoad(msg.payload);
    } else if (msg.type === "error") {
        showError(msg.message);
    } else if (msg.type === "historyState") {
        updateHistoryButtons(!!msg.canUndo, !!msg.canRedo);
    }
});

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
        selectedComponentId: selectedComponentId ?? undefined
    });
}

function postRedo() {
    vscode.postMessage({
        type: "redo",
        pageIndex: currentPageIndex,
        selectedComponentId: selectedComponentId ?? undefined
    });
}

if (btnUndo) {
    btnUndo.addEventListener("click", () => postUndo());
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
async function handleLoad(payload) {
    currentProject = payload.project;
    previewDarkOverride = null;
    displayWidth = payload.displayWidth;
    displayHeight = payload.displayHeight;

    /** Same WASM URI + running module → JSON-only rebalance (inspector debounced refresh): skip shimmer. */
    const quietReload =
        !!payload.suppressLoadingSpinner &&
        wasmReady &&
        WasmModule !== null &&
        loadedWasmJsUri !== null &&
        payload.wasmJsUri === loadedWasmJsUri;

    if (!quietReload) {
        showLoading(true);
    }
    hideError();

    updatePreviewZoom();
    applyPreviewLayout();

    // Populate page selector and stay on the current page when possible
    const pages = payload.project.pages;
    const requestedPage =
        typeof payload.pageIndex === "number" && Number.isFinite(payload.pageIndex)
            ? payload.pageIndex
            : currentPageIndex;
    populatePageSelect(pages);
    currentPageIndex = Math.min(Math.max(0, requestedPage), Math.max(0, pages.length - 1));
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

    // Build the UI from the project JSON
    try {
        buildUiFromProject(currentProject, currentPageIndex);
    } catch (e) {
        showError(`UI build error: ${e.message ?? e}`);
        log("error", `UI build error: ${e}`);
        return;
    }

    resizeDesignOverlay();
    setDesignPointerMode();
    if (typeof payload.selectedComponentId === "string" && payload.selectedComponentId) {
        inspectorShowingPage = false;
        const page = currentProject.pages[currentPageIndex];
        selectedComponentId =
            page && findComponentById(page.components, payload.selectedComponentId)
                ? payload.selectedComponentId
                : null;
    }
    drawDesignOverlay();
    renderInspector();

    showLoading(false);
    const disp = currentProject.display;
    const depthHint =
        disp?.bitDepth && disp?.colorFormat
            ? ` · ${disp.bitDepth}-bit ${disp.colorFormat} (device)`
            : "";
    setStatus(
        `${currentProject.project.name} · LVGL ${currentProject.project.lvglVersion} · ${displayWidth}×${displayHeight} · ${previewZoom * 100}%${depthHint}`
    );
    startLoop();
}

// ── Preview display quality (HiDPI + integer zoom; WASM unchanged) ───────────

function getPreviewDpr() {
    return Math.min(Math.max(1, Math.round(window.devicePixelRatio || 1)), 3);
}

function computeAutoZoom() {
    if (!canvasContainer || !displayWidth || !displayHeight) {
        return 1;
    }
    const pad = 24;
    const cw = canvasContainer.clientWidth - pad;
    const ch = canvasContainer.clientHeight - pad;
    if (cw <= 0 || ch <= 0) {
        return 1;
    }
    const zoomX = Math.floor(cw / displayWidth);
    const zoomY = Math.floor(ch / displayHeight);
    return Math.max(1, Math.min(zoomX, zoomY, 4));
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

    if (displayWrapper) {
        displayWrapper.style.width = `${cssW}px`;
        displayWrapper.style.height = `${cssH}px`;
    }
}

function initPreviewLayoutObserver() {
    if (!canvasContainer || previewLayoutObserver) {
        return;
    }
    previewLayoutObserver = new ResizeObserver(() => {
        if (previewZoomMode === "auto") {
            const next = computeAutoZoom();
            if (next !== previewZoom) {
                previewZoom = next;
                applyPreviewLayout();
                drawDesignOverlay();
            }
        }
    });
    previewLayoutObserver.observe(canvasContainer);
}

if (previewZoomSelect) {
    previewZoomSelect.addEventListener("change", () => {
        const raw = previewZoomSelect.value;
        if (raw === "auto") {
            previewZoomMode = "auto";
        } else {
            const n = parseInt(raw, 10);
            previewZoomMode = n >= 1 && n <= 4 ? /** @type {1|2|3|4} */ (n) : 1;
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
            setStatus(
                `${currentProject.project.name} · LVGL ${currentProject.project.lvglVersion} · ${displayWidth}×${displayHeight} · ${previewZoom * 100}%${depthHint}`
            );
        }
    });
}

initPreviewLayoutObserver();

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
function buildUiFromProject(project, pageIndex) {
    if (!wasmReady || !WasmModule) return;
    buildWithEmbfApi(project, pageIndex);
}

function buildWithEmbfApi(project, pageIndex) {
    const wasm = WasmModule;

    applyEmbfThemeFromProject(project);

    wasm._embf_clear_screen();
    const page = project.pages[pageIndex];
    if (!page) return;

    // Reset pointer maps for this screen
    objPtrToId = new Map();
    idToObjPtr = new Map();

    const screenObj = wasm._embf_create_screen();

    if (page.backgroundColor) {
        wasm._embf_obj_set_style_bg_color(screenObj, parseColor(page.backgroundColor));
    }

    for (const comp of page.components) {
        buildComponentEmbf(wasm, comp, screenObj);
    }

    // Register LVGL event callbacks for components that have events defined
    registerPageEvents(wasm, page);

    wasm._embf_load_screen(screenObj);
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

function buildComponentEmbf(wasm, comp, parent) {
    if (comp.hidden) return;
    let obj = 0;
    // obj is tracked below after the switch

    switch (comp.type) {
        case "label": {
            obj = wasm._embf_create_label(parent, comp.x, comp.y, comp.width, comp.height);
            const ptr = wasm.stringToNewUTF8(comp.text ?? "");
            wasm._embf_label_set_text(obj, ptr);
            wasm._free(ptr);
            break;
        }
        case "button": {
            obj = wasm._embf_create_button(parent, comp.x, comp.y, comp.width, comp.height);
            if (comp.label) {
                const ptr = wasm.stringToNewUTF8(comp.label);
                wasm._embf_button_set_label(obj, ptr);
                wasm._free(ptr);
            }
            break;
        }
        case "slider": {
            obj = wasm._embf_create_slider(parent, comp.x, comp.y, comp.width, comp.height);
            wasm._embf_slider_set_range(obj, comp.min, comp.max);
            wasm._embf_slider_set_value(obj, comp.value);
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
            wasm._embf_bar_set_value(obj, comp.value);
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
            wasm._embf_arc_set_value(obj, comp.value);
            break;
        }
        case "checkbox": {
            obj = wasm._embf_create_checkbox(parent, comp.x, comp.y, comp.width, comp.height);
            if (comp.text) {
                const ptr = wasm.stringToNewUTF8(comp.text);
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
                const ptr = wasm.stringToNewUTF8(comp.text);
                wasm._embf_textarea_set_text(obj, ptr);
                wasm._free(ptr);
            }
            if (comp.placeholder) {
                const ptr = wasm.stringToNewUTF8(comp.placeholder);
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

    applyStylesEmbf(wasm, obj, comp.styles ?? {});
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

        if (bufAddr !== 0 && frameCtx && frameCanvas && ctx) {
            const pixels = new Uint8ClampedArray(
                WasmModule.HEAPU8.buffer,
                bufAddr,
                displayWidth * displayHeight * 4
            );
            const imageData = new ImageData(pixels, displayWidth, displayHeight);
            frameCtx.putImageData(imageData, 0, 0);

            const dpr = getPreviewDpr();
            const cssW = displayWidth * previewZoom;
            const cssH = displayHeight * previewZoom;
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.imageSmoothingEnabled = false;
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(
                frameCanvas,
                0,
                0,
                displayWidth,
                displayHeight,
                0,
                0,
                cssW * dpr,
                cssH * dpr
            );
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
            const targetIdx = currentProject.pages.findIndex(p => p.id === action.target);
            if (targetIdx < 0) {
                log("warn", `navigate: page "${action.target}" not found`);
                return;
            }
            currentPageIndex = targetIdx;
            selectedComponentId = null;
            inspectorShowingPage = false;
            dragState = null;
            pageSelectProgrammatic = true;
            try {
                if (pageSelect) {
                    pageSelect.value = String(targetIdx);
                }
                buildUiFromProject(currentProject, targetIdx);
                drawDesignOverlay();
                renderInspector();
            } finally {
                pageSelectProgrammatic = false;
            }
            break;
        }
        case "set_text": {
            const ptr = idToObjPtr.get(action.target);
            if (!ptr) return;
            const strPtr = wasm.stringToNewUTF8(action.text);
            wasm._embf_label_set_text(ptr, strPtr);
            wasm._free(strPtr);
            break;
        }
        case "set_value": {
            const ptr = idToObjPtr.get(action.target);
            if (!ptr) return;
            // Try all value-bearing widgets
            wasm._embf_slider_set_value?.(ptr, action.value);
            wasm._embf_bar_set_value?.(ptr, action.value);
            wasm._embf_arc_set_value?.(ptr, action.value);
            break;
        }
        case "set_checked": {
            const ptr = idToObjPtr.get(action.target);
            if (!ptr) return;
            wasm._embf_switch_set_state?.(ptr, action.checked ? 1 : 0);
            wasm._embf_checkbox_set_state?.(ptr, action.checked ? 1 : 0);
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
    }
}

// ── Design overlay (select / move widgets) ────────────────────────────────────
if (designModeCheck) {
    designMode = designModeCheck.checked;
    designModeCheck.addEventListener("change", () => {
        designMode = designModeCheck.checked;
        if (!designMode) {
            selectedComponentId = null;
            inspectorShowingPage = false;
            dragState = null;
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
 * Hit-test topmost component at display coordinates (children use parent-relative x/y).
 * @returns {{ comp: object, absX: number, absY: number } | null}
 */
function hitTestAt(page, px, py) {
    /** @param {object[]} components @param {number} parentX @param {number} parentY */
    function walk(components, parentX, parentY) {
        for (let i = components.length - 1; i >= 0; i--) {
            const c = components[i];
            const ax = parentX + c.x;
            const ay = parentY + c.y;
            if (px >= ax && px < ax + c.width && py >= ay && py < ay + c.height) {
                if (c.children?.length) {
                    const inner = walk(c.children, ax, ay);
                    if (inner) {
                        return inner;
                    }
                }
                return { comp: c, absX: ax, absY: ay };
            }
        }
        return null;
    }
    return walk(page.components ?? [], 0, 0);
}

/** @returns {{ x: number, y: number, width: number, height: number } | null} */
function getAbsBounds(page, componentId) {
    /** @param {object[]} components @param {number} parentX @param {number} parentY */
    function walk(components, parentX, parentY) {
        for (const c of components ?? []) {
            const ax = parentX + c.x;
            const ay = parentY + c.y;
            if (c.id === componentId) {
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
    let bounds = null;
    if (dragState) {
        bounds = {
            x: dragState.previewX,
            y: dragState.previewY,
            width: dragState.width,
            height: dragState.height
        };
    } else if (inspectorShowingPage) {
        bounds = { x: 0, y: 0, width: displayWidth, height: displayHeight };
    } else if (selectedComponentId) {
        bounds = getAbsBounds(page, selectedComponentId);
    }
    if (!bounds) {
        return;
    }
    designCtx.strokeStyle = "#007acc";
    designCtx.lineWidth = 2;
    designCtx.setLineDash([4, 3]);
    designCtx.strokeRect(bounds.x + 0.5, bounds.y + 0.5, bounds.width, bounds.height);
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

function clearInspectorSelection() {
    selectedComponentId = null;
    inspectorShowingPage = false;
    dragState = null;
    drawDesignOverlay();
    renderInspector();
}

function selectPageInspector() {
    inspectorShowingPage = true;
    selectedComponentId = null;
    dragState = null;
    drawDesignOverlay();
    renderInspector();
}

function setSelection(componentId) {
    inspectorShowingPage = false;
    selectedComponentId = componentId;
    dragState = null;
    drawDesignOverlay();
    renderInspector();
}

/**
 * Full HTML block for inspecting the active page (.embf pages[] entry + project.theme.dark).
 * @param {object} page
 * @param {object} project
 */
function renderPageInspectorHtml(page, project) {
    let html =
        `<div id="inspector-readonly"><strong>${esc(page.id)}</strong> · Page</div>` +
        `<div class="inspector-group-title">Page</div>` +
        fieldText("page_display_name", "Tab / page name", page.name ?? "") +
        `<div class="field"><p style="font-size:11px;color:#888;margin:0 0 8px;line-height:1.35;">Leave background empty so the LVGL default theme (light/dark) sets the screen color.</p></div>` +
        fieldColor("page_backgroundColor", "Screen background (#hex)", page.backgroundColor ?? "") +
        `<div class="inspector-group-title">Project theme</div>` +
        fieldCheck("proj_theme_dark", "Dark mode", !!(project.theme && project.theme.dark));
    return html;
}

function esc(s) {
    return String(s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/"/g, "&quot;");
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

function fieldNum(name, label, value) {
    return `<div class="field"><label>${esc(label)}</label><input type="number" name="${esc(name)}" value="${Number(value)}" step="1" /></div>`;
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

function inspectorAppearancesSection(comp) {
    const st = comp.styles ?? {};
    const align = typeof st.align === "string" ? st.align : "";
    const padHint = "(number or top,left or top,right,bottom,left)";
    let html =
        `<div class="inspector-group-title">Appearance</div>` +
        fieldColor("style_bgColor", "Bg color (#hex)", st.bgColor ?? "") +
        fieldColor("style_indicatorColor", "Indicator color", st.indicatorColor ?? "") +
        fieldNumFloatOpt("style_bgOpacity", "Bg opacity (0–255)", st.bgOpacity, "1") +
        fieldColor("style_textColor", "Text color", st.textColor ?? "") +
        fieldColor("style_borderColor", "Border color", st.borderColor ?? "") +
        `<div class="row2">${fieldNumOpt("style_borderWidth", "Border width", st.borderWidth)}${fieldNumOpt("style_borderRadius", "Corner radius", st.borderRadius)}</div>` +
        `<div class="field"><label>Padding ${esc(padHint)}</label>` +
        `<input type="text" name="style_padding" value="${esc(stylePaddingToLabel(st.padding))}" placeholder="e.g. 8 or 8, 16"></div>` +
        fieldNumOpt("style_fontSize", "Font size (px)", st.fontSize) +
        fieldText("style_fontFamily", "Font family", st.fontFamily ?? "") +
        fieldSelect("style_align", "Text align", [
            { value: "", label: "(default)" },
            { value: "left", label: "Left" },
            { value: "center", label: "Center" },
            { value: "right", label: "Right" }
        ], align);

    html += `<div class="inspector-group-title">Events (JSON)</div>`;
    const evPretty = JSON.stringify(comp.events ?? [], null, 2);
    html += `<div class="field"><label title='JSON array: [{ "trigger", "actions" }]'>Handlers</label><textarea id="inspector-events-json" name="eventsJson" rows="5" spellcheck="false">${esc(evPretty)}</textarea></div>`;
    return html;
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

        if (inspectorFocusSnap) {
            requestAnimationFrame(() => {
                queueMicrotask(() => restoreInspectorFocus(inspectorFocusSnap));
            });
        }
        return;
    }

    const comp =
        selectedComponentId && page
            ? findComponentById(page.components, selectedComponentId)
            : null;
    if (!comp) {
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
    let html = `<div id="inspector-readonly"><strong>${esc(comp.id)}</strong> · ${esc(comp.type)}</div>`;
    html += `<div class="inspector-group-title">Layout</div>`;
    html += `<div class="row2">${fieldNum("x", "X", comp.x)}${fieldNum("y", "Y", comp.y)}</div>`;
    html += `<div class="row2">${fieldNum("width", "Width", comp.width)}${fieldNum("height", "Height", comp.height)}</div>`;
    html += fieldCheck("hidden", "Hidden", !!comp.hidden);

    html += `<div class="inspector-group-title">${esc(comp.type)}</div>`;

    switch (comp.type) {
        case "label":
            html += fieldText("text", "Text", comp.text);
            html += fieldSelect("longMode", "Long mode", [
                { value: "", label: "(default)" },
                { value: "wrap", label: "wrap" },
                { value: "dot", label: "dot" },
                { value: "scroll", label: "scroll" },
                { value: "clip", label: "clip" }
            ], comp.longMode ?? "");
            break;
        case "button":
            html += fieldText("label", "Label text", comp.label);
            break;
        case "image":
            html += fieldText("src", "Source / path", comp.src);
            break;
        case "slider":
            html += `<div class="row2">${fieldFloat("min", "Min", comp.min)}${fieldFloat("max", "Max", comp.max)}</div>`;
            html += fieldFloat("value", "Value", comp.value);
            break;
        case "bar":
            html += `<div class="row2">${fieldFloat("min", "Min", comp.min)}${fieldFloat("max", "Max", comp.max)}</div>`;
            html += fieldFloat("value", "Value", comp.value);
            html += fieldSelect("bar_mode", "Mode", [
                { value: "", label: "(default)" },
                { value: "normal", label: "normal" },
                { value: "symmetrical", label: "symmetrical" },
                { value: "range", label: "range" }
            ], comp.mode ?? "");
            break;
        case "arc":
            html += `<div class="row2">${fieldFloat("min", "Min", comp.min)}${fieldFloat("max", "Max", comp.max)}</div>`;
            html += fieldFloat("value", "Value", comp.value);
            html += `<div class="row2">${fieldFloat("startAngle", "Start °", comp.startAngle)}${fieldFloat("endAngle", "End °", comp.endAngle)}</div>`;
            html += fieldSelect("arc_mode", "Mode", [
                { value: "", label: "(default)" },
                { value: "normal", label: "normal" },
                { value: "reverse", label: "reverse" },
                { value: "symmetrical", label: "symmetrical" }
            ], comp.mode ?? "");
            break;
        case "switch":
            html += fieldCheck("checked", "Checked", !!comp.checked);
            break;
        case "checkbox":
            html += fieldText("text", "Label text", comp.text);
            html += fieldCheck("checked", "Checked", !!comp.checked);
            break;
        case "dropdown":
            html += fieldTextarea("options", "Options (one per line)", (comp.options ?? []).join("\n"));
            html += fieldNum("selectedIndex", "Selected index", comp.selectedIndex ?? 0);
            break;
        case "roller":
            html += fieldTextarea("options", "Options (one per line)", (comp.options ?? []).join("\n"));
            html += fieldNum("selectedIndex", "Selected index", comp.selectedIndex ?? 0);
            html += fieldSelect("roller_mode", "Mode", [
                { value: "", label: "(default)" },
                { value: "normal", label: "normal" },
                { value: "infinite", label: "infinite" }
            ], comp.mode ?? "");
            break;
        case "textarea":
            html += fieldTextarea("textareaText", "Text", comp.text ?? "");
            html += fieldText("placeholder", "Placeholder", comp.placeholder);
            html += fieldCheck("oneLine", "Single line", !!comp.oneLine);
            break;
        case "spinner":
            html += fieldNumFloat("speed", "Speed (ms)", comp.speed ?? 1000, "1");
            html += fieldNumFloat("arcLength", "Arc length (°)", comp.arcLength ?? 60, "1");
            break;
        case "line": {
            const pts = (comp.points ?? [])
                .map(p => `${p.x}, ${p.y}`)
                .join("\n");
            html += fieldTextarea("linePoints", "Points (x,y per line)", pts);
            html += fieldCheck("rounded", "Rounded corners", !!comp.rounded);
            break;
        }
        case "container":
            html += fieldSelect("layout", "Layout", [
                { value: "none", label: "none" },
                { value: "flex", label: "flex" },
                { value: "grid", label: "grid" }
            ], comp.layout ?? "none");
            html += fieldSelect("flexFlow", "Flex flow (flex)", [
                { value: "", label: "(default)" },
                { value: "row", label: "row" },
                { value: "column", label: "column" },
                { value: "row_wrap", label: "row_wrap" },
                { value: "column_wrap", label: "column_wrap" }
            ], comp.flexFlow ?? "");
            html += `<div class="field"><p style="font-size:11px;color:#888;line-height:1.35;margin:0;">Nested widgets: edit JSON or attach from tooling; not listed here.</p></div>`;
            break;
        case "panel":
            html += `<div class="field"><p style="font-size:11px;color:#888;line-height:1.35;margin:0;">Panel holds child widgets. Edit children in the .embf file.</p></div>`;
            break;
        default:
            break;
    }

    html += inspectorAppearancesSection(comp);

    inspectorForm.innerHTML = html;
    inspectorSyncing = false;

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

    const setStr = (id, key) => {
        const el = textInputNamed(id);
        if (!(el instanceof HTMLInputElement)) return;
        const t = el.value.trim();
        s[key] = t === "" ? null : t;
    };

    setStr("style_bgColor", "bgColor");
    setStr("style_indicatorColor", "indicatorColor");
    setStr("style_textColor", "textColor");
    setStr("style_borderColor", "borderColor");
    setStr("style_fontFamily", "fontFamily");

    const sop = inspectorForm.elements.namedItem("style_bgOpacity");
    if (sop instanceof HTMLInputElement) {
        if (sop.value.trim() === "") {
            s.bgOpacity = null;
        } else {
            const v = Number(sop.value);
            s.bgOpacity = Number.isFinite(v) ? Math.min(255, Math.max(0, Math.round(v))) : null;
        }
    }

    const sbw = inspectorForm.elements.namedItem("style_borderWidth");
    if (sbw instanceof HTMLInputElement) {
        if (sbw.value.trim() === "") {
            s.borderWidth = null;
        } else {
            const v = Number(sbw.value);
            s.borderWidth = Number.isFinite(v) ? Math.round(Math.max(0, v)) : null;
        }
    }

    const sbr = inspectorForm.elements.namedItem("style_borderRadius");
    if (sbr instanceof HTMLInputElement) {
        if (sbr.value.trim() === "") {
            s.borderRadius = null;
        } else {
            const v = Number(sbr.value);
            s.borderRadius = Number.isFinite(v) ? Math.round(Math.max(0, v)) : null;
        }
    }

    const sfz = inspectorForm.elements.namedItem("style_fontSize");
    if (sfz instanceof HTMLInputElement) {
        if (sfz.value.trim() === "") {
            s.fontSize = null;
        } else {
            const v = Number(sfz.value);
            const n = Number.isFinite(v) ? Math.round(v) : NaN;
            s.fontSize = n >= 4 ? n : null;
        }
    }

    const spd = inspectorForm.elements.namedItem("style_padding");
    if (spd instanceof HTMLInputElement) {
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
    if (alignEl instanceof HTMLSelectElement) {
        const t = alignEl.value.trim();
        s.align = t === "" ? null : t;
    }

    return s;
}

function readInspectorPatch() {
    if (!inspectorForm) {
        return {};
    }
    /** @type {Record<string, unknown>} */
    const patch = {};
    const num = name => {
        const el = inspectorForm.elements.namedItem(name);
        if (el instanceof HTMLInputElement && el.type === "number") {
            const v = Number(el.value);
            if (Number.isFinite(v)) {
                patch[name] = v;
            }
        }
    };
    const floatOrOmit = name => {
        const el = inspectorForm.elements.namedItem(name);
        if (el instanceof HTMLInputElement && el.type === "number") {
            if (el.value.trim() === "") {
                return;
            }
            const v = Number(el.value);
            if (Number.isFinite(v)) {
                patch[name] = v;
            }
        }
    };
    const chk = name => {
        const el = inspectorForm.elements.namedItem(name);
        if (el instanceof HTMLInputElement && el.type === "checkbox") {
            patch[name] = el.checked;
        }
    };

    num("x");
    num("y");
    num("width");
    num("height");
    chk("hidden");

    const layoutEl = inspectorForm.elements.namedItem("layout");
    if (layoutEl instanceof HTMLSelectElement) {
        patch.layout = layoutEl.value;
    }

    const flexFlowEl = inspectorForm.elements.namedItem("flexFlow");
    if (flexFlowEl instanceof HTMLSelectElement) {
        patch.flexFlow = flexFlowEl.value;
    }

    const longModeEl = inspectorForm.elements.namedItem("longMode");
    if (longModeEl instanceof HTMLSelectElement) {
        patch.longMode = longModeEl.value;
    }

    const barModeEl = inspectorForm.elements.namedItem("bar_mode");
    if (barModeEl instanceof HTMLSelectElement && barModeEl.value !== undefined) {
        patch.mode = barModeEl.value;
    }

    const arcModeEl = inspectorForm.elements.namedItem("arc_mode");
    if (arcModeEl instanceof HTMLSelectElement && arcModeEl.value !== undefined) {
        patch.mode = arcModeEl.value;
    }

    const rollerModeEl = inspectorForm.elements.namedItem("roller_mode");
    if (rollerModeEl instanceof HTMLSelectElement && rollerModeEl.value !== undefined) {
        patch.mode = rollerModeEl.value;
    }

    const optionsEl = inspectorForm.elements.namedItem("options");
    if (optionsEl instanceof HTMLTextAreaElement) {
        patch.options = optionsEl.value
            .split("\n")
            .map(s => s.trim())
            .filter(Boolean);
    }

    const linePtsEl = inspectorForm.elements.namedItem("linePoints");
    if (linePtsEl instanceof HTMLTextAreaElement) {
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

    chk("rounded");

    const taTextEl = inspectorForm.elements.namedItem("textareaText");
    if (taTextEl instanceof HTMLTextAreaElement) {
        patch.text = taTextEl.value;
    } else {
        const textEl = inspectorForm.elements.namedItem("text");
        if (textEl instanceof HTMLInputElement) {
            patch.text = textEl.value;
        }
    }

    chk("oneLine");

    const phEl = inspectorForm.elements.namedItem("placeholder");
    if (phEl instanceof HTMLInputElement) {
        patch.placeholder = phEl.value;
    }

    const labelEl = inspectorForm.elements.namedItem("label");
    if (labelEl instanceof HTMLInputElement) {
        patch.label = labelEl.value;
    }

    const srcEl = inspectorForm.elements.namedItem("src");
    if (srcEl instanceof HTMLInputElement) {
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
    if (selIdx instanceof HTMLInputElement && selIdx.type === "number" && selIdx.value.trim() !== "") {
        const v = Number(selIdx.value);
        if (Number.isFinite(v)) {
            patch.selectedIndex = Math.round(v);
        }
    }

    chk("checked");

    patch.styles = buildStyleSnapshotFromInspector();

    const evEl = inspectorForm.elements.namedItem("eventsJson");
    if (evEl instanceof HTMLTextAreaElement) {
        try {
            const parsed = JSON.parse(evEl.value);
            if (Array.isArray(parsed)) {
                patch.events = parsed;
            }
        } catch {
            /* invalid JSON: omit — write will keep prior file if host blocks */
        }
    }

    return patch;
}

/** Build patch object for Page inspector (page name, bg, theme.dark). */
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

    const d = inspectorForm.elements.namedItem("proj_theme_dark");
    if (d instanceof HTMLInputElement) {
        patch.themeDark = d.checked;
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

    if (!selectedComponentId) {
        return;
    }
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
        if (inspectorDebounce) {
            clearTimeout(inspectorDebounce);
        }
        inspectorDebounce = setTimeout(() => {
            inspectorDebounce = null;
            commitInspector();
        }, 450);
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
}

if (inspectorDelete) {
    inspectorDelete.addEventListener("click", () => {
        if (!selectedComponentId) {
            return;
        }
        vscode.postMessage({
            type: "deleteWidget",
            pageIndex: currentPageIndex,
            componentId: selectedComponentId
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
    if (e.key === "Escape") {
        clearInspectorSelection();
        return;
    }
    if ((e.key === "Delete" || e.key === "Backspace") && selectedComponentId) {
        const t = e.target;
        if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement) {
            return;
        }
        e.preventDefault();
        vscode.postMessage({
            type: "deleteWidget",
            pageIndex: currentPageIndex,
            componentId: selectedComponentId
        });
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
        const hit = hitTestAt(page, x, y);
        if (!hit) {
            selectPageInspector();
            return;
        }
        inspectorShowingPage = false;
        selectedComponentId = hit.comp.id;
        dragState = {
            id: hit.comp.id,
            pointerX: x,
            pointerY: y,
            compX: hit.comp.x,
            compY: hit.comp.y,
            absX: hit.absX,
            absY: hit.absY,
            previewX: hit.absX,
            previewY: hit.absY,
            width: hit.comp.width,
            height: hit.comp.height
        };
        drawDesignOverlay();
        renderInspector();
        e.preventDefault();
    });

    designOverlay.addEventListener("pointermove", e => {
        if (!designMode || !dragState) {
            return;
        }
        const { x, y } = overlayCoords(e);
        const dx = x - dragState.pointerX;
        const dy = y - dragState.pointerY;
        dragState.previewX = dragState.absX + dx;
        dragState.previewY = dragState.absY + dy;
        drawDesignOverlay();
        e.preventDefault();
    });

    designOverlay.addEventListener("pointerup", e => {
        if (!designMode || !dragState || !currentProject) {
            try {
                designOverlay.releasePointerCapture(e.pointerId);
            } catch {
                /* ignore */
            }
            return;
        }
        const { x, y } = overlayCoords(e);
        const dx = x - dragState.pointerX;
        const dy = y - dragState.pointerY;
        const moved = Math.abs(dx) > 2 || Math.abs(dy) > 2;
        if (moved) {
            const newX = Math.max(0, Math.round(dragState.compX + dx));
            const newY = Math.max(0, Math.round(dragState.compY + dy));
            vscode.postMessage({
                type: "moveWidget",
                pageIndex: currentPageIndex,
                componentId: dragState.id,
                x: newX,
                y: newY
            });
        }
        dragState = null;
        drawDesignOverlay();
        renderInspector();
        try {
            designOverlay.releasePointerCapture(e.pointerId);
        } catch {
            /* ignore */
        }
        e.preventDefault();
    });

    designOverlay.addEventListener("pointercancel", e => {
        dragState = null;
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
if (canvas) {
    canvas.addEventListener("pointerdown", e => {
        canvas.setPointerCapture(e.pointerId);
        sendPointer(e, true, 4);
    });
    canvas.addEventListener("pointermove", e => {
        const drag = e.buttons > 0;
        sendPointer(e, drag, drag ? 1 : 0);
    });
    canvas.addEventListener("pointerup", e => {
        sendPointer(e, false, 4);
        try {
            canvas.releasePointerCapture(e.pointerId);
        } catch {
            /* ignore if not captured */
        }
    });
    canvas.addEventListener("pointercancel", e => {
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
    const rect = canvas.getBoundingClientRect();
    const scaleX = displayWidth / rect.width;
    const scaleY = displayHeight / rect.height;
    const x = Math.round((e.clientX - rect.left) * scaleX);
    const y = Math.round((e.clientY - rect.top) * scaleY);
    const fn = WasmModule._embf_on_pointer ?? WasmModule._onPointerEvent;
    fn?.(x, y, pressed ? 1 : 0);
    /* pumpLevel: 0 = none (rely on rAF), 1 = light tick while dragging, 4 = press/release (CLICKED) */
    if (pumpLevel > 0) {
        pumpLvglAfterPointer(pumpLevel);
    }
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

// ── Page selector ─────────────────────────────────────────────────────────────
if (pageSelect) {
    pageSelect.addEventListener("change", () => {
        if (!currentProject || pageSelectProgrammatic) return;
        const idx = parseInt(pageSelect.value, 10) || 0;
        currentPageIndex = idx;
        selectedComponentId = null;
        inspectorShowingPage = true;
        dragState = null;
        buildUiFromProject(currentProject, idx);
        drawDesignOverlay();
        renderInspector();
    });
}

if (widgetPalette) {
    widgetPalette.addEventListener("click", e => {
        const t = e.target;
        if (!(t instanceof Element)) {
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

// Notify host only after listeners are registered (host queues project until this).
if (!canvas) {
    log("error", "Preview DOM missing #lvgl-canvas — reload the window");
}
renderInspector();
vscode.postMessage({ type: "ready" });

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
