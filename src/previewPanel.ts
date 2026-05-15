import * as vscode from "vscode";
import * as path from "path";
import { EmbfProject } from "./types/embf";
import { buildWidgetPaletteHtml } from "./embfPaletteIcons";
import { EmbfParseError, getEffectiveDisplaySize } from "./embfParser";
import {
    bulkDeleteWidgetsInEmbfFile,
    bulkMoveWidgetsInEmbfFile,
    bulkPatchWidgetsInEmbfFile,
    combineWidgetsInEmbfFile,
    deleteWidgetFromEmbfFile,
    moveWidgetInEmbfFile,
    ungroupWidgetInEmbfFile,
    updatePageInEmbfFile,
    updateWidgetInEmbfFile
} from "./embfComponentEdit";
import { readEmbfProject } from "./embfProjectWrite";
import { undoEmbfEdit, redoEmbfEdit, getEmbfHistoryState } from "./embfUndoRedo";
import { appendWidgetToEmbfFile } from "./embfWidgetInsert";
import { embeddedFlowLog } from "./outputLog";

// Messages sent from extension host → webview
export type HostToWebviewMessage =
    | { type: "load"; payload: WebviewLoadPayload }
    | { type: "error"; message: string }
    | { type: "historyState"; canUndo: boolean; canRedo: boolean };

// Messages sent from webview → extension host
export type WebviewToHostMessage =
    | { type: "ready" }
    | { type: "log"; level: "info" | "warn" | "error"; text: string }
    | { type: "addWidget"; pageIndex: number; widgetType: string }
    | { type: "moveWidget"; pageIndex: number; componentId: string; x: number; y: number }
    | {
          type: "bulkMoveWidgets";
          pageIndex: number;
          moves: { componentId: string; absX: number; absY: number }[];
      }
    | { type: "updateWidget"; pageIndex: number; componentId: string; patch: Record<string, unknown> }
    | {
          type: "bulkPatchWidgets";
          pageIndex: number;
          updates: { componentId: string; patch: Record<string, unknown> }[];
      }
    | { type: "updatePage"; pageIndex: number; patch: Record<string, unknown> }
    | { type: "deleteWidget"; pageIndex: number; componentId: string }
    | { type: "bulkDeleteWidgets"; pageIndex: number; componentIds: string[] }
    | {
          type: "combineWidgets";
          pageIndex: number;
          componentIds: string[];
      }
    | { type: "ungroupWidget"; pageIndex: number; componentId: string }
    | { type: "undo"; pageIndex: number; selectedComponentId?: string; selectedComponentIds?: string[] }
    | { type: "redo"; pageIndex: number; selectedComponentId?: string; selectedComponentIds?: string[] };

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
    /** When set, re-select these components after reload (design multi-select). */
    selectedComponentIds?: string[];
    /**
     * When true and WASM is already loaded from the same URI, skip loading overlay flicker during JSON refresh.
     * Only used after debounced inspector-driven reloads (same WASM build).
     */
    suppressLoadingSpinner?: boolean;
}

export interface SendProjectOptions {
    pageIndex?: number;
    selectedComponentId?: string;
    selectedComponentIds?: string[];
    suppressLoadingSpinner?: boolean;
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
    /** Coalesce inspector property writes → one preview refresh instead of hammering WASM rebuild per patch. */
    private _inspectorReloadTimer: ReturnType<typeof setTimeout> | undefined;
    private _inspectorReloadPageIndex = 0;
    private _inspectorReloadSelectionIds: string[] | undefined;

    private static readonly _inspectorReloadDebounceMs = 280;

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

    sendProject(project: EmbfProject, options?: SendProjectOptions): void {
        /** Any externally pushed project supersedes a pending inspector debounced refresh. */
        this.clearInspectorReloadDebounce();

        const { width, height } = getEffectiveDisplaySize(project);

        // Always use the custom embf_runtime (supports LVGL 9.5.0).
        // When multi-version WASM builds are available, switch here.
        const wasmJsUri  = this._webviewUri("wasm", "embf_runtime.js").toString();
        const wasmBinUri = this._webviewUri("wasm", "embf_runtime.wasm").toString();

        const pageIndex = options?.pageIndex;
        const selectedComponentId = options?.selectedComponentId;
        const selectedComponentIds = options?.selectedComponentIds;
        const suppressLoadingSpinner = options?.suppressLoadingSpinner;

        const payload: WebviewLoadPayload = {
            project,
            displayWidth: width,
            displayHeight: height,
            wasmJsUri,
            wasmBinUri
        };
        if (pageIndex !== undefined) {
            payload.pageIndex = pageIndex;
        }
        if (selectedComponentIds?.length) {
            payload.selectedComponentIds = [...selectedComponentIds];
        } else if (selectedComponentId !== undefined) {
            payload.selectedComponentId = selectedComponentId;
        }
        if (suppressLoadingSpinner) {
            payload.suppressLoadingSpinner = true;
        }

        this.postToWebview({
            type: "load",
            payload
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
            this.sendHistoryState();
        } else if (msg.type === "undo") {
            const pageIndex = Number(msg.pageIndex);
            if (!Number.isInteger(pageIndex) || pageIndex < 0) {
                return;
            }
            const ids =
                Array.isArray(msg.selectedComponentIds) && msg.selectedComponentIds.length > 0
                    ? msg.selectedComponentIds
                    : typeof msg.selectedComponentId === "string"
                      ? [msg.selectedComponentId]
                      : undefined;
            void this.applyUndo(pageIndex, ids);
        } else if (msg.type === "redo") {
            const pageIndex = Number(msg.pageIndex);
            if (!Number.isInteger(pageIndex) || pageIndex < 0) {
                return;
            }
            const ids =
                Array.isArray(msg.selectedComponentIds) && msg.selectedComponentIds.length > 0
                    ? msg.selectedComponentIds
                    : typeof msg.selectedComponentId === "string"
                      ? [msg.selectedComponentId]
                      : undefined;
            void this.applyRedo(pageIndex, ids);
        } else if (msg.type === "addWidget") {
            const pageIndex = Number(msg.pageIndex);
            const widgetType = String(msg.widgetType ?? "").trim();
            if (!Number.isInteger(pageIndex) || pageIndex < 0 || !widgetType) {
                return;
            }
            void appendWidgetToEmbfFile(this._filePath, pageIndex, widgetType).then(ok => {
                if (ok) {
                    this.reloadPreviewNow(pageIndex);
                    this.sendHistoryState();
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
                    this.reloadPreviewNow(pageIndex, { selectedComponentIds: [componentId] });
                    this.sendHistoryState();
                }
            });
        } else if (msg.type === "bulkMoveWidgets") {
            const pageIndex = Number(msg.pageIndex);
            const moves = msg.moves;
            if (
                !Number.isInteger(pageIndex) ||
                pageIndex < 0 ||
                !Array.isArray(moves) ||
                moves.length === 0
            ) {
                return;
            }
            const normalized = moves
                .map(m => ({
                    componentId: String((m as { componentId?: string }).componentId ?? "").trim(),
                    absX: Number((m as { absX?: unknown }).absX),
                    absY: Number((m as { absY?: unknown }).absY)
                }))
                .filter(m => m.componentId && Number.isFinite(m.absX) && Number.isFinite(m.absY));
            if (normalized.length === 0) {
                return;
            }
            void bulkMoveWidgetsInEmbfFile(this._filePath, pageIndex, normalized).then(ok => {
                if (ok) {
                    this.reloadPreviewNow(pageIndex, {
                        selectedComponentIds: normalized.map(m => m.componentId)
                    });
                    this.sendHistoryState();
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
                    this.scheduleReloadPreviewAfterInspectorEdit(pageIndex, [componentId]);
                    this.sendHistoryState();
                }
            });
        } else if (msg.type === "bulkPatchWidgets") {
            const pageIndex = Number(msg.pageIndex);
            const updates = msg.updates;
            if (
                !Number.isInteger(pageIndex) ||
                pageIndex < 0 ||
                !Array.isArray(updates) ||
                updates.length === 0
            ) {
                return;
            }
            const norm = updates
                .map(u => ({
                    componentId: String((u as { componentId?: string }).componentId ?? "").trim(),
                    patch: (u as { patch?: Record<string, unknown> }).patch as Record<string, unknown>
                }))
                .filter(u => u.componentId && u.patch && typeof u.patch === "object");
            if (norm.length === 0) {
                return;
            }
            void bulkPatchWidgetsInEmbfFile(this._filePath, pageIndex, norm).then(ok => {
                if (ok) {
                    this.reloadPreviewNow(pageIndex, {
                        selectedComponentIds: norm.map(u => u.componentId)
                    });
                    this.sendHistoryState();
                }
            });
        } else if (msg.type === "updatePage") {
            const pageIndex = Number(msg.pageIndex);
            const patch = msg.patch;
            if (!Number.isInteger(pageIndex) || pageIndex < 0 || !patch || typeof patch !== "object") {
                return;
            }
            void updatePageInEmbfFile(this._filePath, pageIndex, patch).then(ok => {
                if (ok) {
                    this.scheduleReloadPreviewAfterInspectorEdit(pageIndex);
                    this.sendHistoryState();
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
                    this.reloadPreviewNow(pageIndex);
                    this.sendHistoryState();
                }
            });
        } else if (msg.type === "bulkDeleteWidgets") {
            const pageIndex = Number(msg.pageIndex);
            const rawIds = msg.componentIds;
            if (!Number.isInteger(pageIndex) || pageIndex < 0 || !Array.isArray(rawIds) || rawIds.length === 0) {
                return;
            }
            const ids = [...new Set(rawIds.map(id => String(id ?? "").trim()).filter(Boolean))];
            if (!ids.length) {
                return;
            }
            void bulkDeleteWidgetsInEmbfFile(this._filePath, pageIndex, ids).then(ok => {
                if (ok) {
                    this.reloadPreviewNow(pageIndex);
                    this.sendHistoryState();
                }
            });
        } else if (msg.type === "combineWidgets") {
            const pageIndex = Number(msg.pageIndex);
            const rawIds = msg.componentIds;
            if (!Number.isInteger(pageIndex) || pageIndex < 0 || !Array.isArray(rawIds) || rawIds.length < 2) {
                return;
            }
            const ids = [...new Set(rawIds.map(id => String(id ?? "").trim()).filter(Boolean))];
            if (ids.length < 2) {
                return;
            }
            void combineWidgetsInEmbfFile(this._filePath, pageIndex, ids).then(res => {
                if (res.ok) {
                    this.reloadPreviewNow(pageIndex, { selectedComponentIds: [res.containerId] });
                    this.sendHistoryState();
                }
            });
        } else if (msg.type === "ungroupWidget") {
            const pageIndex = Number(msg.pageIndex);
            const componentId = String(msg.componentId ?? "").trim();
            if (!Number.isInteger(pageIndex) || pageIndex < 0 || !componentId) {
                return;
            }
            void ungroupWidgetInEmbfFile(this._filePath, pageIndex, componentId).then(res => {
                if (res.ok) {
                    this.reloadPreviewNow(pageIndex, { selectedComponentIds: res.liftedIds });
                    this.sendHistoryState();
                }
            });
        }
    }

    private sendHistoryState(): void {
        const { canUndo, canRedo } = getEmbfHistoryState(this._filePath);
        this.postToWebview({ type: "historyState", canUndo, canRedo });
    }

    private async applyUndo(pageIndex: number, selectedComponentIds?: string[]): Promise<void> {
        const ok = await undoEmbfEdit(this._filePath);
        if (ok) {
            this.reloadPreviewNow(
                pageIndex,
                selectedComponentIds?.length ? { selectedComponentIds } : undefined
            );
            this.sendHistoryState();
        }
    }

    private async applyRedo(pageIndex: number, selectedComponentIds?: string[]): Promise<void> {
        const ok = await redoEmbfEdit(this._filePath);
        if (ok) {
            this.reloadPreviewNow(
                pageIndex,
                selectedComponentIds?.length ? { selectedComponentIds } : undefined
            );
            this.sendHistoryState();
        }
    }

    private clearInspectorReloadDebounce(): void {
        if (this._inspectorReloadTimer !== undefined) {
            clearTimeout(this._inspectorReloadTimer);
            this._inspectorReloadTimer = undefined;
        }
    }

    /** Immediate read-from-disk refresh; cancels any pending inspector debounce so we don't double-send. */
    private reloadPreviewNow(
        pageIndex: number,
        opts?: Pick<SendProjectOptions, "selectedComponentId" | "selectedComponentIds" | "suppressLoadingSpinner">
    ): void {
        this.clearInspectorReloadDebounce();
        try {
            const project = readEmbfProject(this._filePath);
            this.sendProject(project, {
                pageIndex,
                ...(opts?.selectedComponentIds?.length
                    ? { selectedComponentIds: opts.selectedComponentIds }
                    : opts?.selectedComponentId !== undefined
                      ? { selectedComponentId: opts.selectedComponentId }
                      : {}),
                suppressLoadingSpinner: opts?.suppressLoadingSpinner === true ? true : undefined
            });
        } catch (e) {
            const m = e instanceof EmbfParseError ? e.message : String(e);
            embeddedFlowLog("preview", "warn", `refresh preview: ${m}`);
        }
    }

    /** After inspector-driven file patches; merges rapid commits into fewer WASM/UI rebuilds. */
    private scheduleReloadPreviewAfterInspectorEdit(
        pageIndex: number,
        selectedComponentIds?: string[]
    ): void {
        this._inspectorReloadPageIndex = pageIndex;
        this._inspectorReloadSelectionIds = selectedComponentIds?.length ? [...selectedComponentIds] : undefined;
        if (this._inspectorReloadTimer !== undefined) {
            clearTimeout(this._inspectorReloadTimer);
        }
        this._inspectorReloadTimer = setTimeout(() => {
            this._inspectorReloadTimer = undefined;
            this.reloadPreviewNow(this._inspectorReloadPageIndex, {
                selectedComponentIds: this._inspectorReloadSelectionIds,
                suppressLoadingSpinner: true
            });
        }, EmbfPreviewPanel._inspectorReloadDebounceMs);
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
        #toolbar .tb-btn {
            background: #3c3c3c;
            color: #ccc;
            border: 1px solid #555;
            padding: 2px 10px;
            font-size: 12px;
            border-radius: 3px;
            cursor: pointer;
        }
        #toolbar .tb-btn:hover:not(:disabled) {
            background: #4a4a4a;
            color: #fff;
        }
        #toolbar .tb-btn:disabled {
            opacity: 0.35;
            cursor: default;
        }
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
        #inspector-form .inspector-group-title {
            font-size: 10px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            color: #666;
            margin: 14px 0 6px;
            border-top: 1px solid #3c3c3c;
            padding-top: 10px;
        }
        #inspector-form .inspector-group-title:first-child,
        #inspector-readonly + .inspector-group-title {
            margin-top: 0;
            border-top: none;
            padding-top: 0;
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
        #inspector-form .inspector-layout-grid {
            display: flex;
            flex-wrap: wrap;
            gap: 4px;
            margin-bottom: 10px;
        }
        #inspector-form .tb-btn-small {
            font-size: 11px;
            padding: 4px 8px;
            margin: 0;
            background: #3c3c3c;
            color: #ccc;
            border: 1px solid #555;
            border-radius: 3px;
            cursor: pointer;
            font-family: inherit;
        }
        #inspector-form .tb-btn-small:hover:not(:disabled) {
            background: #4a4a4a;
            color: #fff;
        }
        #inspector-form .tb-btn-small:disabled {
            opacity: 0.35;
            cursor: default;
        }
        #inspector-form .check-row {
            display: flex;
            align-items: center;
            gap: 6px;
        }
        #inspector-form .check-row input {
            width: auto;
        }
        #inspector-form .inspector-color-row {
            position: relative;
            display: flex;
            align-items: stretch;
            gap: 6px;
        }
        #inspector-form .inspector-color-row input[type="text"] {
            flex: 1;
            min-width: 0;
            width: auto;
        }
        #inspector-form .inspector-color-swatch-wrap {
            position: relative;
            flex-shrink: 0;
            width: 30px;
            height: 26px;
            align-self: stretch;
            min-height: 26px;
        }
        #inspector-form .inspector-color-face {
            position: absolute;
            inset: 0;
            border-radius: 3px;
            border: 1px solid #555;
            box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.35);
            pointer-events: none;
        }
        #inspector-form .inspector-color-swatch-wrap:hover .inspector-color-face {
            border-color: #007acc;
        }
        #inspector-form .inspector-color-picker-native {
            position: absolute;
            inset: 0;
            width: 100%;
            height: 100%;
            min-width: 0;
            padding: 0;
            margin: 0;
            border: none;
            opacity: 0.01;
            cursor: pointer;
            box-sizing: border-box;
        }
        #inspector-form .inspector-color-picker-native::-webkit-color-swatch-wrapper {
            padding: 0;
        }
        #inspector-form .inspector-color-picker-native::-webkit-color-swatch {
            border: none;
            border-radius: 2px;
        }
        #inspector-form .inspector-color-picker-native::-moz-color-swatch {
            border: none;
            border-radius: 2px;
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
            flex-shrink: 0;
            box-shadow: 0 0 0 1px #555, 0 4px 20px rgba(0,0,0,0.5);
        }
        #lvgl-canvas {
            display: block;
        }
        #design-overlay {
            position: absolute;
            top: 0;
            left: 0;
            display: block;
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
        <button type="button" class="tb-btn" id="btn-undo" disabled title="Undo (Ctrl+Z)">Undo</button>
        <button type="button" class="tb-btn" id="btn-redo" disabled title="Redo (Ctrl+Y)">Redo</button>
        <label title="Select and drag widgets; updates .embf position">
            <input type="checkbox" id="design-mode" checked />
            Design
        </label>
        <label for="preview-zoom">Zoom:</label>
        <select id="preview-zoom" title="Preview scale only — device resolution stays in .embf">
            <option value="auto" selected>Auto</option>
            <option value="1">100%</option>
            <option value="2">200%</option>
            <option value="3">300%</option>
            <option value="4">400%</option>
        </select>
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
                <div id="inspector-empty">Design mode: click the page background for page &amp; theme settings, or click a widget for its properties.</div>
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
        this.clearInspectorReloadDebounce();
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
