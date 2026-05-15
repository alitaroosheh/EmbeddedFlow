import * as path from "path";
import { EmbfParseError, parseEmbfSource } from "./embfParser";
import { canRedoEmbf, canUndoEmbf, takeRedoSnapshot, takeUndoSnapshot } from "./embfHistory";
import { embeddedFlowLog } from "./outputLog";
import { writeEmbfText } from "./embfProjectWrite";

export function getEmbfHistoryState(filePath: string): { canUndo: boolean; canRedo: boolean } {
    return {
        canUndo: canUndoEmbf(filePath),
        canRedo: canRedoEmbf(filePath)
    };
}

export async function undoEmbfEdit(filePath: string): Promise<boolean> {
    const text = takeUndoSnapshot(filePath);
    if (text === undefined) {
        return false;
    }
    try {
        parseEmbfSource(text);
    } catch (e) {
        const msg = e instanceof EmbfParseError ? e.message : String(e);
        embeddedFlowLog("history", "error", `undo validation failed: ${msg}`);
        return false;
    }
    const ok = await writeEmbfText(filePath, text, { skipHistory: true });
    if (ok) {
        embeddedFlowLog("history", "info", `undo (${path.basename(filePath)})`);
    }
    return ok;
}

export async function redoEmbfEdit(filePath: string): Promise<boolean> {
    const text = takeRedoSnapshot(filePath);
    if (text === undefined) {
        return false;
    }
    try {
        parseEmbfSource(text);
    } catch (e) {
        const msg = e instanceof EmbfParseError ? e.message : String(e);
        embeddedFlowLog("history", "error", `redo validation failed: ${msg}`);
        return false;
    }
    const ok = await writeEmbfText(filePath, text, { skipHistory: true });
    if (ok) {
        embeddedFlowLog("history", "info", `redo (${path.basename(filePath)})`);
    }
    return ok;
}
