import { afterEach, describe, expect, it } from "vitest";
import {
    canRedo,
    canUndo,
    clearHistory,
    popRedo,
    popUndo,
    pushUndoSnapshot
} from "../src/embfHistoryStacks";

const FILE = "D:/test/history.embf";

describe("embfHistoryStacks", () => {
    afterEach(() => {
        clearHistory(FILE);
    });

    it("undo and redo round-trip snapshots", () => {
        pushUndoSnapshot(FILE, '{"step":0}');
        pushUndoSnapshot(FILE, '{"step":1}');

        const u1 = popUndo(FILE, '{"step":2}');
        expect(u1).toBe('{"step":1}');
        expect(canRedo(FILE)).toBe(true);

        const r1 = popRedo(FILE, '{"step":1}');
        expect(r1).toBe('{"step":2}');
        expect(canUndo(FILE)).toBe(true);
    });

    it("skips duplicate consecutive snapshots", () => {
        pushUndoSnapshot(FILE, '{"same":true}');
        pushUndoSnapshot(FILE, '{"same":true}');
        expect(canUndo(FILE)).toBe(true);
        popUndo(FILE, '{"same":true}');
        expect(canUndo(FILE)).toBe(false);
    });
});
