import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { collectEmbfInRoots, isEmbfFilePath, listEmbfInDirectory } from "./embfDiscovery";

/**
 * Resolve which `.embf` file to preview.
 * - Explicit `.embf` URI → that file
 * - Folder URI → `.embf` in that folder (pick if several)
 * - No URI → active `.embf` editor, else workspace folder root(s)
 */
export async function resolveEmbfForPreview(uri?: vscode.Uri): Promise<string | undefined> {
    if (uri?.fsPath && isEmbfFilePath(uri.fsPath)) {
        return path.normalize(uri.fsPath);
    }

    if (!uri) {
        const active = vscode.window.activeTextEditor?.document;
        if (active?.fileName && isEmbfFilePath(active.fileName)) {
            return path.normalize(active.fileName);
        }
    }

    const searchRoots = searchRootsFromUri(uri);
    if (searchRoots.length === 0) {
        void vscode.window.showErrorMessage(
            "EmbeddedFlow: Open a workspace folder, or select a folder in the Explorer."
        );
        return undefined;
    }

    const candidates = collectEmbfInRoots(searchRoots);
    if (candidates.length === 0) {
        const hint =
            searchRoots.length === 1
                ? `No .embf file in "${path.basename(searchRoots[0])}".`
                : "No .embf file in workspace folder root(s).";
        void vscode.window.showErrorMessage(`EmbeddedFlow: ${hint}`);
        return undefined;
    }

    if (candidates.length === 1) {
        return candidates[0];
    }

    const pick = await vscode.window.showQuickPick(
        candidates.map(fp => ({
            label: path.basename(fp),
            description: path.dirname(fp),
            detail: fp
        })),
        {
            title: "Select embeddedflow project to preview",
            placeHolder: "Multiple .embf files found in the selected folder"
        }
    );
    return pick?.detail;
}

function searchRootsFromUri(uri?: vscode.Uri): string[] {
    if (uri?.fsPath) {
        try {
            const st = fs.statSync(uri.fsPath);
            if (st.isDirectory()) {
                return [path.normalize(uri.fsPath)];
            }
        } catch {
            return [];
        }
    }

    const folders = vscode.workspace.workspaceFolders;
    if (!folders?.length) {
        return [];
    }
    return folders.map(f => path.normalize(f.uri.fsPath));
}

/** For tests: roots used when a folder URI is provided. */
export function directoryFromUri(uri: vscode.Uri): string | undefined {
    try {
        const st = fs.statSync(uri.fsPath);
        if (st.isDirectory()) {
            return path.normalize(uri.fsPath);
        }
    } catch {
        /* ignore */
    }
    return undefined;
}

export { listEmbfInDirectory };
