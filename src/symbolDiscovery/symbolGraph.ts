import * as path from "path";
import type { EmbfSymbolKind, SymbolGraph, SymbolNode } from "./types";
import {
    ClangdSession,
    LspDocumentSymbol,
    LspWorkspaceSymbol,
    LSP_KIND,
    mapLspKind
} from "./clangdSession";

const SIGNATURE_FETCH_LIMIT = 32;

/** Convert nested document symbols to SymbolNode tree (struct fields as children). */
export function documentSymbolsToNodes(
    symbols: LspDocumentSymbol[],
    filePath: string,
    parentName?: string
): SymbolNode[] {
    const out: SymbolNode[] = [];
    for (const sym of symbols) {
        const kind = mapLspKind(sym.kind);
        if (kind === "other" && !sym.children?.length) {
            continue;
        }
        const line = sym.selectionRange?.start.line ?? sym.range.start.line;
        const node: SymbolNode = {
            name: parentName ? `${parentName}.${sym.name}` : sym.name,
            kind,
            typeHint: sym.detail,
            containerName: parentName,
            filePath,
            line
        };
        if (sym.children?.length) {
            node.children = documentSymbolsToNodes(sym.children, filePath, sym.name);
        }
        out.push(node);
    }
    return out;
}

function workspaceSymbolToNode(sym: LspWorkspaceSymbol, session: ClangdSession): SymbolNode {
    const filePath = session.uriToPath(sym.location.uri);
    const kind = mapLspKind(sym.kind);
    return {
        name: sym.containerName ? `${sym.containerName}.${sym.name}` : sym.name,
        kind,
        containerName: sym.containerName,
        filePath,
        line: sym.location.range.start.line
    };
}

function mergeNodes(existing: SymbolNode[], incoming: SymbolNode[]): SymbolNode[] {
    const byKey = new Map<string, SymbolNode>();
    for (const n of existing) {
        byKey.set(nodeKey(n), n);
    }
    for (const n of incoming) {
        const key = nodeKey(n);
        const prev = byKey.get(key);
        if (!prev) {
            byKey.set(key, n);
            continue;
        }
        if (!prev.signature && n.signature) {
            prev.signature = n.signature;
        }
        if (!prev.typeHint && n.typeHint) {
            prev.typeHint = n.typeHint;
        }
        if (n.children?.length) {
            prev.children = mergeNodes(prev.children ?? [], n.children);
        }
    }
    return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function nodeKey(n: SymbolNode): string {
    return `${n.kind}:${n.name}:${n.filePath ?? ""}:${n.line ?? -1}`;
}

async function enrichFunctionSignatures(session: ClangdSession, nodes: SymbolNode[]): Promise<void> {
    let fetched = 0;
    for (const node of nodes) {
        if (node.kind === "function" && node.filePath !== undefined && node.line !== undefined && !node.signature) {
            if (fetched >= SIGNATURE_FETCH_LIMIT) {
                break;
            }
            fetched++;
            const hover = await session.hover(node.filePath, node.line, 0);
            if (hover) {
                node.signature = hover.split("\n")[0]?.trim();
            }
        }
        if (node.children?.length) {
            await enrichFunctionSignatures(session, node.children);
        }
    }
}

/** SD4 + SD5: build symbol graph from document + workspace LSP queries. */
export async function buildSymbolGraph(
    session: ClangdSession,
    link: { firmwareRoot: string; compileCommandsPath: string },
    sourceFiles: string[]
): Promise<SymbolGraph> {
    let nodes: SymbolNode[] = [];

    for (const filePath of sourceFiles) {
        try {
            const docSyms = await session.documentSymbol(filePath);
            nodes = mergeNodes(nodes, documentSymbolsToNodes(docSyms, filePath));
        } catch {
            /* skip unreadable TU */
        }
    }

    try {
        const globals = await session.workspaceSymbol("");
        const wsNodes = globals
            .filter(s => isInterestingWorkspaceKind(s.kind))
            .map(s => workspaceSymbolToNode(s, session));
        nodes = mergeNodes(nodes, wsNodes);
    } catch {
        /* workspace/symbol may be unsupported for empty query on some clangd versions */
    }

    await enrichFunctionSignatures(session, nodes);

    return {
        firmwareRoot: link.firmwareRoot,
        compileCommandsPath: link.compileCommandsPath,
        indexedAt: Date.now(),
        sourceFileCount: sourceFiles.length,
        symbols: nodes
    };
}

function isInterestingWorkspaceKind(kind: number): boolean {
    return (
        kind === LSP_KIND.Function ||
        kind === LSP_KIND.Variable ||
        kind === LSP_KIND.Struct ||
        kind === LSP_KIND.Enum ||
        kind === LSP_KIND.Typedef ||
        kind === LSP_KIND.Field
    );
}

/** Flatten graph for search / counts. */
export function flattenSymbolGraph(graph: SymbolGraph): SymbolNode[] {
    const out: SymbolNode[] = [];
    const walk = (nodes: SymbolNode[]) => {
        for (const n of nodes) {
            out.push(n);
            if (n.children?.length) {
                walk(n.children);
            }
        }
    };
    walk(graph.symbols);
    return out;
}

export function countSymbolsByKind(graph: SymbolGraph): Record<EmbfSymbolKind, number> {
    const counts: Record<EmbfSymbolKind, number> = {
        function: 0,
        variable: 0,
        struct: 0,
        field: 0,
        enum: 0,
        typedef: 0,
        other: 0
    };
    for (const n of flattenSymbolGraph(graph)) {
        counts[n.kind]++;
    }
    return counts;
}

/** Search symbol graph by prefix (case-insensitive). */
export function searchSymbolGraph(graph: SymbolGraph, query: string, limit = 50): SymbolNode[] {
    const q = query.trim().toLowerCase();
    if (!q) {
        return flattenSymbolGraph(graph).slice(0, limit);
    }
    return flattenSymbolGraph(graph)
        .filter(n => n.name.toLowerCase().includes(q))
        .slice(0, limit);
}

/** Resolve struct member children via LSP completion at `varName.` in a source file. */
export async function queryStructMembers(
    session: ClangdSession,
    filePath: string,
    line: number,
    structVarName: string
): Promise<SymbolNode[]> {
    const col = structVarName.length + 1;
    const items = await session.completion(filePath, line, col);
    return items.map(item => ({
        name: `${structVarName}.${item.label}`,
        kind: "field" as const,
        typeHint: item.detail,
        containerName: structVarName,
        filePath
    }));
}
