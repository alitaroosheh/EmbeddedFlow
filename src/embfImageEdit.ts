import * as path from "path";
import * as vscode from "vscode";
import type { EmbfProject, ImageComponent, Page } from "./types/embf";
import { findComponentOnPage } from "./embfComponentModel";
import { toIdentifier } from "./codeGen/naming";
import { cloneEmbfProject } from "./embfWidgetFactory";
import { embeddedFlowLog } from "./outputLog";
import { readEmbfProject, writeEmbfProject } from "./embfProjectWrite";
import { EmbfParseError } from "./embfParser";

function normalizeRelPath(p: string): string {
    return p.replace(/\\/g, "/");
}

function relativeToEmbf(embfDir: string, absolutePath: string): string {
    const rel = path.relative(embfDir, absolutePath);
    return normalizeRelPath(rel.startsWith("..") ? absolutePath : rel);
}

function allocateImageId(project: EmbfProject, stem: string): string {
    const base = toIdentifier(stem) || "img";
    const used = new Set((project.images ?? []).map(e => e.id));
    for (let i = 0; i < 100000; i++) {
        const id = i === 0 ? base : `${base}_${i}`;
        if (!used.has(id)) {
            return id;
        }
    }
    return `${base}_${Date.now()}`;
}

/**
 * Register an image file in `project.images[]` and set the widget `src` to that asset id.
 */
export function assignImageFileToWidget(
    project: EmbfProject,
    page: Page,
    componentId: string,
    embfDir: string,
    absoluteImagePath: string
): { imageId: string; relativePath: string } | null {
    const comp = findComponentOnPage(page, componentId);
    if (!comp || comp.type !== "image") {
        return null;
    }

    const relativePath = relativeToEmbf(embfDir, absoluteImagePath);
    if (!project.images) {
        project.images = [];
    }

    const norm = normalizeRelPath(relativePath);
    let entry = project.images.find(e => normalizeRelPath(e.path) === norm);
    if (!entry) {
        const stem = path.basename(absoluteImagePath, path.extname(absoluteImagePath));
        const imageId = allocateImageId(project, stem);
        entry = { id: imageId, path: relativePath };
        project.images.push(entry);
    }

    (comp as ImageComponent).src = entry.id;
    return { imageId: entry.id, relativePath: entry.path };
}

export async function assignImageFileToWidgetInEmbfFile(
    filePath: string,
    pageIndex: number,
    componentId: string,
    pickedFsPath: string
): Promise<{ ok: true; imageId: string; relativePath: string } | { ok: false }> {
    const id = String(componentId ?? "").trim();
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

    const next = cloneEmbfProject(project);
    const page = next.pages[pageIndex];
    const embfDir = path.dirname(filePath);
    const result = assignImageFileToWidget(next, page, id, embfDir, pickedFsPath);
    if (!result) {
        vscode.window.showErrorMessage("EmbeddedFlow: image widget not found on this page.");
        return { ok: false };
    }

    const written = await writeEmbfProject(filePath, next);
    if (written) {
        embeddedFlowLog(
            "image",
            "info",
            `widget ${id} → images "${result.imageId}" (${result.relativePath})`
        );
    }
    return written ? { ok: true, ...result } : { ok: false };
}
