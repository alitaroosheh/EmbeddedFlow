/** Normalized symbol kinds for binding / picker (Phase 2 Milestone 1). */
export type EmbfSymbolKind =
    | "function"
    | "variable"
    | "struct"
    | "field"
    | "enum"
    | "typedef"
    | "other";

export interface SymbolNode {
    /** Leaf or qualified display name (e.g. `app_data.temp_c`). */
    name: string;
    kind: EmbfSymbolKind;
    /** Function signature or hover text when available. */
    signature?: string;
    /** Variable / field type hint from hover or detail. */
    typeHint?: string;
    containerName?: string;
    filePath?: string;
    line?: number;
    children?: SymbolNode[];
}

export interface SymbolGraph {
    firmwareRoot: string;
    compileCommandsPath: string;
    indexedAt: number;
    sourceFileCount: number;
    symbols: SymbolNode[];
}

export type SymbolIndexStatus = "idle" | "indexing" | "ready" | "error" | "missing_firmware" | "missing_clangd";

export interface SymbolIndexState {
    status: SymbolIndexStatus;
    message?: string;
    graph?: SymbolGraph;
}

export interface FirmwareLinkResult {
    ok: true;
    firmwareRoot: string;
    compileCommandsPath: string;
    compileCommandsDir: string;
}

export interface FirmwareLinkError {
    ok: false;
    code: "missing_firmware" | "missing_compile_commands" | "invalid_path";
    message: string;
}

export type FirmwareLink = FirmwareLinkResult | FirmwareLinkError;
