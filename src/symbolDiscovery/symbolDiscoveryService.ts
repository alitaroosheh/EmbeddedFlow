import * as fs from "fs";
import * as path from "path";
import type { EmbfProject } from "../types/embf";
import { embeddedFlowLog } from "../outputLog";
import { listIndexSourceFiles } from "./compileCommandsIndex";
import { ClangdSession, resolveClangdExecutable } from "./clangdSession";
import {
    compileCommandsMtime,
    linkFirmwareProject,
    resolveFirmwareRootFromProject
} from "./firmwarePath";
import { buildSymbolGraph, countSymbolsByKind, flattenSymbolGraph } from "./symbolGraph";
import type { SymbolGraph, SymbolIndexState, SymbolNode } from "./types";

interface CacheEntry {
    mtime: number;
    graph: SymbolGraph;
}

interface SessionEntry {
    session: ClangdSession;
    refCount: number;
}

/**
 * SD1 + SD5 + FR-SYM-08: one clangd session per firmware root; graph cached until compile_commands changes.
 * Q3 decision: clangd starts lazily on first index request (preview load with firmwarePath, or Refresh command).
 */
export class SymbolDiscoveryService {
    private readonly graphs = new Map<string, CacheEntry>();
    private readonly sessions = new Map<string, SessionEntry>();
    private readonly watchers = new Map<string, fs.FSWatcher>();
    private readonly inflight = new Map<string, Promise<SymbolIndexState>>();
    private clangdPath: string | undefined;

    setClangdPath(configuredPath?: string): void {
        this.clangdPath = resolveClangdExecutable(configuredPath);
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
        this.graphs.clear();
        this.inflight.clear();
    }

    invalidate(firmwareRoot?: string): void {
        if (firmwareRoot) {
            const key = path.normalize(firmwareRoot);
            this.graphs.delete(key);
            return;
        }
        this.graphs.clear();
    }

    getCachedGraph(firmwareRoot: string): SymbolGraph | undefined {
        const key = path.normalize(firmwareRoot);
        return this.graphs.get(key)?.graph;
    }

    /** Current index state without starting a new index. */
    peekState(project: EmbfProject, embfPath: string, workspaceFolders: string[] = []): SymbolIndexState {
        const link = linkFirmwareProject(project, embfPath, workspaceFolders);
        if (!link.ok) {
            return {
                status: link.code === "missing_firmware" ? "missing_firmware" : "error",
                message: link.message
            };
        }
        const key = path.normalize(link.firmwareRoot);
        const mtime = compileCommandsMtime(link.compileCommandsPath);
        const cached = this.graphs.get(key);
        if (cached && cached.mtime === mtime) {
            return { status: "ready", graph: cached.graph };
        }
        if (this.inflight.has(key)) {
            return { status: "indexing", message: "Symbol index in progress…" };
        }
        return {
            status: "idle",
            message: "Symbol index not built yet. Use Refresh Symbol Index or open preview with firmware path set."
        };
    }

    async indexProject(
        project: EmbfProject,
        embfPath: string,
        workspaceFolders: string[] = [],
        opts?: { force?: boolean }
    ): Promise<SymbolIndexState> {
        const link = linkFirmwareProject(project, embfPath, workspaceFolders);
        if (!link.ok) {
            return {
                status: link.code === "missing_firmware" ? "missing_firmware" : "error",
                message: link.message
            };
        }

        if (!this.clangdPath) {
            this.clangdPath = resolveClangdExecutable();
        }
        if (!this.clangdPath) {
            return {
                status: "missing_clangd",
                message:
                    "clangd was not found on PATH. Install LLVM/clangd and ensure `clangd --version` works, " +
                    "or set embeddedflow.clangdPath in VS Code settings."
            };
        }

        const key = path.normalize(link.firmwareRoot);
        const mtime = compileCommandsMtime(link.compileCommandsPath);
        const cached = this.graphs.get(key);
        if (!opts?.force && cached && cached.mtime === mtime) {
            return { status: "ready", graph: cached.graph };
        }

        const existing = this.inflight.get(key);
        if (existing) {
            return existing;
        }

        const task = this.runIndex(link, key, mtime);
        this.inflight.set(key, task);
        try {
            return await task;
        } finally {
            this.inflight.delete(key);
        }
    }

    async searchSymbols(
        project: EmbfProject,
        embfPath: string,
        query: string,
        workspaceFolders: string[] = []
    ): Promise<{ nodes: SymbolNode[]; state: SymbolIndexState }> {
        const state = await this.indexProject(project, embfPath, workspaceFolders);
        if (state.status !== "ready" || !state.graph) {
            return { nodes: [], state };
        }
        const q = query.trim().toLowerCase();
        const all = flattenSymbolGraph(state.graph);
        const nodes = q
            ? all.filter(n => n.name.toLowerCase().includes(q)).slice(0, 50)
            : all.slice(0, 50);
        return { nodes, state };
    }

    private async runIndex(
        link: Extract<ReturnType<typeof linkFirmwareProject>, { ok: true }>,
        key: string,
        mtime: number
    ): Promise<SymbolIndexState> {
        try {
            embeddedFlowLog("symbols", "info", `Indexing ${link.firmwareRoot}`);
            const session = await this.acquireSession(key, link.firmwareRoot, link.compileCommandsDir);
            const sourceFiles = listIndexSourceFiles(link.compileCommandsPath, link.firmwareRoot);
            if (sourceFiles.length === 0) {
                return {
                    status: "error",
                    message: `No indexable source files found in ${link.compileCommandsPath}`
                };
            }
            const graph = await buildSymbolGraph(session, link, sourceFiles);
            this.graphs.set(key, { mtime, graph });
            this.ensureCompileCommandsWatcher(key, link.compileCommandsPath);
            const counts = countSymbolsByKind(graph);
            embeddedFlowLog(
                "symbols",
                "info",
                `Indexed ${flattenSymbolGraph(graph).length} symbols from ${sourceFiles.length} files ` +
                    `(fn=${counts.function}, var=${counts.variable}, struct=${counts.struct}, field=${counts.field})`
            );
            return { status: "ready", graph };
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            embeddedFlowLog("symbols", "error", `Index failed: ${msg}`);
            return { status: "error", message: msg };
        }
    }

    private async acquireSession(
        key: string,
        firmwareRoot: string,
        compileCommandsDir: string
    ): Promise<ClangdSession> {
        let entry = this.sessions.get(key);
        if (!entry) {
            const session = await ClangdSession.start(firmwareRoot, compileCommandsDir, this.clangdPath!);
            entry = { session, refCount: 0 };
            this.sessions.set(key, entry);
        }
        entry.refCount++;
        return entry.session;
    }

    private ensureCompileCommandsWatcher(cacheKey: string, compileCommandsPath: string): void {
        if (this.watchers.has(cacheKey)) {
            return;
        }
        try {
            const watcher = fs.watch(compileCommandsPath, () => {
                embeddedFlowLog("symbols", "info", `compile_commands.json changed — invalidating cache`);
                this.graphs.delete(cacheKey);
            });
            this.watchers.set(cacheKey, watcher);
        } catch (e) {
            embeddedFlowLog("symbols", "warn", `Could not watch compile_commands.json: ${String(e)}`);
        }
    }

    /** Invalidate when .embf firmwarePath changes. */
    onFirmwarePathChanged(embfPath: string, project: EmbfProject): void {
        const root = resolveFirmwareRootFromProject(project, embfPath);
        if (root) {
            this.invalidate(root);
        }
    }
}

export const symbolDiscovery = new SymbolDiscoveryService();

export function symbolIndexSummary(state: SymbolIndexState): string {
    if (state.status === "ready" && state.graph) {
        const n = flattenSymbolGraph(state.graph).length;
        return `${n} symbols indexed`;
    }
    return state.message ?? state.status;
}
