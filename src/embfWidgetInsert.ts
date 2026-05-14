import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import type { EmbfProject } from "./types/embf";
import { isPaletteWidgetType } from "./embfPalette";
import { EmbfParseError, parseEmbf, parseEmbfSource } from "./embfParser";
import { buildNewComponent, cloneEmbfProject } from "./embfWidgetFactory";
import { embeddedFlowLog } from "./outputLog";

export { WIDGET_PALETTE_ORDER } from "./embfPalette";
export { buildNewComponent, collectAllComponentIds } from "./embfWidgetFactory";

/**
 * Append a widget to the given page in the `.embf` file on disk (or replace the open buffer if clean).
 * @returns true if the file or buffer was updated successfully.
 */
export async function appendWidgetToEmbfFile(
    filePath: string,
    pageIndex: number,
    widgetType: string
): Promise<boolean> {
    const t = widgetType.trim().toLowerCase();
    if (!isPaletteWidgetType(t)) {
        vscode.window.showErrorMessage(`EmbeddedFlow: unknown widget type "${widgetType}"`);
        return false;
    }

    const doc = vscode.workspace.textDocuments.find(
        d => d.uri.scheme === "file" && d.uri.fsPath === filePath
    );
    if (doc?.isDirty) {
        vscode.window.showWarningMessage(
            "EmbeddedFlow: save the .embf file before adding widgets from the preview (buffer has unsaved changes)."
        );
        return false;
    }

    let project: EmbfProject;
    try {
        project = parseEmbf(filePath);
    } catch (e) {
        const msg = e instanceof EmbfParseError ? e.message : String(e);
        vscode.window.showErrorMessage(`EmbeddedFlow: ${msg}`);
        return false;
    }

    if (pageIndex < 0 || pageIndex >= project.pages.length) {
        vscode.window.showErrorMessage(`EmbeddedFlow: invalid page index ${pageIndex}`);
        return false;
    }

    const next = cloneEmbfProject(project);
    const page = next.pages[pageIndex];
    const comp = buildNewComponent(next, page, t);
    page.components.push(comp);

    const json = JSON.stringify(next, null, 2);
    try {
        parseEmbfSource(json);
    } catch (e) {
        const msg = e instanceof EmbfParseError ? e.message : String(e);
        embeddedFlowLog("widgets", "error", `validation failed after insert: ${msg}`);
        vscode.window.showErrorMessage(`EmbeddedFlow: ${msg}`);
        return false;
    }

    if (doc && !doc.isDirty) {
        const edit = new vscode.WorkspaceEdit();
        const fullRange = new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length));
        edit.replace(doc.uri, fullRange, json);
        const ok = await vscode.workspace.applyEdit(edit);
        if (!ok) {
            vscode.window.showErrorMessage("EmbeddedFlow: could not apply edit to .embf buffer.");
            return false;
        }
    } else {
        try {
            fs.writeFileSync(filePath, json, "utf-8");
        } catch (e: any) {
            vscode.window.showErrorMessage(`EmbeddedFlow: failed to write file: ${e.message}`);
            return false;
        }
    }

    embeddedFlowLog("widgets", "info", `added ${t} "${comp.id}" → page "${page.id}" (${path.basename(filePath)})`);
    return true;
}
