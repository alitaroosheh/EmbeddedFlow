import * as path from "path";
import * as vscode from "vscode";
import {
    addPageToProject,
    removePageFromProject,
    renamePageOnProject
} from "./embfComponentModel";
import { cloneEmbfProject } from "./embfWidgetFactory";
import { embeddedFlowLog } from "./outputLog";
import { readEmbfProject, writeEmbfProject } from "./embfProjectWrite";

export async function addPageInEmbfFile(
    filePath: string
): Promise<{ ok: boolean; pageIndex?: number }> {
    let project;
    try {
        project = readEmbfProject(filePath);
    } catch (e) {
        vscode.window.showErrorMessage(`EmbeddedFlow: ${e instanceof Error ? e.message : String(e)}`);
        return { ok: false };
    }

    const next = cloneEmbfProject(project);
    const pageIndex = addPageToProject(next);
    const ok = await writeEmbfProject(filePath, next);
    if (ok) {
        embeddedFlowLog(
            "pages",
            "info",
            `added page "${next.pages[pageIndex].id}" (${path.basename(filePath)})`
        );
        return { ok: true, pageIndex };
    }
    return { ok: false };
}

export async function removePageInEmbfFile(
    filePath: string,
    pageIndex: number
): Promise<{ ok: boolean; pageIndex?: number }> {
    let project;
    try {
        project = readEmbfProject(filePath);
    } catch (e) {
        vscode.window.showErrorMessage(`EmbeddedFlow: ${e instanceof Error ? e.message : String(e)}`);
        return { ok: false };
    }

    if (project.pages.length <= 1) {
        vscode.window.showWarningMessage("EmbeddedFlow: Cannot remove the only page in the project.");
        return { ok: false };
    }

    const page = project.pages[pageIndex];
    if (!page) {
        vscode.window.showErrorMessage(`EmbeddedFlow: invalid page index ${pageIndex}`);
        return { ok: false };
    }

    const choice = await vscode.window.showWarningMessage(
        `Remove page "${page.name}" (${page.id}) and all its widgets?`,
        { modal: true },
        "Remove",
        "Cancel"
    );
    if (choice !== "Remove") {
        return { ok: false };
    }

    const next = cloneEmbfProject(project);
    const newIndex = removePageFromProject(next, pageIndex);
    if (newIndex === undefined) {
        return { ok: false };
    }

    const ok = await writeEmbfProject(filePath, next);
    if (ok) {
        embeddedFlowLog("pages", "info", `removed page "${page.id}" (${path.basename(filePath)})`);
        return { ok: true, pageIndex: newIndex };
    }
    return { ok: false };
}

export async function renamePageInEmbfFile(
    filePath: string,
    pageIndex: number
): Promise<boolean> {
    let project;
    try {
        project = readEmbfProject(filePath);
    } catch (e) {
        vscode.window.showErrorMessage(`EmbeddedFlow: ${e instanceof Error ? e.message : String(e)}`);
        return false;
    }

    const page = project.pages[pageIndex];
    if (!page) {
        vscode.window.showErrorMessage(`EmbeddedFlow: invalid page index ${pageIndex}`);
        return false;
    }

    const newName = await vscode.window.showInputBox({
        title: "Rename page",
        prompt: "Display name (tab label)",
        value: page.name,
        validateInput: v => (v.trim() ? null : "Name cannot be empty")
    });
    if (newName === undefined) {
        return false;
    }

    const newId = await vscode.window.showInputBox({
        title: "Page id",
        prompt: "Unique page id (used in generated C filenames and navigate actions)",
        value: page.id,
        validateInput: v => {
            const t = v.trim();
            if (!t) {
                return "Id cannot be empty";
            }
            if (project.pages.some((p, i) => i !== pageIndex && p.id === t)) {
                return `Page id "${t}" is already used`;
            }
            return null;
        }
    });
    if (newId === undefined) {
        return false;
    }

    const next = cloneEmbfProject(project);
    if (
        !renamePageOnProject(next, pageIndex, {
            name: newName.trim(),
            id: newId.trim()
        })
    ) {
        vscode.window.showErrorMessage("EmbeddedFlow: could not rename page.");
        return false;
    }

    const ok = await writeEmbfProject(filePath, next);
    if (ok) {
        embeddedFlowLog(
            "pages",
            "info",
            `renamed page → "${newName.trim()}" (${newId.trim()}) (${path.basename(filePath)})`
        );
    }
    return ok;
}
