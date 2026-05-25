import * as vscode from "vscode";
import * as path from "path";
import { EmbfProject } from "./types/embf";
import { buildComponentsSidebarHtml } from "./embfPaletteIcons";
import { buildSidebarPanelViewsHtml, buildSidebarRailHtml } from "./sidebarCategories";
import { EmbfParseError, getEffectiveDisplaySize } from "./embfParser";
import {
    bulkDeleteWidgetsInEmbfFile,
    bulkMoveWidgetsInEmbfFile,
    bulkPatchWidgetsInEmbfFile,
    combineWidgetsInEmbfFile,
    deleteWidgetFromEmbfFile,
    duplicateWidgetsInEmbfFile,
    moveWidgetInEmbfFile,
    pasteWidgetsInEmbfFile,
    reorderWidgetInEmbfFile,
    reparentWidgetInEmbfFile,
    ungroupWidgetInEmbfFile,
    updatePageInEmbfFile,
    updateWidgetInEmbfFile
} from "./embfComponentEdit";
import {
    insertLibraryComponentInEmbfFile,
    removeLibraryEntryInEmbfFile,
    saveGroupToLibraryInEmbfFile
} from "./embfComponentLibraryEdit";
import { assignImageFileToWidgetInEmbfFile } from "./embfImageEdit";
import { buildImagePreviewAssets } from "./embfImagePreview";
import { supportedImageExtensions } from "./resources/imageFormats";
import { readEmbfProject } from "./embfProjectWrite";
import { runCreateNewProjectFlow } from "./embfNewProject";
import { formatOutputPathForStorage, resolveCodegenOutputDir } from "./codeGen/outputDir";
import { undoEmbfEdit, redoEmbfEdit, getEmbfHistoryState } from "./embfUndoRedo";
import { appendWidgetToEmbfFile } from "./embfWidgetInsert";
import { addPageInEmbfFile, removePageInEmbfFile, renamePageInEmbfFile } from "./embfPageEdit";
import { addNavigateFlowInEmbfFile, removeNavigateFlowInEmbfFile } from "./embfFlowEdit";
import { addPageSwipeFlowInEmbfFile, removePageSwipeFlowInEmbfFile } from "./embfPageSwipeEdit";
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
    | {
          type: "addWidget";
          pageIndex: number;
          widgetType: string;
          x?: number;
          y?: number;
      }
    | {
          type: "reorderWidget";
          pageIndex: number;
          componentId: string;
          action: "front" | "back" | "forward" | "backward";
      }
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
    | { type: "pickCodegenOutputFolder"; pageIndex: number }
    | { type: "pickImageSource"; pageIndex: number; componentId: string }
    | { type: "deleteWidget"; pageIndex: number; componentId: string }
    | { type: "bulkDeleteWidgets"; pageIndex: number; componentIds: string[] }
    | { type: "duplicateWidgets"; pageIndex: number; componentIds: string[] }
    | {
          type: "pasteWidgets";
          pageIndex: number;
          components: import("./types/embf").Component[];
      }
    | {
          type: "combineWidgets";
          pageIndex: number;
          componentIds: string[];
      }
    | { type: "ungroupWidget"; pageIndex: number; componentId: string }
    | {
          type: "reparentWidget";
          pageIndex: number;
          componentId: string;
          parentId: string | null;
          beforeId?: string | null;
      }
    | { type: "saveGroupToLibrary"; pageIndex: number; componentId: string }
    | { type: "insertLibraryComponent"; pageIndex: number; libraryId: string }
    | { type: "removeLibraryEntry"; libraryId: string }
    | { type: "undo"; pageIndex: number; selectedComponentId?: string; selectedComponentIds?: string[] }
    | { type: "redo"; pageIndex: number; selectedComponentId?: string; selectedComponentIds?: string[] }
    | { type: "addPage" }
    | { type: "removePage"; pageIndex: number }
    | { type: "renamePage"; pageIndex: number }
    | {
          type: "addNavigateFlow";
          sourcePageIndex: number;
          componentId: string;
          trigger: string;
          targetPageId: string;
          anim?: string;
          time?: number;
      }
    | {
          type: "removeNavigateFlow";
          sourcePageIndex: number;
          componentId: string;
          trigger: string;
          targetPageId: string;
      }
    | {
          type: "addPageSwipeFlow";
          sourcePageIndex: number;
          direction: string;
          targetPageId: string;
          anim?: string;
          time?: number;
      }
    | {
          type: "removePageSwipeFlow";
          sourcePageIndex: number;
          direction: string;
      }
    | { type: "generateCode" }
    | { type: "newProject" };

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
    /** Absolute path where Generate C Code writes files (from project.outputPath / settings). */
    codegenOutputResolved?: string;
    /** Resolved image files for preview overlays (`id` → webview URI). */
    imageAssets?: { id: string; uri: string; path: string }[];
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
    /** Last preview panel that had focus (for Generate C Code when no .embf editor tab is active). */
    private static _lastActiveEmbfPath: string | undefined;

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

        const embfDir = path.dirname(filePath);
        const resourceRoots = [
            vscode.Uri.joinPath(extensionUri, "media"),
            vscode.Uri.file(embfDir)
        ];
        for (const folder of vscode.workspace.workspaceFolders ?? []) {
            resourceRoots.push(folder.uri);
        }

        const panel = vscode.window.createWebviewPanel(
            EmbfPreviewPanel.viewType,
            `Preview: ${path.basename(filePath)}`,
            vscode.ViewColumn.Beside,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: resourceRoots
            }
        );

        const instance = new EmbfPreviewPanel(panel, filePath, extensionUri);
        EmbfPreviewPanel._panels.set(filePath, instance);
        return instance;
    }

    static getPanel(filePath: string): EmbfPreviewPanel | undefined {
        return EmbfPreviewPanel._panels.get(filePath);
    }

    /** Open preview paths (for codegen / commands when the preview has focus). */
    static getOpenEmbfPaths(): string[] {
        return [...EmbfPreviewPanel._panels.keys()];
    }

    /**
     * Resolve which `.embf` file to use for codegen when the command is not invoked from an editor tab.
     */
    static async resolveEmbfPathForCodegen(): Promise<string | undefined> {
        const paths = EmbfPreviewPanel.getOpenEmbfPaths();
        if (paths.length === 0) {
            return undefined;
        }
        if (paths.length === 1) {
            return paths[0];
        }
        if (
            EmbfPreviewPanel._lastActiveEmbfPath &&
            EmbfPreviewPanel._panels.has(EmbfPreviewPanel._lastActiveEmbfPath)
        ) {
            return EmbfPreviewPanel._lastActiveEmbfPath;
        }
        const pick = await vscode.window.showQuickPick(
            paths.map(fp => ({
                label: path.basename(fp),
                description: path.dirname(fp),
                detail: fp
            })),
            {
                title: "Generate C Code — select project",
                placeHolder: "Multiple UI previews are open"
            }
        );
        return pick?.detail;
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

        EmbfPreviewPanel._lastActiveEmbfPath = filePath;
        this._panel.onDidChangeViewState(
            e => {
                if (e.webviewPanel.active) {
                    EmbfPreviewPanel._lastActiveEmbfPath = this._filePath;
                }
            },
            null,
            this._disposables
        );

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
        payload.codegenOutputResolved = resolveCodegenOutputDir(
            project,
            this._filePath,
            workspaceCodegenOutputSetting()
        );
        const imageAssets = buildImagePreviewAssets(project, this._filePath, {
            workspaceOutputDirectory: workspaceCodegenOutputSetting(),
            extraSearchRoots: (vscode.workspace.workspaceFolders ?? []).map(f => f.uri.fsPath),
            toWebviewUri: abs =>
                this._panel.webview.asWebviewUri(vscode.Uri.file(abs)).toString()
        });
        payload.imageAssets = imageAssets;

        this.postToWebview({
            type: "load",
            payload
        });
    }

    sendError(message: string): void {
        this.postToWebview({ type: "error", message });
    }

    /** Reload from the open .embf editor buffer (or disk); keeps the current preview page. */
    refreshFromEmbfSource(): void {
        try {
            const project = readEmbfProject(this._filePath);
            this.sendProject(project, { suppressLoadingSpinner: true });
        } catch (e) {
            const m = e instanceof EmbfParseError ? e.message : String(e);
            this.sendError(m);
            embeddedFlowLog("preview", "warn", `refresh from editor: ${m}`);
        }
    }

    updateTitle(fileName: string): void {
        this._panel.title = `Preview: ${fileName}`;
    }

    private async _runNewProjectFromPreview(): Promise<void> {
        await runCreateNewProjectFlow(async filePath => {
            const panel = EmbfPreviewPanel.createOrShow(filePath, this._extensionUri);
            try {
                panel.sendProject(readEmbfProject(filePath));
            } catch (e) {
                const m = e instanceof EmbfParseError ? e.message : String(e);
                panel.sendError(m);
            }
        });
    }

    private _onWebviewMessage(msg: WebviewToHostMessage): void {
        if (msg.type === "generateCode") {
            void vscode.commands.executeCommand(
                "embeddedflow.generateCode",
                vscode.Uri.file(this._filePath)
            );
        } else if (msg.type === "newProject") {
            void this._runNewProjectFromPreview();
        } else if (msg.type === "log") {
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
            const x = Number(msg.x);
            const y = Number(msg.y);
            const at =
                Number.isFinite(x) && Number.isFinite(y)
                    ? { x, y }
                    : undefined;
            void appendWidgetToEmbfFile(this._filePath, pageIndex, widgetType, at).then(ok => {
                if (ok) {
                    this.reloadPreviewNow(pageIndex);
                    this.sendHistoryState();
                }
            });
        } else if (msg.type === "reorderWidget") {
            const pageIndex = Number(msg.pageIndex);
            const componentId = String(msg.componentId ?? "").trim();
            const action = msg.action;
            if (
                !Number.isInteger(pageIndex) ||
                pageIndex < 0 ||
                !componentId ||
                !["front", "back", "forward", "backward"].includes(action)
            ) {
                return;
            }
            void reorderWidgetInEmbfFile(this._filePath, pageIndex, componentId, action).then(
                ok => {
                    if (ok) {
                        this.reloadPreviewNow(pageIndex, { selectedComponentIds: [componentId] });
                        this.sendHistoryState();
                    }
                }
            );
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
        } else if (msg.type === "pickCodegenOutputFolder") {
            const pageIndex = Number(msg.pageIndex);
            if (!Number.isInteger(pageIndex) || pageIndex < 0) {
                return;
            }
            void this._pickCodegenOutputFolder(pageIndex);
        } else if (msg.type === "pickImageSource") {
            const pageIndex = Number(msg.pageIndex);
            const componentId = String(msg.componentId ?? "").trim();
            if (!Number.isInteger(pageIndex) || pageIndex < 0 || !componentId) {
                return;
            }
            void this._pickImageSource(pageIndex, componentId);
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
        } else if (msg.type === "duplicateWidgets") {
            const pageIndex = Number(msg.pageIndex);
            const ids = msg.componentIds;
            if (!Number.isInteger(pageIndex) || pageIndex < 0 || !Array.isArray(ids) || ids.length === 0) {
                return;
            }
            const norm = ids.map(id => String(id ?? "").trim()).filter(Boolean);
            if (!norm.length) {
                return;
            }
            void duplicateWidgetsInEmbfFile(this._filePath, pageIndex, norm).then(newIds => {
                if (newIds.length) {
                    this.reloadPreviewNow(pageIndex, { selectedComponentIds: newIds });
                    this.sendHistoryState();
                }
            });
        } else if (msg.type === "pasteWidgets") {
            const pageIndex = Number(msg.pageIndex);
            const components = msg.components;
            if (
                !Number.isInteger(pageIndex) ||
                pageIndex < 0 ||
                !Array.isArray(components) ||
                components.length === 0
            ) {
                return;
            }
            void pasteWidgetsInEmbfFile(this._filePath, pageIndex, components).then(newIds => {
                if (newIds.length) {
                    this.reloadPreviewNow(pageIndex, { selectedComponentIds: newIds });
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
        } else if (msg.type === "reparentWidget") {
            const pageIndex = Number(msg.pageIndex);
            const componentId = String(msg.componentId ?? "").trim();
            if (!Number.isInteger(pageIndex) || pageIndex < 0 || !componentId) {
                return;
            }
            const parentId =
                msg.parentId === null || msg.parentId === undefined
                    ? null
                    : String(msg.parentId).trim() || null;
            const beforeId =
                typeof msg.beforeId === "string" && msg.beforeId.trim()
                    ? msg.beforeId.trim()
                    : null;
            void reparentWidgetInEmbfFile(
                this._filePath,
                pageIndex,
                componentId,
                parentId,
                beforeId
            ).then(res => {
                if (res.ok) {
                    this.reloadPreviewNow(pageIndex, { selectedComponentIds: [componentId] });
                    this.sendHistoryState();
                }
            });
        } else if (msg.type === "saveGroupToLibrary") {
            const pageIndex = Number(msg.pageIndex);
            const componentId = String(msg.componentId ?? "").trim();
            if (!Number.isInteger(pageIndex) || pageIndex < 0 || !componentId) {
                return;
            }
            void saveGroupToLibraryInEmbfFile(this._filePath, pageIndex, componentId).then(res => {
                if (res.ok) {
                    this.reloadPreviewNow(pageIndex, { selectedComponentId: componentId });
                    this.sendHistoryState();
                }
            });
        } else if (msg.type === "insertLibraryComponent") {
            const pageIndex = Number(msg.pageIndex);
            const libraryId = String(msg.libraryId ?? "").trim();
            if (!Number.isInteger(pageIndex) || pageIndex < 0 || !libraryId) {
                return;
            }
            void insertLibraryComponentInEmbfFile(this._filePath, pageIndex, libraryId).then(res => {
                if (res.ok) {
                    this.reloadPreviewNow(pageIndex, { selectedComponentId: res.componentId });
                    this.sendHistoryState();
                }
            });
        } else if (msg.type === "removeLibraryEntry") {
            const libraryId = String(msg.libraryId ?? "").trim();
            if (!libraryId) {
                return;
            }
            void removeLibraryEntryInEmbfFile(this._filePath, libraryId).then(ok => {
                if (ok) {
                    this.reloadPreviewNow(this._inspectorReloadPageIndex);
                    this.sendHistoryState();
                }
            });
        } else if (msg.type === "addPage") {
            void addPageInEmbfFile(this._filePath).then(res => {
                if (res.ok && res.pageIndex !== undefined) {
                    this.reloadPreviewNow(res.pageIndex);
                    this.sendHistoryState();
                }
            });
        } else if (msg.type === "removePage") {
            const pageIndex = Number(msg.pageIndex);
            if (!Number.isInteger(pageIndex) || pageIndex < 0) {
                return;
            }
            void removePageInEmbfFile(this._filePath, pageIndex).then(res => {
                if (res.ok && res.pageIndex !== undefined) {
                    this.reloadPreviewNow(res.pageIndex);
                    this.sendHistoryState();
                }
            });
        } else if (msg.type === "renamePage") {
            const pageIndex = Number(msg.pageIndex);
            if (!Number.isInteger(pageIndex) || pageIndex < 0) {
                return;
            }
            void renamePageInEmbfFile(this._filePath, pageIndex).then(ok => {
                if (ok) {
                    this.reloadPreviewNow(pageIndex);
                    this.sendHistoryState();
                }
            });
        } else if (msg.type === "addNavigateFlow") {
            const sourcePageIndex = Number(msg.sourcePageIndex);
            const componentId = String(msg.componentId ?? "").trim();
            const trigger = String(msg.trigger ?? "").trim();
            const targetPageId = String(msg.targetPageId ?? "").trim();
            if (
                !Number.isInteger(sourcePageIndex) ||
                sourcePageIndex < 0 ||
                !componentId ||
                !trigger ||
                !targetPageId
            ) {
                return;
            }
            const anim = msg.anim !== undefined ? String(msg.anim) : undefined;
            const time = msg.time !== undefined ? Number(msg.time) : undefined;
            void addNavigateFlowInEmbfFile(
                this._filePath,
                sourcePageIndex,
                componentId,
                trigger,
                targetPageId,
                anim,
                time
            ).then(ok => {
                if (ok) {
                    this.reloadPreviewNow(sourcePageIndex, { selectedComponentId: componentId });
                    this.sendHistoryState();
                }
            });
        } else if (msg.type === "removeNavigateFlow") {
            const sourcePageIndex = Number(msg.sourcePageIndex);
            const componentId = String(msg.componentId ?? "").trim();
            const trigger = String(msg.trigger ?? "").trim();
            const targetPageId = String(msg.targetPageId ?? "").trim();
            if (
                !Number.isInteger(sourcePageIndex) ||
                sourcePageIndex < 0 ||
                !componentId ||
                !trigger ||
                !targetPageId
            ) {
                return;
            }
            void removeNavigateFlowInEmbfFile(
                this._filePath,
                sourcePageIndex,
                componentId,
                trigger,
                targetPageId
            ).then(ok => {
                if (ok) {
                    this.reloadPreviewNow(sourcePageIndex);
                    this.sendHistoryState();
                }
            });
        } else if (msg.type === "addPageSwipeFlow") {
            const sourcePageIndex = Number(msg.sourcePageIndex);
            const direction = String(msg.direction ?? "").trim();
            const targetPageId = String(msg.targetPageId ?? "").trim();
            if (
                !Number.isInteger(sourcePageIndex) ||
                sourcePageIndex < 0 ||
                !direction ||
                !targetPageId
            ) {
                return;
            }
            const anim = msg.anim !== undefined ? String(msg.anim) : undefined;
            const time = msg.time !== undefined ? Number(msg.time) : undefined;
            void addPageSwipeFlowInEmbfFile(
                this._filePath,
                sourcePageIndex,
                direction,
                targetPageId,
                anim,
                time
            ).then(ok => {
                if (ok) {
                    this.reloadPreviewNow(sourcePageIndex);
                    this.sendHistoryState();
                }
            });
        } else if (msg.type === "removePageSwipeFlow") {
            const sourcePageIndex = Number(msg.sourcePageIndex);
            const direction = String(msg.direction ?? "").trim();
            if (!Number.isInteger(sourcePageIndex) || sourcePageIndex < 0 || !direction) {
                return;
            }
            void removePageSwipeFlowInEmbfFile(this._filePath, sourcePageIndex, direction).then(ok => {
                if (ok) {
                    this.reloadPreviewNow(sourcePageIndex);
                    this.sendHistoryState();
                }
            });
        }
    }

    private async _pickImageSource(pageIndex: number, componentId: string): Promise<void> {
        const embfDir = path.dirname(this._filePath);
        const imgExt = supportedImageExtensions().map(e => e.replace(/^\./, ""));
        const picked = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false,
            defaultUri: vscode.Uri.file(embfDir),
            filters: { Images: imgExt },
            title: "Select image file",
            openLabel: "Select image"
        });
        if (!picked?.length) {
            return;
        }

        const res = await assignImageFileToWidgetInEmbfFile(
            this._filePath,
            pageIndex,
            componentId,
            picked[0].fsPath
        );
        if (res.ok) {
            this.reloadPreviewNow(pageIndex, { selectedComponentId: componentId });
            this.sendHistoryState();
        }
    }

    private async _pickCodegenOutputFolder(pageIndex: number): Promise<void> {
        const defaultUri = vscode.Uri.file(path.join(path.dirname(this._filePath), "ui_output"));
        const picked = await vscode.window.showOpenDialog({
            canSelectFolders: true,
            canSelectFiles: false,
            canSelectMany: false,
            defaultUri,
            title: "Select folder for generated C UI files",
            openLabel: "Select folder"
        });
        if (!picked?.length) {
            return;
        }

        const stored = formatOutputPathForStorage(this._filePath, picked[0].fsPath);
        const ok = await updatePageInEmbfFile(this._filePath, pageIndex, { projOutputPath: stored });
        if (ok) {
            this.reloadPreviewNow(pageIndex);
            this.sendHistoryState();
        } else {
            vscode.window.showErrorMessage("embeddedflow: could not save output folder to the .embf file.");
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
        const faviconUri = this._webviewUri("embeddedflow-icon.png").toString();
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
    <title>embeddedflow Preview</title>
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
        #toolbar-shell {
            flex-shrink: 0;
            background: #252526;
            border-bottom: 1px solid #3c3c3c;
        }
        #toolbar-shell.collapsed #toolbar {
            display: none;
        }
        .dock-toggle {
            display: flex;
            align-items: center;
            gap: 4px;
            border: none;
            background: transparent;
            color: #888;
            font-size: 11px;
            font-family: inherit;
            cursor: pointer;
            padding: 3px 8px;
            line-height: 1.2;
        }
        .dock-toggle:hover {
            color: #ccc;
            background: #2a2d2e;
        }
        .dock-toggle-toolbar {
            width: 100%;
            justify-content: center;
            border-bottom: 1px solid transparent;
        }
        #toolbar-shell.collapsed .dock-toggle-toolbar {
            border-bottom: none;
        }
        #toolbar {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 6px 10px;
            flex-wrap: wrap;
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
        #left-sidebar {
            flex-shrink: 0;
            order: 1;
            display: flex;
            flex-direction: column;
            background: #252526;
            border-right: 1px solid #3c3c3c;
            overflow: hidden;
            transition: width 0.15s ease, min-width 0.15s ease, max-width 0.15s ease;
        }
        #left-sidebar.collapsed {
            width: 26px !important;
            min-width: 26px !important;
            max-width: 26px !important;
        }
        #left-sidebar.collapsed #left-sidebar-body {
            display: none;
        }
        #left-sidebar-header {
            display: flex;
            align-items: center;
            justify-content: center;
            flex-shrink: 0;
            border-bottom: 1px solid #3c3c3c;
        }
        .dock-toggle-left-sidebar {
            width: 100%;
            justify-content: center;
        }
        #left-sidebar-body {
            flex: 1;
            display: flex;
            flex-direction: row;
            min-height: 0;
            overflow: hidden;
        }
        #sidebar-rail {
            flex-shrink: 0;
            width: 40px;
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 4px;
            padding: 8px 4px;
            border-right: 1px solid #3c3c3c;
            background: #2a2a2b;
        }
        .sidebar-rail-btn {
            display: flex;
            align-items: center;
            justify-content: center;
            width: 32px;
            height: 32px;
            padding: 0;
            border: 1px solid transparent;
            border-radius: 6px;
            background: transparent;
            color: #aaa;
            cursor: pointer;
        }
        .sidebar-rail-btn svg {
            width: 20px;
            height: 20px;
            pointer-events: none;
        }
        .sidebar-rail-btn:hover {
            background: #3c3c3c;
            color: #fff;
            border-color: #555;
        }
        .sidebar-rail-btn.active {
            background: #094771;
            border-color: #007acc;
            color: #fff;
        }
        #sidebar-panel {
            flex-shrink: 0;
            width: 52px;
            display: flex;
            flex-direction: column;
            min-height: 0;
            overflow: hidden;
            transition: width 0.15s ease;
        }
        #sidebar-panel.panel-medium {
            width: 116px;
        }
        #sidebar-panel.wide {
            width: 168px;
        }
        #sidebar-panel-header {
            flex-shrink: 0;
            padding: 8px 10px 6px;
            font-size: 10px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            color: #888;
            border-bottom: 1px solid #3c3c3c;
        }
        #sidebar-panel-body {
            flex: 1;
            min-height: 0;
            overflow: hidden;
            position: relative;
        }
        .sidebar-panel-view {
            position: absolute;
            inset: 0;
            overflow-y: auto;
            overflow-x: hidden;
        }
        .sidebar-panel-view[hidden] {
            display: none !important;
        }
        #sidebar-panel-components {
            display: flex;
            flex-direction: column;
            align-items: stretch;
            gap: 4px;
            padding: 8px 6px;
        }
        #sidebar-panel-components .palette-standard {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 4px;
        }
        .palette-section-label {
            font-size: 10px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            color: #888;
            margin: 10px 2px 4px;
            text-align: center;
            flex-shrink: 0;
        }
        .library-palette-list {
            display: flex;
            flex-direction: column;
            align-items: stretch;
            gap: 4px;
            width: 100%;
        }
        .library-palette-empty {
            font-size: 10px;
            color: #777;
            text-align: center;
            line-height: 1.35;
            padding: 4px 2px 8px;
        }
        #sidebar-panel-components .palette-item-library {
            width: 100%;
            height: auto;
            min-height: 52px;
            flex-direction: column;
            gap: 4px;
            padding: 6px 4px;
            justify-content: center;
        }
        #sidebar-panel-components .palette-item-library svg {
            flex-shrink: 0;
            width: 32px;
            height: 32px;
        }
        #sidebar-panel-components .palette-library-label {
            font-size: 10px;
            line-height: 1.2;
            max-width: 100%;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            pointer-events: none;
        }
        .page-sidebar-actions {
            display: flex;
            flex-wrap: wrap;
            gap: 4px;
            padding: 8px 8px 4px;
            border-bottom: 1px solid #3c3c3c;
            flex-shrink: 0;
        }
        .page-sidebar-actions .tb-btn-small {
            flex: 1 1 auto;
            min-width: 0;
            font-size: 11px;
            padding: 4px 6px;
            background: #3c3c3c;
            color: #ccc;
            border: 1px solid #555;
            border-radius: 3px;
            cursor: pointer;
            font-family: inherit;
        }
        .page-sidebar-actions .tb-btn-small:hover:not(:disabled) {
            background: #4a4a4a;
            color: #fff;
        }
        .page-sidebar-actions .tb-btn-small:disabled {
            opacity: 0.35;
            cursor: default;
        }
        .page-list {
            list-style: none;
            margin: 0;
            padding: 4px;
        }
        .page-list-item {
            display: block;
            width: 100%;
            text-align: left;
            padding: 8px 10px;
            margin-bottom: 2px;
            border: 1px solid transparent;
            border-radius: 4px;
            background: transparent;
            color: #ccc;
            cursor: pointer;
            font-family: inherit;
        }
        .page-list-item:hover {
            background: #3c3c3c;
            border-color: #555;
        }
        .page-list-item.active {
            background: #094771;
            border-color: #007acc;
            color: #fff;
        }
        .page-list-name {
            display: block;
            font-size: 12px;
            font-weight: 500;
            line-height: 1.3;
        }
        .page-list-id {
            display: block;
            font-size: 10px;
            color: #888;
            margin-top: 2px;
        }
        .page-list-item.active .page-list-id {
            color: #b3d4f5;
        }
        .widget-tree {
            list-style: none;
            margin: 0;
            padding: 4px 0 8px;
            font-size: 12px;
        }
        .widget-tree li {
            margin: 0;
            padding: 0;
        }
        .widget-tree-btn {
            display: block;
            width: 100%;
            text-align: left;
            border: none;
            background: transparent;
            color: #ccc;
            padding: 3px 8px;
            cursor: pointer;
            font: inherit;
            border-radius: 3px;
        }
        .widget-tree-btn:hover {
            background: #333;
        }
        .widget-tree-btn.active {
            background: #094771;
            color: #fff;
        }
        .widget-tree-btn .tree-type {
            color: #888;
            margin-right: 6px;
        }
        .widget-tree-btn.dragging {
            opacity: 0.45;
        }
        .widget-tree-btn.drop-into {
            background: #093d5a;
            outline: 1px dashed #4ea2e0;
            outline-offset: -2px;
        }
        .widget-tree-btn.drop-before {
            box-shadow: inset 0 2px 0 0 #4ea2e0;
        }
        .widget-tree-btn.drop-after {
            box-shadow: inset 0 -2px 0 0 #4ea2e0;
        }
        .flow-add-form {
            padding: 8px;
            border-bottom: 1px solid #3c3c3c;
            flex-shrink: 0;
            display: flex;
            flex-direction: column;
            gap: 6px;
        }
        .flow-field {
            display: flex;
            flex-direction: column;
            gap: 2px;
        }
        .flow-label {
            font-size: 10px;
            color: #888;
            text-transform: uppercase;
            letter-spacing: 0.04em;
        }
        .flow-add-form select,
        .flow-add-form input[type="number"] {
            width: 100%;
            background: #3c3c3c;
            color: #ccc;
            border: 1px solid #555;
            border-radius: 3px;
            padding: 4px 6px;
            font-size: 12px;
            font-family: inherit;
        }
        .flow-add-form .tb-btn-small {
            margin-top: 4px;
            width: 100%;
            font-size: 11px;
            padding: 5px 8px;
            background: #3c3c3c;
            color: #ccc;
            border: 1px solid #555;
            border-radius: 3px;
            cursor: pointer;
            font-family: inherit;
        }
        .flow-add-form .tb-btn-small:hover:not(:disabled) {
            background: #4a4a4a;
            color: #fff;
        }
        .flow-list {
            list-style: none;
            margin: 0;
            padding: 4px;
        }
        .flow-list-empty {
            font-size: 11px;
            color: #888;
            padding: 8px 10px;
            line-height: 1.4;
        }
        .flow-list-item {
            display: flex;
            align-items: stretch;
            gap: 4px;
            margin-bottom: 4px;
        }
        .flow-list-main {
            flex: 1;
            min-width: 0;
            text-align: left;
            padding: 8px 10px;
            border: 1px solid transparent;
            border-radius: 4px;
            background: transparent;
            color: #ccc;
            cursor: pointer;
            font-family: inherit;
        }
        .flow-list-main:hover {
            background: #3c3c3c;
            border-color: #555;
        }
        .flow-route {
            display: block;
            font-size: 12px;
            font-weight: 500;
            line-height: 1.35;
        }
        .flow-meta {
            display: block;
            font-size: 10px;
            color: #888;
            margin-top: 2px;
        }
        .flow-list-remove {
            flex-shrink: 0;
            font-size: 11px;
            padding: 4px 8px;
            background: #3c3c3c;
            color: #ccc;
            border: 1px solid #555;
            border-radius: 3px;
            cursor: pointer;
            font-family: inherit;
        }
        .flow-list-remove:hover {
            background: #5a2d2d;
            border-color: #a04040;
            color: #fff;
        }
        #sidebar-panel-flow {
            display: flex;
            flex-direction: column;
        }
        #sidebar-panel-components .palette-item {
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
        #sidebar-panel-components .palette-item:hover {
            background: #3c3c3c;
            color: #fff;
            border-color: #555;
        }
        #sidebar-panel-components .palette-item:active {
            background: #094771;
            border-color: #007acc;
            color: #fff;
        }
        #sidebar-panel-components .palette-item svg {
            width: 20px;
            height: 20px;
            pointer-events: none;
        }
        .palette-search {
            width: 100%;
            margin: 6px 0 8px;
            padding: 5px 8px;
            font-size: 12px;
            background: #2d2d2d;
            color: #ddd;
            border: 1px solid #555;
            border-radius: 3px;
            box-sizing: border-box;
        }
        .palette-item.palette-hidden {
            display: none;
        }
        .settings-panel-hint {
            font-size: 12px;
            color: #aaa;
            line-height: 1.45;
            margin: 8px 10px 12px;
        }
        .settings-panel-hint code {
            color: #9cdcfe;
        }
        #sidebar-panel-settings .tb-btn-small {
            margin: 0 10px 12px;
        }
        #canvas-container.show-bezel {
            padding: 16px;
        }
        #canvas-container.show-bezel #display-wrapper {
            box-shadow:
                0 0 0 10px #252526,
                0 0 0 12px #3c3c3c,
                0 12px 32px rgba(0, 0, 0, 0.45);
            border-radius: 6px;
        }
        #insert-widget-picker {
            display: none;
            position: absolute;
            z-index: 30;
            background: #252526;
            border: 1px solid #555;
            border-radius: 4px;
            padding: 6px;
            max-width: 200px;
            max-height: 240px;
            overflow: auto;
            box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
        }
        #insert-widget-picker.open {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 4px;
        }
        #insert-widget-picker .picker-item {
            padding: 6px;
            border: none;
            background: #333;
            color: #ccc;
            border-radius: 3px;
            cursor: pointer;
            font-size: 10px;
        }
        #insert-widget-picker .picker-item:hover {
            background: #094771;
            color: #fff;
        }
        #fps-label {
            font-size: 11px;
            color: #888;
            min-width: 52px;
            text-align: right;
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
            transition: width 0.15s ease, min-width 0.15s ease, max-width 0.15s ease;
        }
        #property-inspector.collapsed {
            flex: 0 0 26px;
            width: 26px;
            min-width: 26px;
            max-width: 26px;
        }
        #property-inspector.collapsed #inspector-collapsible {
            display: none;
        }
        #property-inspector.collapsed #inspector-header h2 {
            display: none;
        }
        #property-inspector.collapsed #inspector-header {
            flex: 1;
            justify-content: center;
            padding: 8px 0;
        }
        #inspector-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 4px;
            padding: 6px 6px 6px 12px;
            flex-shrink: 0;
            border-bottom: 1px solid #3c3c3c;
        }
        .dock-toggle-inspector {
            flex-shrink: 0;
            padding: 4px 6px;
            font-size: 14px;
        }
        #inspector-collapsible {
            flex: 1;
            display: flex;
            flex-direction: column;
            min-height: 0;
            overflow: hidden;
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
            padding: 0;
            margin: 0;
            flex: 1;
            min-width: 0;
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
        #inspector-form .styleref-list {
            display: flex;
            flex-direction: column;
            gap: 4px;
            padding: 4px;
            border: 1px solid #2f2f2f;
            border-radius: 3px;
            background: #1f1f1f;
        }
        #inspector-form .styleref-row {
            display: grid;
            grid-template-columns: 16px 1fr auto;
            gap: 6px;
            align-items: center;
            font-size: 11px;
        }
        #inspector-form .styleref-row .styleref-id {
            color: #888;
            font-family: ui-monospace, monospace;
            font-size: 10px;
        }
        #inspector-form .anim-row,
        #inspector-form .proj-style-row,
        #inspector-form .proj-field-row {
            border: 1px solid #2f2f2f;
            border-radius: 3px;
            padding: 6px;
            margin: 0 0 6px;
            background: #1f1f1f;
        }
        #inspector-form .inspector-group-title button.tb-btn-small {
            float: right;
            padding: 1px 6px;
            margin-top: -2px;
            font-weight: 700;
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
        #inspector-form .inspector-path-row {
            display: flex;
            align-items: center;
            gap: 6px;
        }
        #inspector-form .inspector-path-row input[type="text"] {
            flex: 1;
            min-width: 0;
            width: auto;
        }
        #inspector-form .inspector-path-row .tb-btn-small {
            flex-shrink: 0;
            font-size: 11px;
            padding: 4px 8px;
            background: #3c3c3c;
            color: #ccc;
            border: 1px solid #555;
            border-radius: 3px;
            cursor: pointer;
            font-family: inherit;
        }
        #inspector-form .inspector-path-row .tb-btn-small:hover {
            background: #4a4a4a;
            color: #fff;
        }
        #inspector-form .inspector-field-hint {
            font-size: 10px;
            color: #888;
            margin: -2px 0 8px;
            line-height: 1.35;
            word-break: break-all;
        }
        #inspector-form .image-src-combobox {
            position: relative;
            flex: 1;
            min-width: 0;
            z-index: 1;
        }
        #inspector-form .image-src-combobox input[type="text"] {
            width: 100%;
            box-sizing: border-box;
        }
        #inspector-form .image-asset-dropdown {
            position: absolute;
            left: 0;
            right: 0;
            top: calc(100% + 2px);
            z-index: 200;
            max-height: 160px;
            overflow-y: auto;
            background: #2d2d2d;
            border: 1px solid #555;
            border-radius: 4px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.45);
        }
        #inspector-form .image-asset-dropdown[hidden] {
            display: none !important;
        }
        #inspector-form .image-asset-dropdown-empty {
            padding: 8px 10px;
            font-size: 11px;
            color: #888;
        }
        #inspector-form .image-asset-option {
            display: flex;
            align-items: center;
            gap: 8px;
            width: 100%;
            padding: 4px 8px;
            border: none;
            background: transparent;
            color: #ddd;
            font-size: 11px;
            font-family: inherit;
            text-align: left;
            cursor: pointer;
        }
        #inspector-form .image-asset-option:hover,
        #inspector-form .image-asset-option:focus {
            background: #094771;
            color: #fff;
            outline: none;
        }
        #inspector-form .image-asset-option[aria-selected="true"] {
            background: #0e639c;
            color: #fff;
        }
        #inspector-form .image-asset-thumb {
            width: 22px;
            height: 22px;
            flex-shrink: 0;
            object-fit: contain;
            image-rendering: pixelated;
            background: #1e1e1e;
            border: 1px solid #444;
            border-radius: 2px;
        }
        #inspector-form .image-asset-thumb-placeholder {
            width: 22px;
            height: 22px;
            flex-shrink: 0;
            background: #1e1e1e;
            border: 1px dashed #555;
            border-radius: 2px;
        }
        #inspector-form .image-asset-option-text {
            min-width: 0;
            display: flex;
            flex-direction: column;
            gap: 1px;
        }
        #inspector-form .image-asset-option-id {
            font-weight: 600;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        #inspector-form .image-asset-option-path {
            font-size: 10px;
            color: #888;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
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
            position: relative;
            z-index: 0;
        }
        #image-preview-layer {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
            height: 100%;
            pointer-events: none;
            z-index: 1;
            overflow: hidden;
        }
        #image-preview-layer img {
            position: absolute;
            object-fit: fill;
            image-rendering: pixelated;
            pointer-events: none;
            box-sizing: border-box;
        }
        #design-overlay {
            position: absolute;
            inset: 0;
            display: block;
            cursor: default;
            z-index: 10;
            touch-action: none;
        }
        .ruler {
            position: absolute;
            background: #1f1f1f;
            z-index: 5;
            pointer-events: none;
            image-rendering: pixelated;
        }
        .ruler-top {
            left: 0;
            top: -20px;
            height: 20px;
        }
        .ruler-left {
            left: -20px;
            top: 0;
            width: 20px;
        }
        .ruler-corner {
            position: absolute;
            left: -20px;
            top: -20px;
            width: 20px;
            height: 20px;
            background: #1f1f1f;
            z-index: 5;
            pointer-events: none;
        }
        #display-wrapper.no-rulers .ruler,
        #display-wrapper.no-rulers .ruler-corner {
            display: none;
        }
        #canvas-container.pan-armed {
            cursor: grab;
        }
        #canvas-container.pan-active {
            cursor: grabbing;
        }
        #canvas-container.pan-armed #design-overlay,
        #canvas-container.pan-active #design-overlay {
            pointer-events: none;
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
            z-index: 21;
            pointer-events: auto;
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
            z-index: 20;
            pointer-events: none;
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
    <div id="toolbar-shell">
        <button type="button" id="btn-toggle-toolbar" class="dock-toggle dock-toggle-toolbar" aria-expanded="true" title="Hide toolbar">▲ Hide toolbar</button>
        <div id="toolbar">
        <button type="button" class="tb-btn" id="btn-new-project" title="Create a new .embf project file">New Project</button>
        <label>Page:</label>
        <select id="page-select"></select>
        <button type="button" class="tb-btn" id="btn-undo" disabled title="Undo (Ctrl+Z)">Undo</button>
        <button type="button" class="tb-btn" id="btn-redo" disabled title="Redo (Ctrl+Y)">Redo</button>
        <label title="Select and drag widgets; updates .embf position">
            <input type="checkbox" id="design-mode" checked />
            Design
        </label>
        <label title="Snap moves and resize to a pixel grid">
            <input type="checkbox" id="design-grid" />
            Grid
        </label>
        <label title="Show pixel rulers on the canvas edges">
            <input type="checkbox" id="design-rulers" />
            Rulers
        </label>
        <button type="button" class="tb-btn" id="btn-theme-toggle" title="Toggle light/dark preview theme">Theme</button>
        <label for="preview-zoom">Zoom:</label>
        <button type="button" class="tb-btn" id="btn-generate-code" title="Generate C UI files for this project">Generate C Code</button>
        <select id="preview-zoom" title="Preview scale only — device resolution stays in .embf">
            <option value="auto" selected>Auto</option>
            <option value="0.1">10%</option>
            <option value="0.25">25%</option>
            <option value="0.5">50%</option>
            <option value="0.75">75%</option>
            <option value="1">100%</option>
            <option value="2">200%</option>
            <option value="3">300%</option>
            <option value="4">400%</option>
        </select>
        <label for="toolbar-widget-select">Widget:</label>
        <select id="toolbar-widget-select" title="Select a widget on the current page"></select>
        <label title="Frame around the display in preview only">
            <input type="checkbox" id="preview-bezel" />
            Bezel
        </label>
        <span id="fps-label" title="Preview frame rate">— FPS</span>
        <span id="status">Waiting for project…</span>
        </div>
    </div>
    <div id="main">
        <aside id="left-sidebar" aria-label="Design sidebar">
            <div id="left-sidebar-header">
                <button type="button" id="btn-toggle-left-sidebar" class="dock-toggle dock-toggle-left-sidebar" aria-expanded="true" title="Hide sidebar">‹</button>
            </div>
            <div id="left-sidebar-body">
                <nav id="sidebar-rail" aria-label="Sidebar categories">
                    ${buildSidebarRailHtml()}
                </nav>
                <div id="sidebar-panel">
                    <div id="sidebar-panel-header"><span id="sidebar-panel-title">Components</span></div>
                    <div id="sidebar-panel-body">
                        ${buildSidebarPanelViewsHtml(buildComponentsSidebarHtml())}
                    </div>
                </div>
            </div>
        </aside>
        <div id="canvas-container">
        <div id="insert-widget-picker" role="menu" aria-label="Insert widget" hidden></div>
        <div id="display-wrapper" class="no-rulers">
            <div id="ruler-corner" class="ruler-corner" aria-hidden="true"></div>
            <canvas id="ruler-top" class="ruler ruler-top" aria-hidden="true"></canvas>
            <canvas id="ruler-left" class="ruler ruler-left" aria-hidden="true"></canvas>
            <canvas id="lvgl-canvas"></canvas>
            <div id="image-preview-layer" aria-hidden="true"></div>
            <canvas id="design-overlay"></canvas>
            <div id="error-overlay"></div>
            <div id="loading-overlay">
                <div class="spinner"></div>
                <span>Loading WASM…</span>
            </div>
        </div>
        </div>
        <aside id="property-inspector" aria-label="Properties">
            <div id="inspector-header">
                <h2>Properties</h2>
                <button type="button" id="btn-toggle-inspector" class="dock-toggle dock-toggle-inspector" aria-expanded="true" title="Hide properties panel">›</button>
            </div>
            <div id="inspector-collapsible">
                <div id="inspector-body">
                    <div id="inspector-empty">Design mode: click the page background for project, display, and page settings, or click a widget for its properties.</div>
                    <form id="inspector-form" hidden></form>
                </div>
                <button type="button" id="inspector-delete" disabled title="Delete selected widget">Delete widget</button>
            </div>
        </aside>
    </div>
    <script nonce="${nonce}" src="${webviewJsUri}"></script>
</body>
</html>`;
    }

    dispose(): void {
        this.clearInspectorReloadDebounce();
        EmbfPreviewPanel._panels.delete(this._filePath);
        if (EmbfPreviewPanel._lastActiveEmbfPath === this._filePath) {
            const remaining = EmbfPreviewPanel.getOpenEmbfPaths();
            EmbfPreviewPanel._lastActiveEmbfPath = remaining[0];
        }
        this._webviewReady = false;
        this._pendingMessage = null;
        this._panel.dispose();
        this._disposables.forEach(d => d.dispose());
        this._disposables = [];
    }
}

function workspaceCodegenOutputSetting(): string {
    return vscode.workspace.getConfiguration("embeddedflow").get<string>("outputDirectory", "") ?? "";
}

function getNonce(): string {
    let text = "";
    const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}
