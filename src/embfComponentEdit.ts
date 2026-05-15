import * as path from "path";
import * as vscode from "vscode";
import type { EmbfProject } from "./types/embf";
import { setComponentPositionOnPage } from "./embfComponentModel";
import { cloneEmbfProject } from "./embfWidgetFactory";
import { embeddedFlowLog } from "./outputLog";
import { readEmbfProject, writeEmbfProject } from "./embfProjectWrite";

export { setComponentPositionOnPage } from "./embfComponentModel";

/**
 * Move a widget on a page and persist to the `.embf` file or open editor buffer.
 */
export async function moveWidgetInEmbfFile(
    filePath: string,
    pageIndex: number,
    componentId: string,
    x: number,
    y: number
): Promise<boolean> {
    const id = componentId.trim();
    if (!id) {
        return false;
    }

    let project: EmbfProject;
    try {
        project = readEmbfProject(filePath);
    } catch (e) {
        vscode.window.showErrorMessage(`EmbeddedFlow: ${e instanceof Error ? e.message : String(e)}`);
        return false;
    }

    if (pageIndex < 0 || pageIndex >= project.pages.length) {
        vscode.window.showErrorMessage(`EmbeddedFlow: invalid page index ${pageIndex}`);
        return false;
    }

    const next = cloneEmbfProject(project);
    const page = next.pages[pageIndex];
    if (!setComponentPositionOnPage(page, id, x, y)) {
        vscode.window.showErrorMessage(`EmbeddedFlow: component "${id}" not found on this page.`);
        return false;
    }

    const ok = await writeEmbfProject(filePath, next);
    if (ok) {
        embeddedFlowLog(
            "widgets",
            "info",
            `moved "${id}" → (${Math.round(x)}, ${Math.round(y)}) on page "${page.id}" (${path.basename(filePath)})`
        );
    }
    return ok;
}
