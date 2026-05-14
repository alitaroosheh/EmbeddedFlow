import * as vscode from "vscode";
import * as path from "path";
import { EmbfProject } from "./types/embf";
import { WIDGET_PALETTE_ORDER } from "./embfPalette";
import { EmbfParseError, getEffectiveDisplaySize, parseEmbf, parseEmbfSource } from "./embfParser";
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
    | { type: "addWidget"; pageIndex: number; widgetType: string };

export interface WebviewLoadPayload {
    project: EmbfProject;
    displayWidth: number;
    displayHeight: number;
    wasmJsUri: string;
    wasmBinUri: string;
}

export class EmbfPreviewPanel {
    static readonly viewType = "embeddedflow.preview";

    private static _panels = new Map<string, EmbfPreviewPanel>();

    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _filePath: string;
    private _disposables: vscode.Disposable[] = [];

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

    sendProject(project: EmbfProject): void {
        const { width, height } = getEffectiveDisplaySize(project);

        // Always use the custom embf_runtime (supports LVGL 9.5.0).
        // When multi-version WASM builds are available, switch here.
        const wasmJsUri  = this._webviewUri("wasm", "embf_runtime.js").toString();
        const wasmBinUri = this._webviewUri("wasm", "embf_runtime.wasm").toString();

        const msg: HostToWebviewMessage = {
            type: "load",
            payload: {
                project,
                displayWidth: width,
                displayHeight: height,
                wasmJsUri,
                wasmBinUri
            }
        };
        this._panel.webview.postMessage(msg);
    }

    sendError(message: string): void {
        const msg: HostToWebviewMessage = { type: "error", message };
        this._panel.webview.postMessage(msg);
    }

    updateTitle(fileName: string): void {
        this._panel.title = `Preview: ${fileName}`;
    }

    private _onWebviewMessage(msg: WebviewToHostMessage): void {
        if (msg.type === "log") {
            embeddedFlowLog("webview", msg.level, msg.text);
        } else if (msg.type === "ready") {
            embeddedFlowLog("webview", "info", "preview webview ready");
        } else if (msg.type === "addWidget") {
            const pageIndex = Number(msg.pageIndex);
            const widgetType = String(msg.widgetType ?? "").trim();
            if (!Number.isInteger(pageIndex) || pageIndex < 0 || !widgetType) {
                return;
            }
            void appendWidgetToEmbfFile(this._filePath, pageIndex, widgetType).then(ok => {
                if (!ok) {
                    return;
                }
                try {
                    const doc = vscode.workspace.textDocuments.find(
                        d => d.uri.scheme === "file" && d.uri.fsPath === this._filePath
                    );
                    const project = doc ? parseEmbfSource(doc.getText()) : parseEmbf(this._filePath);
                    this.sendProject(project);
                } catch (e) {
                    const m = e instanceof EmbfParseError ? e.message : String(e);
                    embeddedFlowLog("preview", "warn", `refresh after addWidget: ${m}`);
                }
            });
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
        #widget-add-select {
            background: #3c3c3c;
            color: #ccc;
            border: 1px solid #555;
            padding: 2px 6px;
            font-size: 12px;
            border-radius: 3px;
            max-width: 160px;
        }
        #status {
            margin-left: auto;
            font-size: 11px;
            color: #888;
        }
        #canvas-container {
            flex: 1;
            display: flex;
            align-items: center;
            justify-content: center;
            overflow: auto;
            background: #2d2d2d;
        }
        #display-wrapper {
            position: relative;
            box-shadow: 0 0 0 1px #555, 0 4px 20px rgba(0,0,0,0.5);
        }
        #lvgl-canvas {
            display: block;
            image-rendering: pixelated;
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
        <label>Add widget:</label>
        <select id="widget-add-select" title="Insert into current page (.embf is updated)">
            <option value="">— type —</option>
            ${WIDGET_PALETTE_ORDER.map(w => `<option value="${w}">${w}</option>`).join("")}
        </select>
        <span id="status">Waiting for project…</span>
    </div>
    <div id="canvas-container">
        <div id="display-wrapper">
            <canvas id="lvgl-canvas"></canvas>
            <div id="error-overlay"></div>
            <div id="loading-overlay">
                <div class="spinner"></div>
                <span>Loading WASM…</span>
            </div>
        </div>
    </div>
    <script nonce="${nonce}" src="${webviewJsUri}"></script>
</body>
</html>`;
    }

    dispose(): void {
        EmbfPreviewPanel._panels.delete(this._filePath);
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
