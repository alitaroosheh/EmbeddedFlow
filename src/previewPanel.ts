import * as vscode from "vscode";
import * as path from "path";
import { EmbfProject } from "./types/embf";
import { buildWidgetPaletteHtml } from "./embfPaletteIcons";
import { EmbfParseError, getEffectiveDisplaySize } from "./embfParser";
import { deleteWidgetFromEmbfFile, moveWidgetInEmbfFile, updateWidgetInEmbfFile } from "./embfComponentEdit";
import { readEmbfProject } from "./embfProjectWrite";
import { appendWidgetToEmbfFile } from "./embfWidgetInsert";
import { embeddedFlowLog } from "./outputLog";

// Messages sent from extension host → webview
export type HostToWebviewMessage =
    | { type: "load"; payload: WebviewLoadPayload }
    | { type: "error"; message: string };

// Messages sent from webview → extension host
export type WebviewToHostMessage =
    | { type: "ready" }
    | { type: "log"; level: "info" | "warn" | "error"; text: string }
    | { type: "addWidget"; pageIndex: number; widgetType: string }
    | { type: "moveWidget"; pageIndex: number; componentId: string; x: number; y: number }
    | { type: "updateWidget"; pageIndex: number; componentId: string; patch: Record<string, unknown> }
    | { type: "deleteWidget"; pageIndex: number; componentId: string };

export interface WebviewLoadPayload {
    project: EmbfProject;
    displayWidth: number;
    displayHeight: number;
    wasmJsUri: string;
    wasmBinUri: string;
    /** When set, preview stays on this page after reload (0-based). */
    pageIndex?: number;
    /** When set, re-select this component after reload. */
    selectedComponentId?: string;
}

export class EmbfPreviewPanel {
    static readonly viewType = "embeddedflow.preview";

    private static _panels = new Map<string, EmbfPreviewPanel>();

    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _filePath: string;
    private _disposables: vscode.Disposable[] = [];
    /** False until the webview script posts `{ type: "ready" }`. */
    private _webviewReady = false;
    /** Last load/error held until the webview is ready (avoids lost `postMessage`). */
    private _pendingMessage: HostToWebviewMessage | null = null;

    static createOrShow(filePath: string, extensionUri: vscode.Uri): EmbfPreviewPanel {
        const existing = EmbfPreviewPanel._panels.get(filePath);
        if (existing) {
            existing._panel.reveal(vscode.ViewColumn.Beside);
            return existing;
        }

        const panel = vscode.window.createWebviewPanel(
            EmbfPreviewPanel.viewType,
            `Preview: ${path.basename(filePath)}`,
            vscode.ViewColumn.Beside,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [vscode.Uri.joinPath(extensionUri, "media")]
            }
        );

        const instance = new EmbfPreviewPanel(panel, filePath, extensionUri);
        EmbfPreviewPanel._panels.set(filePath, instance);
        return instance;
    }

    static getPanel(filePath: string): EmbfPreviewPanel | undefined {
        return EmbfPreviewPanel._panels.get(filePath);
    }

    private constructor(
        panel: vscode.WebviewPanel,
        filePath: string,
        extensionUri: vscode.Uri
    ) {
        this._panel = panel;
        this._filePath = filePath;
        this._extensionUri = extensionUri;

        this._panel.webview.html = this._buildHtml();

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        this._panel.webview.onDidReceiveMessage(
            (msg: WebviewToHostMessage) => this._onWebviewMessage(msg),
            null,
            this._disposables
        );
    }

    private postToWebview(msg: HostToWebviewMessage): void {
        if (this._webviewReady) {
            void this._panel.webview.postMessage(msg);
        } else {
            this._pendingMessage = msg;
        }
    }

    sendProject(project: EmbfProject, pageIndex?: number, selectedComponentId?: string): void {
        const { width, height } = getEffectiveDisplaySize(project);

        // Always use the custom embf_runtime (supports LVGL 9.5.0).
        // When multi-version WASM builds are available, switch here.
        const wasmJsUri  = this._webviewUri("wasm", "embf_runtime.js").toString();
        const wasmBinUri = this._webviewUri("wasm", "embf_runtime.wasm").toString();

        this.postToWebview({
            type: "load",
            payload: {
                project,
                displayWidth: width,
                displayHeight: height,
                wasmJsUri,
                wasmBinUri,
                pageIndex,
                selectedComponentId
            }
        });
    }

    sendError(message: string): void {
        this.postToWebview({ type: "error", message });
    }

    updateTitle(fileName: string): void {
        this._panel.title = `Preview: ${fileName}`;
    }

    private _onWebviewMessage(msg: WebviewToHostMessage): void {
        if (msg.type === "log") {
            embeddedFlowLog("webview", msg.level, msg.text);
        } else if (msg.type === "ready") {
            embeddedFlowLog("webview", "info", "preview webview ready");
            this._webviewReady = true;
            if (this._pendingMessage) {
                const pending = this._pendingMessage;
                this._pendingMessage = null;
                void this._panel.webview.postMessage(pending);
            }
        } else if (msg.type === "addWidget") {
            const pageIndex = Number(msg.pageIndex);
            const widgetType = String(msg.widgetType ?? "").trim();
            if (!Number.isInteger(pageIndex) || pageIndex < 0 || !widgetType) {
                return;
            }
            void appendWidgetToEmbfFile(this._filePath, pageIndex, widgetType).then(ok => {
                if (ok) {
                    this.reloadPreview(pageIndex);
                }
            });
        } else if (msg.type === "moveWidget") {
            const pageIndex = Number(msg.pageIndex);
            const componentId = String(msg.componentId ?? "").trim();
            const x = Number(msg.x);
            const y = Number(msg.y);
            if (!Number.isInteger(pageIndex) || pageIndex < 0 || !componentId || !Number.isFinite(x) || !Number.isFinite(y)) {
                return;
            }
            void moveWidgetInEmbfFile(this._filePath, pageIndex, componentId, x, y).then(ok => {
                if (ok) {
                    this.reloadPreview(pageIndex, componentId);
                }
            });
        } else if (msg.type === "updateWidget") {
            const pageIndex = Number(msg.pageIndex);
            const componentId = String(msg.componentId ?? "").trim();
            const patch = msg.patch;
            if (
                !Number.isInteger(pageIndex) ||
                pageIndex < 0 ||
                !componentId ||
                !patch ||
                typeof patch !== "object"
            ) {
                return;
            }
            void updateWidgetInEmbfFile(this._filePath, pageIndex, componentId, patch).then(ok => {
                if (ok) {
                    this.reloadPreview(pageIndex, componentId);
                }
            });
        } else if (msg.type === "deleteWidget") {
            const pageIndex = Number(msg.pageIndex);
            const componentId = String(msg.componentId ?? "").trim();
            if (!Number.isInteger(pageIndex) || pageIndex < 0 || !componentId) {
                return;
            }
            void deleteWidgetFromEmbfFile(this._filePath, pageIndex, componentId).then(ok => {
                if (ok) {
                    this.reloadPreview(pageIndex);
                }
            });
        }
    }

    private reloadPreview(pageIndex: number, selectedComponentId?: string): void {
        try {
            const project = readEmbfProject(this._filePath);
            this.sendProject(project, pageIndex, selectedComponentId);
        } catch (e) {
            const m = e instanceof EmbfParseError ? e.message : String(e);
            embeddedFlowLog("preview", "warn", `refresh preview: ${m}`);
        }
    }

    private _webviewUri(...segments: string[]): vscode.Uri {
        return this._panel.webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, "media", ...segments)
        );
    }

    private _buildHtml(): string {
        const webviewJsUri = this._webviewUri("webview.js");
        const faviconUri = this._webviewUri("erminity-mark.png").toString();
        const nonce = getNonce();

        // CSP: nonce for inline scripts, cspSource for extension-hosted scripts/wasm
        const csp = [
            `default-src 'none'`,
            `script-src 'nonce-${nonce}' 'wasm-unsafe-eval' ${this._panel.webview.cspSource}`,
            `style-src 'unsafe-inline'`,
            `img-src data: ${this._panel.webview.cspSource}`,
            `connect-src ${this._panel.webview.cspSource}`,
            `worker-src blob:`
        ].join("; ");

        return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="${csp}" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="icon" type="image/png" href="${faviconUri}" />
    <title>EmbeddedFlow Preview</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            background: #1e1e1e;
            color: #ccc;
            font-family: var(--vscode-font-family, sans-serif);
            font-size: 13px;
            display: flex;
            flex-direction: column;
            height: 100vh;
            overflow: hidden;
        }
        #toolbar {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 6px 10px;
            background: #252526;
            border-bottom: 1px solid #3c3c3c;
            flex-shrink: 0;
        }
        #toolbar select {
            background: #3c3c3c;
            color: #ccc;
            border: 1px solid #555;
            padding: 2px 6px;
            font-size: 12px;
            border-radius: 3px;
        }
        #toolbar label { font-size: 12px; color: #999; }
        #status {
            margin-left: auto;
            font-size: 11px;
            color: #888;
        }
        #main {
            flex: 1;
            display: flex;
            min-height: 0;
            overflow: hidden;
        }
        #widget-palette {
            flex-shrink: 0;
            width: 52px;
            order: 1;
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 4px;
            padding: 8px 6px;
            background: #252526;
            border-right: 1px solid #3c3c3c;
            overflow-y: auto;
            overflow-x: hidden;
        }
        #widget-palette .palette-item {
            display: flex;
            align-items: center;
            justify-content: center;
            width: 36px;
            height: 36px;
            padding: 0;
            border: 1px solid transparent;
            border-radius: 6px;
            background: transparent;
            color: #bbb;
            cursor: pointer;
        }
        #widget-palette .palette-item:hover {
            background: #3c3c3c;
            color: #fff;
            border-color: #555;
        }
        #widget-palette .palette-item:active {
            background: #094771;
            border-color: #007acc;
            color: #fff;
        }
        #widget-palette .palette-item svg {
            width: 20px;
            height: 20px;
            pointer-events: none;
        }
        #property-inspector {
            flex: 0 0 220px;
            width: 220px;
            min-width: 220px;
            max-width: 220px;
            display: flex;
            flex-direction: column;
            background: #252526;
            border-left: 1px solid #3c3c3c;
            overflow: hidden;
            order: 3;
        }
        #inspector-body {
            flex: 1;
            min-height: 240px;
            overflow-y: auto;
            padding: 0 12px 8px;
        }
        #property-inspector h2 {
            font-size: 11px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.04em;
            color: #999;
            padding: 10px 12px 6px;
        }
        #inspector-empty {
            font-size: 12px;
            color: #888;
            line-height: 1.4;
            padding: 4px 0 12px;
        }
        #inspector-empty[hidden] {
            display: none;
        }
        #inspector-form {
            display: block;
        }
        #inspector-form[hidden] {
            display: none;
        }
        #inspector-form .field {
            margin-bottom: 10px;
        }
        #inspector-form label {
            display: block;
            font-size: 11px;
            color: #999;
            margin-bottom: 3px;
        }
        #inspector-form input[type="text"],
        #inspector-form input[type="number"],
        #inspector-form textarea,
        #inspector-form select {
            width: 100%;
            background: #3c3c3c;
            color: #ccc;
            border: 1px solid #555;
            border-radius: 3px;
            padding: 4px 6px;
            font-size: 12px;
            font-family: inherit;
        }
        #inspector-form textarea {
            min-height: 56px;
            resize: vertical;
        }
        #inspector-form .row2 {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 6px;
        }
        #inspector-form .check-row {
            display: flex;
            align-items: center;
            gap: 6px;
        }
        #inspector-form .check-row input {
            width: auto;
        }
        #inspector-delete {
            flex-shrink: 0;
            margin: 0 12px 12px;
            padding: 6px 10px;
            background: #5a1d1d;
            color: #f48771;
            border: 1px solid #8b2e2e;
            border-radius: 4px;
            font-size: 12px;
            cursor: pointer;
        }
        #inspector-delete:hover:not(:disabled) {
            background: #6e2424;
        }
        #inspector-delete:disabled {
            opacity: 0.35;
            cursor: default;
        }
        #inspector-readonly {
            font-size: 12px;
            color: #aaa;
            margin-bottom: 10px;
        }
        #canvas-container {
            flex: 1;
            order: 2;
            display: flex;
            align-items: center;
            justify-content: center;
            overflow: auto;
            background: #2d2d2d;
            min-width: 0;
        }
        #display-wrapper {
            position: relative;
            box-shadow: 0 0 0 1px #555, 0 4px 20px rgba(0,0,0,0.5);
        }
        #lvgl-canvas {
            display: block;
            image-rendering: pixelated;
        }
        #design-overlay {
            position: absolute;
            top: 0;
            left: 0;
            display: block;
            image-rendering: pixelated;
            cursor: default;
        }
        #toolbar input[type="checkbox"] {
            margin: 0 4px 0 0;
            vertical-align: middle;
        }
        #error-overlay {
            display: none;
            position: absolute;
            inset: 0;
            background: rgba(30,30,30,0.92);
            color: #f48771;
            padding: 16px;
            font-size: 12px;
            font-family: monospace;
            white-space: pre-wrap;
            overflow: auto;
        }
        #loading-overlay {
            position: absolute;
            inset: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            background: #1e1e1e;
            color: #888;
            font-size: 12px;
            gap: 8px;
        }
        .spinner {
            width: 16px; height: 16px;
            border: 2px solid #555;
            border-top-color: #007acc;
            border-radius: 50%;
            animation: spin 0.7s linear infinite;
        }
        @keyframes spin { to { transform: rotate(360deg); } }
    </style>
</head>
<body>
    <div id="toolbar">
        <label>Page:</label>
        <select id="page-select"></select>
        <label title="Select and drag widgets; updates .embf position">
            <input type="checkbox" id="design-mode" checked />
            Design
        </label>
        <span id="status">Waiting for project…</span>
    </div>
    <div id="main">
        <aside id="widget-palette" aria-label="Widgets">
            ${buildWidgetPaletteHtml()}
        </aside>
        <div id="canvas-container">
        <div id="display-wrapper">
            <canvas id="lvgl-canvas"></canvas>
            <canvas id="design-overlay"></canvas>
            <div id="error-overlay"></div>
            <div id="loading-overlay">
                <div class="spinner"></div>
                <span>Loading WASM…</span>
            </div>
        </div>
        </div>
        <aside id="property-inspector" aria-label="Properties">
            <h2>Properties</h2>
            <div id="inspector-body">
                <div id="inspector-empty">Select a widget on the canvas (Design mode).</div>
                <form id="inspector-form" hidden></form>
            </div>
            <button type="button" id="inspector-delete" disabled title="Delete selected widget">Delete widget</button>
        </aside>
    </div>
    <script nonce="${nonce}" src="${webviewJsUri}"></script>
</body>
</html>`;
    }

    dispose(): void {
        EmbfPreviewPanel._panels.delete(this._filePath);
        this._webviewReady = false;
        this._pendingMessage = null;
        this._panel.dispose();
        this._disposables.forEach(d => d.dispose());
        this._disposables = [];
    }
}

function getNonce(): string {
    let text = "";
    const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}
