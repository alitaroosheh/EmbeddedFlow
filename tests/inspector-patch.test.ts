import { describe, it, expect } from "vitest";
import { applyComponentPatch } from "../src/embfComponentModel";
import type { LabelComponent } from "../src/types/embf";

describe("applyComponentPatch (inspector)", () => {
    it("merges styles and allows null to clear a key", () => {
        const comp: LabelComponent = {
            id: "l1",
            type: "label",
            x: 0,
            y: 0,
            width: 10,
            height: 10,
            text: "Hi",
            styles: { bgColor: "#111", textColor: "#222" }
        };
        applyComponentPatch(comp, {
            styles: {
                bgColor: null,
                borderWidth: 2
            }
        });
        expect(comp.styles?.bgColor).toBeUndefined();
        expect(comp.styles?.textColor).toBe("#222");
        expect(comp.styles?.borderWidth).toBe(2);
    });

    it("applies label longMode when set", () => {
        const comp: LabelComponent = {
            id: "l1",
            type: "label",
            x: 0,
            y: 0,
            width: 10,
            height: 10,
            text: "Hi",
            longMode: "wrap"
        };
        applyComponentPatch(comp, { longMode: "" });
        expect(comp.longMode).toBeUndefined();
    });
});
