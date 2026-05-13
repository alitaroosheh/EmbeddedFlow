// @ts-check
/// <reference lib="dom" />
"use strict";

/**
 * EmbeddedFlow Webview — LVGL canvas renderer
 *
 * Communication protocol (host → webview):
 *   { type: "load",  payload: WebviewLoadPayload }
 *   { type: "error", message: string }
 *
 * Communication protocol (webview → host):
 *   { type: "ready" }
 *   { type: "log", level: "info"|"warn"|"error", text: string }
 */

// ── VSCode API ────────────────────────────────────────────────────────────────
const vscode = acquireVsCodeApi();

function log(level, text) {
    vscode.postMessage({ type: "log", level, text });
}

// ── DOM refs ──────────────────────────────────────────────────────────────────
const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById("lvgl-canvas"));
const ctx = canvas.getContext("2d");
const errorOverlay = document.getElementById("error-overlay");
const loadingOverlay = document.getElementById("loading-overlay");
const pageSelect = document.getElementById("page-select");
const statusEl = document.getElementById("status");

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
/** @type {import("../src/types/embf").EmbfProject | null} */
let currentProject = null;
/** @type {string | null} last loaded wasm js uri */
let loadedWasmJsUri = null;

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

/** LVGL event codes (LVGL 9.x) */
const LV_EVENT_CLICKED       = 7;
const LV_EVENT_LONG_PRESSED  = 5;
const LV_EVENT_VALUE_CHANGED = 30;

// ── Entry point ────────────────────────────────────────────────────────────────
window.addEventListener("message", event => {
    const msg = event.data;
    if (msg.type === "load") {
        handleLoad(msg.payload);
    } else if (msg.type === "error") {
        showError(msg.message);
    }
});

vscode.postMessage({ type: "ready" });

// ── Load handler ───────────────────────────────────────────────────────────────
async function handleLoad(payload) {
    currentProject = payload.project;
    displayWidth = payload.displayWidth;
    displayHeight = payload.displayHeight;

    showLoading(true);
    hideError();

    // Resize canvas
    canvas.width = displayWidth;
    canvas.height = displayHeight;

    // Populate page selector
    populatePageSelect(payload.project.pages);

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
        buildUiFromProject(currentProject, 0);
    } catch (e) {
        showError(`UI build error: ${e.message ?? e}`);
        log("error", `UI build error: ${e}`);
        return;
    }

    showLoading(false);
    setStatus(`${currentProject.project.name} · LVGL ${currentProject.project.lvglVersion} · ${displayWidth}×${displayHeight}`);
    startLoop();
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

        if (bufAddr !== 0) {
            const pixels = new Uint8ClampedArray(
                WasmModule.HEAPU8.buffer,
                bufAddr,
                displayWidth * displayHeight * 4
            );
            const imageData = new ImageData(pixels, displayWidth, displayHeight);
            ctx.putImageData(imageData, 0, 0);
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

        const pageIndex = parseInt(pageSelect.value, 10) || 0;
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
            pageSelect.value = String(targetIdx);
            buildUiFromProject(currentProject, targetIdx);
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
    }
}

// ── Input forwarding ───────────────────────────────────────────────────────────
canvas.addEventListener("pointerdown", e => {
    canvas.setPointerCapture(e.pointerId);
    sendPointer(e, true);
});
canvas.addEventListener("pointermove", e => sendPointer(e, e.buttons > 0));
canvas.addEventListener("pointerup",   e => sendPointer(e, false));
canvas.addEventListener("pointercancel", e => sendPointer(e, false));

canvas.addEventListener("wheel", e => {
    e.preventDefault();
    if (!wasmReady || !WasmModule) return;
    const delta = Math.sign(e.deltaY);
    const fn = WasmModule._embf_on_wheel ?? WasmModule._onMouseWheelEvent;
    fn?.(delta, 0);
}, { passive: false });

canvas.addEventListener("keydown", e => {
    if (!wasmReady || !WasmModule) return;
    const fn = WasmModule._embf_on_key ?? WasmModule._onKeyPressed;
    fn?.(e.key.charCodeAt(0));
});

function sendPointer(e, pressed) {
    if (!wasmReady || !WasmModule) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = displayWidth / rect.width;
    const scaleY = displayHeight / rect.height;
    const x = Math.round((e.clientX - rect.left) * scaleX);
    const y = Math.round((e.clientY - rect.top) * scaleY);
    const fn = WasmModule._embf_on_pointer ?? WasmModule._onPointerEvent;
    fn?.(x, y, pressed ? 1 : 0);
}

// ── Page selector ─────────────────────────────────────────────────────────────
pageSelect.addEventListener("change", () => {
    if (!currentProject) return;
    const idx = parseInt(pageSelect.value, 10);
    buildUiFromProject(currentProject, idx);
});

function populatePageSelect(pages) {
    pageSelect.innerHTML = "";
    pages.forEach((p, i) => {
        const opt = document.createElement("option");
        opt.value = String(i);
        opt.textContent = p.name;
        pageSelect.appendChild(opt);
    });
}

// ── UI helpers ─────────────────────────────────────────────────────────────────
function showLoading(visible) {
    loadingOverlay.style.display = visible ? "flex" : "none";
}

function showError(message) {
    showLoading(false);
    errorOverlay.style.display = "block";
    errorOverlay.textContent = message;
}

function hideError() {
    errorOverlay.style.display = "none";
    errorOverlay.textContent = "";
}

function setStatus(text) {
    statusEl.textContent = text;
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
