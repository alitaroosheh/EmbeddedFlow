import { spawn, spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { pathToFileURL } from "url";
import { embeddedFlowLog } from "../outputLog";
import { LspClient } from "./lspClient";

export interface LspDocumentSymbol {
    name: string;
    detail?: string;
    kind: number;
    range: {
        start: { line: number; character: number };
        end: { line: number; character: number };
    };
    selectionRange?: {
        start: { line: number; character: number };
        end: { line: number; character: number };
    };
    children?: LspDocumentSymbol[];
}

export interface LspWorkspaceSymbol {
    name: string;
    kind: number;
    containerName?: string;
    location: {
        uri: string;
        range: { start: { line: number; character: number }; end: { line: number; character: number } };
    };
}

export interface LspHover {
    contents: string | { value: string } | { language: string; value: string }[] | { kind: string; value: string };
}

export interface LspCompletionItem {
    label: string;
    kind?: number;
    detail?: string;
    documentation?: string | { value: string };
}

function fileUri(absPath: string): string {
    return pathToFileURL(absPath).href;
}

function uriToPath(uri: string): string {
    try {
        return decodeURIComponent(new URL(uri).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
    } catch {
        return uri;
    }
}

/** Resolve clangd executable — config override or PATH. */
export function resolveClangdExecutable(configuredPath?: string): string | undefined {
    const candidate = (configuredPath ?? "clangd").trim() || "clangd";
    const probe = spawnSync(candidate, ["--version"], {
        encoding: "utf8",
        timeout: 8000,
        windowsHide: true
    });
    if (probe.status === 0) {
        return candidate;
    }
    return undefined;
}

/** SD1 + SD3: dedicated headless clangd per firmware project. */
export class ClangdSession {
    private readonly client: LspClient;
    private readonly opened = new Set<string>();
    private disposed = false;

    private constructor(client: LspClient, readonly firmwareRoot: string, readonly compileCommandsDir: string) {
        this.client = client;
    }

    static async start(
        firmwareRoot: string,
        compileCommandsDir: string,
        clangdPath: string
    ): Promise<ClangdSession> {
        const args = [
            `--compile-commands-dir=${compileCommandsDir}`,
            "--clang-tidy=0",
            "--header-insertion=never",
            "--log=error"
        ];
        embeddedFlowLog("clangd", "info", `Starting: ${clangdPath} ${args.join(" ")}`);
        const proc = spawn(clangdPath, args, {
            stdio: ["pipe", "pipe", "pipe"],
            windowsHide: true
        });
        const client = new LspClient(proc);
        const session = new ClangdSession(client, firmwareRoot, compileCommandsDir);
        await session.initialize();
        return session;
    }

    private async initialize(): Promise<void> {
        const rootUri = fileUri(this.firmwareRoot);
        await this.client.request("initialize", {
            processId: process.pid,
            rootUri,
            capabilities: {
                workspace: { symbol: { dynamicRegistration: false } },
                textDocument: {
                    synchronization: { dynamicRegistration: false },
                    documentSymbol: { dynamicRegistration: false },
                    hover: { contentFormat: ["plaintext", "markdown"] },
                    completion: { dynamicRegistration: false }
                }
            },
            workspaceFolders: [{ uri: rootUri, name: path.basename(this.firmwareRoot) }]
        });
        this.client.notify("initialized", {});
    }

    async shutdown(): Promise<void> {
        if (this.disposed) {
            return;
        }
        try {
            await this.client.request("shutdown", null, 5000);
            this.client.notify("exit", null);
        } catch {
            /* ignore */
        }
    }

    dispose(): void {
        if (this.disposed) {
            return;
        }
        this.disposed = true;
        void this.shutdown();
        this.client.dispose();
    }

    async workspaceSymbol(query: string): Promise<LspWorkspaceSymbol[]> {
        const result = await this.client.request<LspWorkspaceSymbol[] | null>("workspace/symbol", {
            query
        });
        return result ?? [];
    }

    async documentSymbol(filePath: string): Promise<LspDocumentSymbol[]> {
        await this.ensureOpen(filePath);
        const uri = fileUri(filePath);
        const result = await this.client.request<LspDocumentSymbol[] | LspDocumentSymbol | null>(
            "textDocument/documentSymbol",
            { textDocument: { uri } }
        );
        if (!result) {
            return [];
        }
        return Array.isArray(result) ? result : [result];
    }

    async hover(filePath: string, line: number, character: number): Promise<string | undefined> {
        await this.ensureOpen(filePath);
        const uri = fileUri(filePath);
        const result = await this.client.request<LspHover | null>(
            "textDocument/hover",
            {
                textDocument: { uri },
                position: { line, character }
            },
            15_000
        );
        return hoverToPlainText(result);
    }

    /** SD4: member completion after `struct_var.` */
    async completion(filePath: string, line: number, character: number): Promise<LspCompletionItem[]> {
        await this.ensureOpen(filePath);
        const uri = fileUri(filePath);
        const result = await this.client.request<{ items?: LspCompletionItem[] } | LspCompletionItem[] | null>(
            "textDocument/completion",
            {
                textDocument: { uri },
                position: { line, character }
            },
            15_000
        );
        if (!result) {
            return [];
        }
        if (Array.isArray(result)) {
            return result;
        }
        return result.items ?? [];
    }

    uriToPath(uri: string): string {
        return uriToPath(uri);
    }

    private async ensureOpen(filePath: string): Promise<void> {
        const norm = path.normalize(filePath);
        if (this.opened.has(norm)) {
            return;
        }
        const text = fs.readFileSync(norm, "utf8");
        const uri = fileUri(norm);
        this.client.notify("textDocument/didOpen", {
            textDocument: {
                uri,
                languageId: "c",
                version: 1,
                text
            }
        });
        this.opened.add(norm);
    }
}

function hoverToPlainText(hover: LspHover | null | undefined): string | undefined {
    if (!hover?.contents) {
        return undefined;
    }
    const c = hover.contents;
    if (typeof c === "string") {
        return c.trim() || undefined;
    }
    if ("value" in c && typeof c.value === "string") {
        return c.value.trim() || undefined;
    }
    if (Array.isArray(c)) {
        return c
            .map(part => ("value" in part ? part.value : String(part)))
            .join("\n")
            .trim() || undefined;
    }
    return undefined;
}

/** LSP SymbolKind values used by clangd. */
export const LSP_KIND = {
    Function: 12,
    Variable: 13,
    Field: 8,
    Method: 6,
    Struct: 23,
    Enum: 10,
    EnumMember: 22,
    Typedef: 5,
    Class: 7
} as const;

export function mapLspKind(kind: number): import("./types").EmbfSymbolKind {
    switch (kind) {
        case LSP_KIND.Function:
        case LSP_KIND.Method:
            return "function";
        case LSP_KIND.Variable:
            return "variable";
        case LSP_KIND.Struct:
        case LSP_KIND.Class:
            return "struct";
        case LSP_KIND.Field:
        case LSP_KIND.EnumMember:
            return "field";
        case LSP_KIND.Enum:
            return "enum";
        case LSP_KIND.Typedef:
            return "typedef";
        default:
            return "other";
    }
}

export { uriToPath };
