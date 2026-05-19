import * as path from "path";
import * as vscode from "vscode";
import type { EventTrigger } from "./types/embf";
import { addNavigateFlow, removeNavigateFlow } from "./embfFlow";
import { cloneEmbfProject } from "./embfWidgetFactory";
import { embeddedFlowLog } from "./outputLog";
import { readEmbfProject, writeEmbfProject } from "./embfProjectWrite";

const TRIGGERS: EventTrigger[] = ["clicked", "long_pressed", "value_changed"];

function isEventTrigger(v: string): v is EventTrigger {
    return TRIGGERS.includes(v as EventTrigger);
}

export async function addNavigateFlowInEmbfFile(
    filePath: string,
    sourcePageIndex: number,
    componentId: string,
    trigger: string,
    targetPageId: string
): Promise<boolean> {
    if (!isEventTrigger(trigger)) {
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
    const ok = addNavigateFlow(next, sourcePageIndex, componentId.trim(), trigger, targetPageId.trim());
    if (!ok) {
        vscode.window.showErrorMessage(
            "EmbeddedFlow: could not add flow (check page, component, and target page id)."
        );
        return false;
    }

    const written = await writeEmbfProject(filePath, next);
    if (written) {
        embeddedFlowLog(
            "flow",
            "info",
            `flow ${componentId} (${trigger}) → ${targetPageId} (${path.basename(filePath)})`
        );
    }
    return written;
}

export async function removeNavigateFlowInEmbfFile(
    filePath: string,
    sourcePageIndex: number,
    componentId: string,
    trigger: string,
    targetPageId: string
): Promise<boolean> {
    if (!isEventTrigger(trigger)) {
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
    const ok = removeNavigateFlow(next, sourcePageIndex, componentId.trim(), trigger, targetPageId.trim());
    if (!ok) {
        return false;
    }

    const written = await writeEmbfProject(filePath, next);
    if (written) {
        embeddedFlowLog(
            "flow",
            "info",
            `removed flow ${componentId} (${trigger}) → ${targetPageId} (${path.basename(filePath)})`
        );
    }
    return written;
}
