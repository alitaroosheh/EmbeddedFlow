import * as path from "path";
import * as vscode from "vscode";
import { normalizeScreenLoadAnim } from "./codeGen/screenLoadAnim";
import { addPageSwipeFlow, isSwipeDirection, removePageSwipeFlow } from "./embfPageSwipe";
import { cloneEmbfProject } from "./embfWidgetFactory";
import { embeddedFlowLog } from "./outputLog";
import { readEmbfProject, writeEmbfProject } from "./embfProjectWrite";
import type { ScreenLoadAnim } from "./types/embf";

export async function addPageSwipeFlowInEmbfFile(
    filePath: string,
    sourcePageIndex: number,
    direction: string,
    targetPageId: string,
    anim?: string,
    time?: number
): Promise<boolean> {
    if (!isSwipeDirection(direction)) {
        return false;
    }
    let project;
    try {
        project = readEmbfProject(filePath);
    } catch (e) {
        vscode.window.showErrorMessage(`EmbeddedFlow: ${e instanceof Error ? e.message : String(e)}`);
        return false;
    }

    let screenAnim: ScreenLoadAnim | undefined;
    if (anim !== undefined && anim !== "") {
        const normalized = normalizeScreenLoadAnim(anim);
        if (!normalized) {
            vscode.window.showErrorMessage(`EmbeddedFlow: unknown screen animation "${anim}".`);
            return false;
        }
        screenAnim = normalized;
    }

    const next = cloneEmbfProject(project);
    const ok = addPageSwipeFlow(next, sourcePageIndex, direction, targetPageId.trim(), {
        anim: screenAnim,
        time: time !== undefined && Number.isFinite(time) ? Math.max(0, Math.round(time)) : undefined
    });
    if (!ok) {
        vscode.window.showErrorMessage(
            "EmbeddedFlow: could not add swipe flow (check page index and target page id)."
        );
        return false;
    }

    const written = await writeEmbfProject(filePath, next);
    if (written) {
        embeddedFlowLog(
            "flow",
            "info",
            `swipe ${direction} on page[${sourcePageIndex}] → ${targetPageId} (${path.basename(filePath)})`
        );
    }
    return written;
}

export async function removePageSwipeFlowInEmbfFile(
    filePath: string,
    sourcePageIndex: number,
    direction: string
): Promise<boolean> {
    if (!isSwipeDirection(direction)) {
        return false;
    }
    let project;
    try {
        project = readEmbfProject(filePath);
    } catch (e) {
        vscode.window.showErrorMessage(`EmbeddedFlow: ${e instanceof Error ? e.message : String(e)}`);
        return false;
    }

    const next = cloneEmbfProject(project);
    const ok = removePageSwipeFlow(next, sourcePageIndex, direction);
    if (!ok) {
        return false;
    }

    const written = await writeEmbfProject(filePath, next);
    if (written) {
        embeddedFlowLog(
            "flow",
            "info",
            `removed swipe ${direction} on page[${sourcePageIndex}] (${path.basename(filePath)})`
        );
    }
    return written;
}
