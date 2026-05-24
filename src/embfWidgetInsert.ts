import * as path from "path";
import * as vscode from "vscode";
import type { EmbfProject } from "./types/embf";
import { isPaletteWidgetType } from "./embfPalette";
import { EmbfParseError } from "./embfParser";
import { buildNewComponent, cloneEmbfProject } from "./embfWidgetFactory";
import { readEmbfProject, writeEmbfProject } from "./embfProjectWrite";
import { embeddedFlowLog } from "./outputLog";

export { WIDGET_PALETTE_ORDER } from "./embfPalette";
export { buildNewComponent, collectAllComponentIds } from "./embfWidgetFactory";

/**
 * Append a widget to the given page in the `.embf` file on disk (or replace the open buffer).
 * @returns true if the file or buffer was updated successfully.
 */
export async function appendWidgetToEmbfFile(
    filePath: string,
    pageIndex: number,
    widgetType: string,
    at?: { x?: number; y?: number }
): Promise<boolean> {
    const t = widgetType.trim().toLowerCase();
    if (!isPaletteWidgetType(t)) {
        vscode.window.showErrorMessage(`EmbeddedFlow: unknown widget type "${widgetType}"`);
        return false;
    }

    let project: EmbfProject;
    try {
        project = readEmbfProject(filePath);
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
    if (at) {
        const ax = at.x;
        const ay = at.y;
        if (typeof ax === "number" && Number.isFinite(ax)) {
            comp.x = Math.max(0, Math.round(ax));
        }
        if (typeof ay === "number" && Number.isFinite(ay)) {
            comp.y = Math.max(0, Math.round(ay));
        }
    }
    page.components.push(comp);

    const ok = await writeEmbfProject(filePath, next);
    if (ok) {
        embeddedFlowLog("widgets", "info", `added ${t} "${comp.id}" → page "${page.id}" (${path.basename(filePath)})`);
    }
    return ok;
}
