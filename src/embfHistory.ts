import * as fs from "fs";
import * as vscode from "vscode";
import {
    canRedo as canRedoStacks,
    canUndo as canUndoStacks,
    clearHistory,
    popRedo,
    popUndo,
    pushUndoSnapshot
} from "./embfHistoryStacks";

export function readEmbfText(filePath: string): string {
    const doc = vscode.workspace.textDocuments.find(
        d => d.uri.scheme === "file" && d.uri.fsPath === filePath
    );
    if (doc) {
        return doc.getText();
    }
    return fs.readFileSync(filePath, "utf-8");
}

/** Push the current document text onto the undo stack (call before a preview-driven edit). */
export function recordSnapshotBeforeEdit(filePath: string): void {
    pushUndoSnapshot(filePath, readEmbfText(filePath));
}

export function canUndoEmbf(filePath: string): boolean {
    return canUndoStacks(filePath);
}

export function canRedoEmbf(filePath: string): boolean {
    return canRedoStacks(filePath);
}

export function takeUndoSnapshot(filePath: string): string | undefined {
    return popUndo(filePath, readEmbfText(filePath));
}

export function takeRedoSnapshot(filePath: string): string | undefined {
    return popRedo(filePath, readEmbfText(filePath));
}

export function clearEmbfHistory(filePath: string): void {
    clearHistory(filePath);
}
