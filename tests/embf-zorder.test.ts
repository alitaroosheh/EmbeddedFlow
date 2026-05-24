import { describe, it, expect } from "vitest";
import { reorderComponentZOrderOnPage } from "../src/embfComponentModel";
import type { EmbfProject } from "../src/types/embf";

function projectWithThree(): EmbfProject {
    return {
        version: "1.0",
        project: { name: "T", lvglVersion: "9.5.0" },
        display: {
            width: 320,
            height: 240,
            bitDepth: 16,
            colorFormat: "RGB565",
            orientation: "landscape",
            direction: "ltr",
            dpi: 100
        },
        theme: { dark: false },
        pages: [
            {
                id: "main",
                name: "Main",
                components: [
                    { id: "a", type: "label", x: 0, y: 0, width: 10, height: 10, text: "A" },
                    { id: "b", type: "label", x: 0, y: 0, width: 10, height: 10, text: "B" },
                    { id: "c", type: "label", x: 0, y: 0, width: 10, height: 10, text: "C" }
                ]
            }
        ]
    };
}

describe("reorderComponentZOrderOnPage", () => {
    it("moves widget to front", () => {
        const p = projectWithThree();
        const page = p.pages[0];
        expect(reorderComponentZOrderOnPage(page, "a", "front")).toBe(true);
        expect(page.components.map(c => c.id)).toEqual(["b", "c", "a"]);
    });
});
