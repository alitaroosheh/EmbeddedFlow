import * as fs from "fs";
import * as vscode from "vscode";
import type { EmbfProject } from "./types/embf";
import { EmbfParseError, parseEmbf, parseEmbfSource } from "./embfParser";
import { embeddedFlowLog } from "./outputLog";

function findEmbfDocument(filePath: string): vscode.TextDocument | undefined {
    return vscode.workspace.textDocuments.find(
        d => d.uri.scheme === "file" && d.uri.fsPath === filePath
    );
}

/** Read project from the open buffer when available, otherwise from disk. */
export function readEmbfProject(filePath: string): EmbfProject {
    const doc = findEmbfDocument(filePath);
    if (doc) {
        return parseEmbfSource(doc.getText());
    }
    return parseEmbf(filePath);
}

/**
 * Validate and write project JSON to the open buffer or disk.
 * @returns true on success.
 */
export async function writeEmbfProject(filePath: string, project: EmbfProject): Promise<boolean> {
    const json = JSON.stringify(project, null, 2);
    try {
        parseEmbfSource(json);
    } catch (e) {
        const msg = e instanceof EmbfParseError ? e.message : String(e);
        embeddedFlowLog("embf", "error", `validation failed before write: ${msg}`);
        vscode.window.showErrorMessage(`EmbeddedFlow: ${msg}`);
        return false;
    }

    const doc = findEmbfDocument(filePath);
    if (doc) {
        const edit = new vscode.WorkspaceEdit();
        const fullRange = new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length));
        edit.replace(doc.uri, fullRange, json);
        const ok = await vscode.workspace.applyEdit(edit);
        if (!ok) {
            vscode.window.showErrorMessage("EmbeddedFlow: could not apply edit to .embf buffer.");
            return false;
        }
        return true;
    }

    try {
        fs.writeFileSync(filePath, json, "utf-8");
        return true;
    } catch (e: any) {
        vscode.window.showErrorMessage(`EmbeddedFlow: failed to write file: ${e.message}`);
        return false;
    }
}
