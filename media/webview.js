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

    WasmModule._embf_init(width, height, darkTheme ? 1 : 0);
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

    const screenObj = wasm._embf_create_screen();
    for (const comp of page.components) {
        buildComponentEmbf(wasm, comp, screenObj);
    }
    wasm._embf_load_screen(screenObj);
}

function buildComponentEmbf(wasm, comp, parent) {
    if (comp.hidden) return;
    let obj = 0;

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
