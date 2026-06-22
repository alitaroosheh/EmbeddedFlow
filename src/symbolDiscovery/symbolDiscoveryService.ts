import * as fs from "fs";
import * as path from "path";
import type { EmbfProject } from "../types/embf";
import { embeddedFlowLog } from "../outputLog";
import { ClangdSession } from "./clangdSession";
import { resolveClangdPath } from "./clangdBootstrap";
import {
    compileCommandsMtime,
    linkFirmwareProject,
    resolveFirmwareRootFromProject
} from "./firmwarePath";
import { fetchSymbolMembers, liveWorkspaceSearch } from "./symbolGraph";
import type { EmbfSymbolKind, SymbolIndexState, SymbolNode } from "./types";

interface SessionEntry {
    session: ClangdSession;
    compileCommandsMtime: number;
}

/**
 * SD1: dedicated clangd per firmware root.
 * Search is live via LSP as the user types (workspace/symbol + documentSymbol for members).
 */
export class SymbolDiscoveryService {
    private readonly sessions = new Map<string, SessionEntry>();
    private readonly watchers = new Map<string, fs.FSWatcher>();
    private readonly sessionStarts = new Map<string, Promise<ClangdSession>>();
    private clangdPath: string | undefined;
    private globalStoragePath: string | undefined;
    private configuredClangdOverride: string | undefined;

    setGlobalStoragePath(globalStoragePath: string): void {
        this.globalStoragePath = globalStoragePath;
        this.refreshClangdResolution();
    }

    setClangdPath(configuredPath?: string): void {
        this.configuredClangdOverride = configuredPath;
        this.refreshClangdResolution();
    }

    refreshClangdResolution(): void {
        this.clangdPath = resolveClangdPath({
            globalStoragePath: this.globalStoragePath,
            configuredPath: this.configuredClangdOverride
        });
    }

    dispose(): void {
        for (const w of this.watchers.values()) {
            w.close();
        }
        this.watchers.clear();
        for (const entry of this.sessions.values()) {
            entry.session.dispose();
        }
        this.sessions.clear();
        this.sessionStarts.clear();
    }

    /** Drop clangd session for a firmware tree (e.g. after rebuild). */
    invalidate(firmwareRoot?: string): void {
        if (firmwareRoot) {
            const key = path.normalize(firmwareRoot);
            this.disposeSession(key);
            return;
        }
        for (const key of [...this.sessions.keys()]) {
            this.disposeSession(key);
        }
    }

    peekState(project: EmbfProject, embfPath: string, workspaceFolders: string[] = []): SymbolIndexState {
        const link = linkFirmwareProject(project, embfPath, workspaceFolders);
        if (!link.ok) {
            return {
                status: link.code === "missing_firmware" ? "missing_firmware" : "error",
                message: link.message
            };
        }
        if (!this.clangdPath) {
            this.refreshClangdResolution();
        }
        if (!this.clangdPath) {
            return {
                status: "missing_clangd",
                message:
                    "clangd is not available. Run **EmbeddedFlow: Install requirements** to download it."
            };
        }
        return {
            status: "ready",
            message: "Type in the search box — results come from clangd as you type."
        };
    }

    /** Restart clangd for the linked firmware project (after rebuild / toolchain change). */
    async restartClangd(
        project: EmbfProject,
        embfPath: string,
        workspaceFolders: string[] = []
    ): Promise<SymbolIndexState> {
        const link = linkFirmwareProject(project, embfPath, workspaceFolders);
        if (!link.ok) {
            return {
                status: link.code === "missing_firmware" ? "missing_firmware" : "error",
                message: link.message
            };
        }
        const key = path.normalize(link.firmwareRoot);
        this.disposeSession(key);
        embeddedFlowLog("symbols", "info", `clangd session cleared for ${link.firmwareRoot}`);
        return this.peekState(project, embfPath, workspaceFolders);
    }

    /** @deprecated Use restartClangd — kept for command compatibility. */
    async indexProject(
        project: EmbfProject,
        embfPath: string,
        workspaceFolders: string[] = [],
        _opts?: { force?: boolean }
    ): Promise<SymbolIndexState> {
        return this.restartClangd(project, embfPath, workspaceFolders);
    }

    /** Live LSP symbol search (IntelliSense-style) as the user types. */
    async searchSymbols(
        project: EmbfProject,
        embfPath: string,
        query: string,
        workspaceFolders: string[] = [],
        opts?: { limit?: number; kinds?: EmbfSymbolKind[] }
    ): Promise<{ nodes: SymbolNode[]; state: SymbolIndexState }> {
        const link = linkFirmwareProject(project, embfPath, workspaceFolders);
        if (!link.ok) {
            return {
                nodes: [],
                state: {
                    status: link.code === "missing_firmware" ? "missing_firmware" : "error",
                    message: link.message
                }
            };
        }

        const q = query.trim();
        if (!q) {
            return { nodes: [], state: this.peekState(project, embfPath, workspaceFolders) };
        }

        const sessionResult = await this.ensureSession(link);
        if (sessionResult.state.status !== "ready" || !sessionResult.session) {
            return { nodes: [], state: sessionResult.state };
        }

        try {
            const limit = opts?.limit ?? 50;
            const nodes = await liveWorkspaceSearch(sessionResult.session, q, {
                limit,
                kinds: opts?.kinds,
                firmwareRoot: link.firmwareRoot
            });
            return { nodes, state: { status: "ready" } };
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            embeddedFlowLog("symbols", "error", `searchSymbols: ${msg}`);
            return { nodes: [], state: { status: "error", message: msg } };
        }
    }

    /** Struct / union / class members for a picked symbol (documentSymbol + completion). */
    async getSymbolMembers(
        project: EmbfProject,
        embfPath: string,
        target: { name: string; filePath?: string; line?: number },
        workspaceFolders: string[] = []
    ): Promise<{ members: SymbolNode[]; state: SymbolIndexState }> {
        const link = linkFirmwareProject(project, embfPath, workspaceFolders);
        if (!link.ok) {
            return {
                members: [],
                state: {
                    status: link.code === "missing_firmware" ? "missing_firmware" : "error",
                    message: link.message
                }
            };
        }
        if (!target.filePath || target.line === undefined) {
            return {
                members: [],
                state: { status: "error", message: "Symbol has no source location for member lookup." }
            };
        }

        const sessionResult = await this.ensureSession(link);
        if (sessionResult.state.status !== "ready" || !sessionResult.session) {
            return { members: [], state: sessionResult.state };
        }

        try {
            const members = await fetchSymbolMembers(
                sessionResult.session,
                target.filePath,
                target.line,
                target.name
            );
            return { members, state: { status: "ready" } };
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            return { members: [], state: { status: "error", message: msg } };
        }
    }

    onFirmwarePathChanged(embfPath: string, project: EmbfProject): void {
        const root = resolveFirmwareRootFromProject(project, embfPath);
        if (root) {
            this.invalidate(root);
        }
    }

    private disposeSession(key: string): void {
        const entry = this.sessions.get(key);
        if (entry) {
            entry.session.dispose();
            this.sessions.delete(key);
        }
        this.sessionStarts.delete(key);
        const watcher = this.watchers.get(key);
        if (watcher) {
            watcher.close();
            this.watchers.delete(key);
        }
    }

    private async ensureSession(
        link: Extract<ReturnType<typeof linkFirmwareProject>, { ok: true }>
    ): Promise<{ session?: ClangdSession; state: SymbolIndexState }> {
        if (!this.clangdPath) {
            this.refreshClangdResolution();
        }
        if (!this.clangdPath) {
            return {
                state: {
                    status: "missing_clangd",
                    message:
                        "clangd is not available. Run **EmbeddedFlow: Install requirements** to download it."
                }
            };
        }

        const key = path.normalize(link.firmwareRoot);
        const mtime = compileCommandsMtime(link.compileCommandsPath);
        const existing = this.sessions.get(key);
        if (existing && existing.compileCommandsMtime === mtime) {
            return { session: existing.session, state: { status: "ready" } };
        }
        if (existing) {
            this.disposeSession(key);
        }

        let pending = this.sessionStarts.get(key);
        if (!pending) {
            pending = ClangdSession.start(link.firmwareRoot, link.compileCommandsDir, this.clangdPath).then(
                session => {
                    this.sessions.set(key, { session, compileCommandsMtime: mtime });
                    this.sessionStarts.delete(key);
                    this.ensureCompileCommandsWatcher(key, link.compileCommandsPath, mtime);
                    embeddedFlowLog("symbols", "info", `clangd ready for ${link.firmwareRoot}`);
                    return session;
                }
            );
            this.sessionStarts.set(key, pending);
        }

        try {
            const session = await pending;
            return { session, state: { status: "ready" } };
        } catch (e) {
            this.sessionStarts.delete(key);
            const msg = e instanceof Error ? e.message : String(e);
            return { state: { status: "error", message: msg } };
        }
    }

    private ensureCompileCommandsWatcher(
        cacheKey: string,
        compileCommandsPath: string,
        mtime: number
    ): void {
        if (this.watchers.has(cacheKey)) {
            return;
        }
        try {
            const watcher = fs.watch(compileCommandsPath, () => {
                const next = compileCommandsMtime(compileCommandsPath);
                if (next !== mtime) {
                    embeddedFlowLog("symbols", "info", "compile_commands.json changed — restarting clangd");
                    this.disposeSession(cacheKey);
                }
            });
            this.watchers.set(cacheKey, watcher);
        } catch (e) {
            embeddedFlowLog("symbols", "warn", `Could not watch compile_commands.json: ${String(e)}`);
        }
    }
}

export const symbolDiscovery = new SymbolDiscoveryService();

export function symbolIndexSummary(state: SymbolIndexState): string {
    if (state.status === "ready") {
        return state.message ?? "clangd ready";
    }
    return state.message ?? state.status;
}
