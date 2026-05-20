import * as path from "path";
import * as vscode from "vscode";
import { EmbfParseError } from "./embfParser";
import {
    insertLibraryOnPage,
    removeLibraryEntry,
    saveContainerToLibrary
} from "./embfComponentLibrary";
import { cloneEmbfProject } from "./embfWidgetFactory";
import { embeddedFlowLog } from "./outputLog";
import { readEmbfProject, writeEmbfProject } from "./embfProjectWrite";

export async function saveGroupToLibraryInEmbfFile(
    filePath: string,
    pageIndex: number,
    containerId: string
): Promise<{ ok: true; entryId: string } | { ok: false }> {
    const id = String(containerId ?? "").trim();
    if (!id) {
        return { ok: false };
    }

    let project;
    try {
        project = readEmbfProject(filePath);
    } catch (e) {
        const msg = e instanceof EmbfParseError ? e.message : String(e);
        vscode.window.showErrorMessage(`EmbeddedFlow: ${msg}`);
        return { ok: false };
    }

    if (pageIndex < 0 || pageIndex >= project.pages.length) {
        vscode.window.showErrorMessage(`EmbeddedFlow: invalid page index ${pageIndex}`);
        return { ok: false };
    }

    const defaultId = id.replace(/^box_/, "grp_").replace(/^pnl_/, "grp_");
    const libId = await vscode.window.showInputBox({
        title: "Save to My components",
        prompt: "Unique id for this reusable group (used in .embf JSON)",
        value: defaultId,
        validateInput: v => (v.trim() ? null : "Id is required")
    });
    if (libId === undefined) {
        return { ok: false };
    }

    const name = await vscode.window.showInputBox({
        title: "Save to My components",
        prompt: "Name shown in the custom components toolbar",
        value: libId,
        validateInput: v => (v.trim() ? null : "Name is required")
    });
    if (name === undefined) {
        return { ok: false };
    }

    const next = cloneEmbfProject(project);
    const page = next.pages[pageIndex];
    const r = saveContainerToLibrary(next, page, id, libId.trim(), name.trim());
    if (!r.ok) {
        vscode.window.showErrorMessage(`EmbeddedFlow: ${r.reason}`);
        return { ok: false };
    }

    const written = await writeEmbfProject(filePath, next);
    if (written) {
        embeddedFlowLog(
            "library",
            "info",
            `saved library "${r.entryId}" from ${id} (${path.basename(filePath)})`
        );
    }
    return written ? { ok: true, entryId: r.entryId } : { ok: false };
}

export async function insertLibraryComponentInEmbfFile(
    filePath: string,
    pageIndex: number,
    libraryId: string
): Promise<{ ok: true; componentId: string } | { ok: false }> {
    const lib = String(libraryId ?? "").trim();
    if (!lib) {
        return { ok: false };
    }

    let project;
    try {
        project = readEmbfProject(filePath);
    } catch (e) {
        const msg = e instanceof EmbfParseError ? e.message : String(e);
        vscode.window.showErrorMessage(`EmbeddedFlow: ${msg}`);
        return { ok: false };
    }

    if (pageIndex < 0 || pageIndex >= project.pages.length) {
        return { ok: false };
    }

    const next = cloneEmbfProject(project);
    const page = next.pages[pageIndex];
    const r = insertLibraryOnPage(next, page, lib);
    if (!r.ok) {
        vscode.window.showErrorMessage(`EmbeddedFlow: ${r.reason}`);
        return { ok: false };
    }

    const written = await writeEmbfProject(filePath, next);
    if (written) {
        embeddedFlowLog("library", "info", `inserted library "${lib}" as ${r.componentId}`);
    }
    return written ? { ok: true, componentId: r.componentId } : { ok: false };
}

export async function removeLibraryEntryInEmbfFile(
    filePath: string,
    libraryId: string
): Promise<boolean> {
    const lib = String(libraryId ?? "").trim();
    if (!lib) {
        return false;
    }

    let project;
    try {
        project = readEmbfProject(filePath);
    } catch (e) {
        vscode.window.showErrorMessage(
            `EmbeddedFlow: ${e instanceof EmbfParseError ? e.message : String(e)}`
        );
        return false;
    }

    const next = cloneEmbfProject(project);
    if (!removeLibraryEntry(next, lib)) {
        return false;
    }
    return writeEmbfProject(filePath, next);
}
