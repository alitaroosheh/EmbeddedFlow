const MAX_ENTRIES = 50;

interface FileHistoryStacks {
    undo: string[];
    redo: string[];
}

const stacksByFile = new Map<string, FileHistoryStacks>();

function normalizePath(filePath: string): string {
    return filePath.replace(/\\/g, "/");
}

function stacksFor(filePath: string): FileHistoryStacks {
    const key = normalizePath(filePath);
    let s = stacksByFile.get(key);
    if (!s) {
        s = { undo: [], redo: [] };
        stacksByFile.set(key, s);
    }
    return s;
}

export function pushUndoSnapshot(filePath: string, text: string): void {
    const stacks = stacksFor(filePath);
    const last = stacks.undo[stacks.undo.length - 1];
    if (last === text) {
        return;
    }
    stacks.undo.push(text);
    if (stacks.undo.length > MAX_ENTRIES) {
        stacks.undo.shift();
    }
    stacks.redo = [];
}

export function canUndo(filePath: string): boolean {
    return stacksFor(filePath).undo.length > 0;
}

export function canRedo(filePath: string): boolean {
    return stacksFor(filePath).redo.length > 0;
}

export function popUndo(filePath: string, currentText: string): string | undefined {
    const stacks = stacksFor(filePath);
    if (stacks.undo.length === 0) {
        return undefined;
    }
    const prev = stacks.undo.pop()!;
    stacks.redo.push(currentText);
    if (stacks.redo.length > MAX_ENTRIES) {
        stacks.redo.shift();
    }
    return prev;
}

export function popRedo(filePath: string, currentText: string): string | undefined {
    const stacks = stacksFor(filePath);
    if (stacks.redo.length === 0) {
        return undefined;
    }
    const next = stacks.redo.pop()!;
    stacks.undo.push(currentText);
    if (stacks.undo.length > MAX_ENTRIES) {
        stacks.undo.shift();
    }
    return next;
}

export function clearHistory(filePath: string): void {
    stacksByFile.delete(normalizePath(filePath));
}
