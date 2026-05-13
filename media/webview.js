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
 * Dynamically loads the Emscripten JS glue + wasm binary.
 * The lvgl_runtime_v*.js files expose a factory function as `Module` or as
 * the default export. We detect and call whichever form is present.
 */
async function loadWasm(jsUri, wasmBinUri, width, height, darkTheme) {
    return new Promise((resolve, reject) => {
        // The Emscripten bundle expects `locateFile` to find the .wasm binary.
        // We inject a global config before the script runs.
        window.__embf_wasm_bin_uri = wasmBinUri;
        window.__embf_resolve = resolve;
        window.__embf_reject = reject;
        window.__embf_width = width;
        window.__embf_height = height;
        window.__embf_dark = darkTheme ? 1 : 0;

        // Remove previously injected script if any
        const old = document.getElementById("__embf_wasm_script");
        if (old) old.remove();

        const script = document.createElement("script");
        script.id = "__embf_wasm_script";
        script.src = jsUri;
        script.onload = () => {
            // After the Emscripten glue loads, call the factory
            _initWasmModule().catch(reject);
        };
        script.onerror = () => reject(new Error(`Failed to load script: ${jsUri}`));
        document.head.appendChild(script);
    });
}

async function _initWasmModule() {
    const width = window.__embf_width;
    const height = window.__embf_height;
    const dark = window.__embf_dark;

    // EEZ LVGL runtime bundles export their factory via window.EEZStudio or as
    // a global `createEezWasmRuntime` / `Module` style factory.
    // We need to find the factory function. Emscripten modules typically set
    // `Module` or export a named factory. EEZ uses a self-executing pattern.
    // The bundle assigns itself to `self.EEZStudio` / `self.WasmFlowRuntime`.
    // We'll try common names.
    let factory = window.createEmbfRuntime
        ?? window.EEZStudio?.wasmFactory
        ?? window.Module;

    if (typeof factory !== "function") {
        // Some Emscripten output directly calls the factory and assigns to Module
        factory = window.Module;
    }

    if (typeof factory !== "function") {
        throw new Error("WASM module factory not found. The bundle may use a different export name.");
    }

    const wasmBinUri = window.__embf_wasm_bin_uri;

    const module = await factory({
        locateFile(file) {
            if (file.endsWith(".wasm")) {
                return wasmBinUri;
            }
            return file;
        },
        onRuntimeInitialized() {
            // called by Emscripten when WASM is ready
        }
    });

    WasmModule = module;

    // Initialize LVGL via the EEZ _init or our own embf_init
    if (typeof WasmModule._embf_init === "function") {
        // Custom EmbeddedFlow WASM
        WasmModule._embf_init(width, height, dark);
    } else if (typeof WasmModule._init === "function") {
        // EEZ LVGL WASM — call with minimal assets
        const minimalAssets = buildMinimalAssets();
        const ptr = WasmModule._malloc(minimalAssets.length);
        WasmModule.HEAPU8.set(minimalAssets, ptr);
        WasmModule._init(
            0,          // wasmModuleId
            0,          // debugger filter (none)
            ptr,
            minimalAssets.length,
            width,
            height,
            dark,
            -(new Date().getTimezoneOffset() / 60) * 100,
            0           // screensLifetimeSupport
        );
        WasmModule._free(ptr);
    } else {
        throw new Error("WASM does not export _embf_init or _init — unknown runtime format.");
    }

    wasmReady = true;
    window.__embf_resolve?.();
}

/**
 * Builds a minimal valid EEZ assets binary that satisfies the WASM _init call
 * but contains no pages, styles, fonts, or bitmaps.
 *
 * Format (uncompressed):
 *   packRegions(5):
 *     region 0 (document):  minimal document struct (0 pages, 0 actions, 0 vars)
 *     regions 1-4 (styles/fonts/bitmaps/colors): empty
 *
 * The compressed blob header:  [uint32 LE uncompressed size] + [lz4 compressed]
 * Since we can't run LZ4 here easily, we write the blob UNCOMPRESSED with a
 * sentinel header that the C side interprets as "already decompressed".
 * The EEZ C runtime reads the first 4 bytes as uncompressed size, then LZ4-
 * decompresses. We exploit that LZ4_decompress_safe with src == dst is valid
 * when uncompressed size == compressed size (i.e. we fake it as a stored block).
 *
 * Simpler: pass size=0 assets and let the WASM handle an empty project gracefully.
 */
function buildMinimalAssets() {
    // 5 regions, each with offset pointing past the header (5×4 = 20 bytes)
    // All regions are empty, so all offsets == 20
    const numRegions = 5;
    const headerSize = numRegions * 4;

    // Minimal document region: a struct with 3 uint32 fields all 0
    // (numPages, numActions, numGlobalVariables)
    const docSize = 3 * 4; // 12 bytes
    const uncompressedSize = headerSize + docSize;

    const buf = new Uint8Array(4 + uncompressedSize);
    const view = new DataView(buf.buffer);

    // First 4 bytes: uncompressed size (written as LE uint32)
    view.setUint32(0, uncompressedSize, true);

    // Offsets for 5 regions (all point to right after the header)
    // Region 0 (document) starts at headerSize (= 20)
    view.setUint32(4 + 0 * 4, headerSize, true);
    // Regions 1-4 all empty, point to end of document region
    const endOfDoc = headerSize + docSize;
    view.setUint32(4 + 1 * 4, endOfDoc, true);
    view.setUint32(4 + 2 * 4, endOfDoc, true);
    view.setUint32(4 + 3 * 4, endOfDoc, true);
    view.setUint32(4 + 4 * 4, endOfDoc, true);

    // Document region: 3 uint32 zeros (0 pages, 0 actions, 0 global vars)
    // (already zeroed by Uint8Array constructor)

    return buf;
}

// ── UI Builder ─────────────────────────────────────────────────────────────────
/**
 * Build LVGL objects from the .embf project JSON by calling raw lv_* functions
 * exported from the WASM module.
 */
function buildUiFromProject(project, pageIndex) {
    if (!wasmReady || !WasmModule) return;

    // If our custom WASM, use the embf_* API
    if (typeof WasmModule._embf_clear_screen === "function") {
        buildWithEmbfApi(project, pageIndex);
    } else {
        buildWithLvglApi(project, pageIndex);
    }
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

/**
 * Fallback: use raw lv_* WASM exports (available in the EEZ LVGL WASM).
 * After _init with minimal assets, lv_scr_act() returns the default screen.
 */
function buildWithLvglApi(project, pageIndex) {
    const wasm = WasmModule;
    const page = project.pages[pageIndex];
    if (!page) return;

    // Clean up previous objects by deleting children of current screen
    if (typeof wasm._lv_obj_clean === "function") {
        const screen = wasm._lv_scr_act?.() ?? 0;
        if (screen) wasm._lv_obj_clean(screen);
    }

    const screen = wasm._lv_scr_act?.() ?? 0;

    for (const comp of page.components) {
        buildComponentLvgl(wasm, comp, screen);
    }
}

function buildComponentLvgl(wasm, comp, parent) {
    if (comp.hidden || !parent) return;
    let obj = 0;

    const allocStr = (s) => wasm.stringToNewUTF8 ? wasm.stringToNewUTF8(s) : 0;

    switch (comp.type) {
        case "label":
            if (typeof wasm._lv_label_create !== "function") break;
            obj = wasm._lv_label_create(parent);
            if (obj && comp.text) {
                const ptr = allocStr(comp.text);
                if (ptr && typeof wasm._lv_label_set_text === "function") {
                    wasm._lv_label_set_text(obj, ptr);
                    wasm._free(ptr);
                }
            }
            break;
        case "button":
            if (typeof wasm._lv_button_create === "function") {
                obj = wasm._lv_button_create(parent);
            } else if (typeof wasm._lv_btn_create === "function") {
                obj = wasm._lv_btn_create(parent);
            }
            if (obj && comp.label) {
                let lbl = 0;
                if (typeof wasm._lv_label_create === "function") {
                    lbl = wasm._lv_label_create(obj);
                    const ptr = allocStr(comp.label);
                    if (ptr && typeof wasm._lv_label_set_text === "function") {
                        wasm._lv_label_set_text(lbl, ptr);
                        wasm._free(ptr);
                    }
                }
            }
            break;
        case "slider":
            if (typeof wasm._lv_slider_create !== "function") break;
            obj = wasm._lv_slider_create(parent);
            if (obj) {
                wasm._lv_slider_set_range?.(obj, comp.min, comp.max);
                wasm._lv_slider_set_value?.(obj, comp.value, 0); // LV_ANIM_OFF = 0
            }
            break;
        case "bar":
            if (typeof wasm._lv_bar_create !== "function") break;
            obj = wasm._lv_bar_create(parent);
            if (obj) {
                wasm._lv_bar_set_range?.(obj, comp.min, comp.max);
                wasm._lv_bar_set_value?.(obj, comp.value, 0);
            }
            break;
        case "switch":
            if (typeof wasm._lv_switch_create !== "function") break;
            obj = wasm._lv_switch_create(parent);
            if (obj && comp.checked) {
                wasm._lv_obj_add_state?.(obj, 0x0001); // LV_STATE_CHECKED
            }
            break;
        case "spinner":
            if (typeof wasm._lv_spinner_create !== "function") break;
            obj = wasm._lv_spinner_create(parent, comp.speed ?? 1000, comp.arcLength ?? 60);
            break;
        case "arc":
            if (typeof wasm._lv_arc_create !== "function") break;
            obj = wasm._lv_arc_create(parent);
            if (obj) {
                wasm._lv_arc_set_range?.(obj, comp.min, comp.max);
                wasm._lv_arc_set_value?.(obj, comp.value);
            }
            break;
        case "container":
        case "panel":
            if (typeof wasm._lv_obj_create !== "function") break;
            obj = wasm._lv_obj_create(parent);
            for (const child of comp.children ?? []) {
                buildComponentLvgl(wasm, child, obj);
            }
            break;
        default:
            log("warn", `Unsupported component for LVGL API: ${comp.type}`);
            return;
    }

    if (obj && parent) {
        wasm._lv_obj_set_pos?.(obj, comp.x, comp.y);
        wasm._lv_obj_set_size?.(obj, comp.width, comp.height);
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
