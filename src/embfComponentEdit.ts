import * as path from "path";
import * as vscode from "vscode";
import type { EmbfProject, Page } from "./types/embf";
import {
    deleteComponentOnPage,
    patchComponentOnPage,
    setComponentPositionOnPage,
    applyPageInspectorPatch,
    bulkSetAbsolutePositionsOnPage,
    bulkPatchComponentsOnPage,
    bulkDeleteComponentsOnPage
} from "./embfComponentModel";
import { cloneEmbfProject } from "./embfWidgetFactory";
import { embeddedFlowLog } from "./outputLog";
import { readEmbfProject, writeEmbfProject } from "./embfProjectWrite";

export {
    applyComponentPatch,
    deleteComponentOnPage,
    findComponentOnPage,
    patchComponentOnPage,
    setComponentPositionOnPage
} from "./embfComponentModel";

async function persistPageEdit(
    filePath: string,
    pageIndex: number,
    edit: (page: Page) => boolean,
    onNotFound?: () => void
): Promise<boolean> {
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
    if (!edit(page)) {
        onNotFound?.();
        return false;
    }

    return writeEmbfProject(filePath, next);
}

async function persistProjectEdit(filePath: string, edit: (project: EmbfProject) => boolean): Promise<boolean> {
    let project: EmbfProject;
    try {
        project = readEmbfProject(filePath);
    } catch (e) {
        vscode.window.showErrorMessage(`EmbeddedFlow: ${e instanceof Error ? e.message : String(e)}`);
        return false;
    }

    const next = cloneEmbfProject(project);
    if (!edit(next)) {
        return false;
    }

    return writeEmbfProject(filePath, next);
}

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

    const ok = await persistPageEdit(
        filePath,
        pageIndex,
        page => setComponentPositionOnPage(page, id, x, y),
        () => vscode.window.showErrorMessage(`EmbeddedFlow: component "${id}" not found on this page.`)
    );
    if (ok) {
        embeddedFlowLog(
            "widgets",
            "info",
            `moved "${id}" → (${Math.round(x)}, ${Math.round(y)}) (${path.basename(filePath)})`
        );
    }
    return ok;
}

/**
 * Update inspector-editable fields on a component.
 */
export async function updateWidgetInEmbfFile(
    filePath: string,
    pageIndex: number,
    componentId: string,
    patch: Record<string, unknown>
): Promise<boolean> {
    const id = componentId.trim();
    if (!id || Object.keys(patch).length === 0) {
        return false;
    }

    const ok = await persistPageEdit(
        filePath,
        pageIndex,
        page => patchComponentOnPage(page, id, patch),
        () => vscode.window.showErrorMessage(`EmbeddedFlow: component "${id}" not found on this page.`)
    );
    if (ok) {
        embeddedFlowLog("widgets", "info", `updated "${id}" (${path.basename(filePath)})`);
    }
    return ok;
}

/**
 * Update page + theme fields from the page-level inspector (background, title, theme.dark).
 */
export async function updatePageInEmbfFile(
    filePath: string,
    pageIndex: number,
    patch: Record<string, unknown>
): Promise<boolean> {
    if (
        pageIndex < 0 ||
        !patch ||
        typeof patch !== "object" ||
        Object.keys(patch).length === 0
    ) {
        return false;
    }

    const ok = await persistProjectEdit(filePath, project =>
        applyPageInspectorPatch(project, pageIndex, patch)
    );
    if (ok) {
        embeddedFlowLog("widgets", "info", `updated page idx ${pageIndex} (${path.basename(filePath)})`);
    }
    return ok;
}

export async function bulkMoveWidgetsInEmbfFile(
    filePath: string,
    pageIndex: number,
    moves: { componentId: string; absX: number; absY: number }[]
): Promise<boolean> {
    if (!moves?.length) {
        return false;
    }

    const ok = await persistPageEdit(filePath, pageIndex, page =>
        bulkSetAbsolutePositionsOnPage(page, moves)
    );
    if (ok) {
        embeddedFlowLog("widgets", "info", `bulk move ${moves.length} (${path.basename(filePath)})`);
    }
    return ok;
}

export async function bulkPatchWidgetsInEmbfFile(
    filePath: string,
    pageIndex: number,
    updates: { componentId: string; patch: Record<string, unknown> }[]
): Promise<boolean> {
    if (!updates?.length) {
        return false;
    }

    const ok = await persistPageEdit(filePath, pageIndex, page => bulkPatchComponentsOnPage(page, updates));
    if (ok) {
        embeddedFlowLog("widgets", "info", `bulk patch ${updates.length} (${path.basename(filePath)})`);
    }
    return ok;
}

export async function bulkDeleteWidgetsInEmbfFile(
    filePath: string,
    pageIndex: number,
    componentIds: string[]
): Promise<boolean> {
    if (!componentIds?.length) {
        return false;
    }

    const ok = await persistPageEdit(filePath, pageIndex, page =>
        bulkDeleteComponentsOnPage(page, componentIds)
    );
    if (ok) {
        embeddedFlowLog("widgets", "info", `bulk delete ${componentIds.length} (${path.basename(filePath)})`);
    }
    return ok;
}

/**
 * Remove a component from a page.
 */
export async function deleteWidgetFromEmbfFile(
    filePath: string,
    pageIndex: number,
    componentId: string
): Promise<boolean> {
    const id = componentId.trim();
    if (!id) {
        return false;
    }

    const ok = await persistPageEdit(
        filePath,
        pageIndex,
        page => deleteComponentOnPage(page, id),
        () => vscode.window.showErrorMessage(`EmbeddedFlow: component "${id}" not found on this page.`)
    );
    if (ok) {
        embeddedFlowLog("widgets", "info", `deleted "${id}" (${path.basename(filePath)})`);
    }
    return ok;
}
