import * as path from "path";
import * as vscode from "vscode";
import type { Component, EmbfProject, Page } from "./types/embf";
import {
    combineWidgetsOnPage,
    deleteComponentOnPage,
    patchComponentOnPage,
    setComponentPositionOnPage,
    applyPageInspectorPatch,
    bulkSetAbsolutePositionsOnPage,
    bulkPatchComponentsOnPage,
    bulkDeleteComponentsOnPage,
    duplicateComponentsOnPage,
    pasteComponentsOnPage,
    reorderComponentZOrderOnPage,
    ungroupContainerOnPage,
    type ZOrderAction
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
    edit: (page: Page, project: EmbfProject) => boolean,
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
    if (!edit(page, next)) {
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

export async function duplicateWidgetsInEmbfFile(
    filePath: string,
    pageIndex: number,
    componentIds: string[]
): Promise<string[]> {
    if (!componentIds?.length) {
        return [];
    }

    let newIds: string[] = [];
    const ok = await persistPageEdit(filePath, pageIndex, (page, project) => {
        newIds = duplicateComponentsOnPage(page, project, componentIds);
        return newIds.length > 0;
    });
    if (ok && newIds.length) {
        embeddedFlowLog(
            "widgets",
            "info",
            `duplicated ${newIds.length} (${path.basename(filePath)}): ${newIds.join(", ")}`
        );
    }
    return ok ? newIds : [];
}

export async function reorderWidgetInEmbfFile(
    filePath: string,
    pageIndex: number,
    componentId: string,
    action: ZOrderAction
): Promise<boolean> {
    const id = componentId.trim();
    if (!id) {
        return false;
    }
    const ok = await persistPageEdit(
        filePath,
        pageIndex,
        page => reorderComponentZOrderOnPage(page, id, action),
        () => vscode.window.showErrorMessage(`EmbeddedFlow: component "${id}" not found on this page.`)
    );
    if (ok) {
        embeddedFlowLog("widgets", "info", `z-order ${action} "${id}" (${path.basename(filePath)})`);
    }
    return ok;
}

export async function pasteWidgetsInEmbfFile(
    filePath: string,
    pageIndex: number,
    components: Component[]
): Promise<string[]> {
    if (!components?.length) {
        return [];
    }
    let newIds: string[] = [];
    const ok = await persistPageEdit(filePath, pageIndex, (page, project) => {
        newIds = pasteComponentsOnPage(page, project, components);
        return newIds.length > 0;
    });
    if (ok && newIds.length) {
        embeddedFlowLog(
            "widgets",
            "info",
            `pasted ${newIds.length} (${path.basename(filePath)})`
        );
    }
    return ok ? newIds : [];
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

/** Wrap selected sibling widgets into a new container (group); caller should refresh preview with returned id. */
export async function combineWidgetsInEmbfFile(
    filePath: string,
    pageIndex: number,
    orderedComponentIds: string[]
): Promise<{ ok: true; containerId: string } | { ok: false }> {
    const idsRaw = [...new Set(orderedComponentIds.map(id => String(id ?? "").trim()).filter(Boolean))];
    if (idsRaw.length < 2) {
        await vscode.window.showErrorMessage(`EmbeddedFlow: Select at least two widgets to combine.`);
        return { ok: false };
    }

    let result: { containerId: string } | undefined;
    let reason = "";

    const ok = await persistPageEdit(filePath, pageIndex, (page, proj) => {
        const r = combineWidgetsOnPage(proj, page, idsRaw);
        if (r.ok) {
            result = { containerId: r.containerId };
            return true;
        }
        reason = r.reason;
        return false;
    });

    if (!ok || !result) {
        if (reason) {
            await vscode.window.showErrorMessage(`EmbeddedFlow: ${reason}`);
        }
        return { ok: false };
    }
    embeddedFlowLog("widgets", "info", `combined → ${result.containerId} (${path.basename(filePath)})`);
    return { ok: true, containerId: result.containerId };
}

/** Lift container/panel children back to its parent sibling list (ungroup). */
export async function ungroupWidgetInEmbfFile(filePath: string, pageIndex: number, componentId: string): Promise<
    | { ok: true; liftedIds: string[] }
    | { ok: false }
> {
    const id = String(componentId ?? "").trim();
    if (!id) {
        return { ok: false };
    }

    let lifted: string[] = [];
    let reason = "";

    const ok = await persistPageEdit(filePath, pageIndex, page => {
        const r = ungroupContainerOnPage(page, id);
        if (r.ok) {
            lifted = r.liftedIds;
            return true;
        }
        reason = r.reason;
        return false;
    });

    if (!ok || !lifted.length) {
        if (reason) {
            await vscode.window.showErrorMessage(`EmbeddedFlow: ${reason}`);
        }
        return { ok: false };
    }
    embeddedFlowLog("widgets", "info", `ungrouped "${id}" → ${lifted.length} widgets (${path.basename(filePath)})`);
    return { ok: true, liftedIds: lifted };
}
