import type { EmbfSymbolKind, SymbolNode } from "./types";

/** JSON-safe symbol node for webview picker / search (Phase 2 step 3.1). */
export interface WebviewSymbolNode {
    name: string;
    kind: EmbfSymbolKind;
    signature?: string;
    typeHint?: string;
    containerName?: string;
    filePath?: string;
    line?: number;
    children?: WebviewSymbolNode[];
}

export function toWebviewSymbolNode(node: SymbolNode, includeChildren = false): WebviewSymbolNode {
    const out: WebviewSymbolNode = {
        name: node.name,
        kind: node.kind
    };
    if (node.signature) {
        out.signature = node.signature;
    }
    if (node.typeHint) {
        out.typeHint = node.typeHint;
    }
    if (node.containerName) {
        out.containerName = node.containerName;
    }
    if (node.filePath) {
        out.filePath = node.filePath;
    }
    if (node.line !== undefined) {
        out.line = node.line;
    }
    if (includeChildren && node.children?.length) {
        out.children = node.children.map(c => toWebviewSymbolNode(c, true));
    }
    return out;
}

export function toWebviewSymbolNodes(nodes: SymbolNode[], includeChildren = false): WebviewSymbolNode[] {
    return nodes.map(n => toWebviewSymbolNode(n, includeChildren));
}
