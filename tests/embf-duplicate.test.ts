import { describe, it, expect } from "vitest";
import { duplicateComponentsOnPage, pasteComponentsOnPage } from "../src/embfComponentModel";
import type { EmbfProject, Page } from "../src/types/embf";

function miniProject(): EmbfProject {
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
                    {
                        id: "lbl_1",
                        type: "label",
                        x: 10,
                        y: 10,
                        width: 80,
                        height: 24,
                        text: "A"
                    },
                    {
                        id: "box_1",
                        type: "container",
                        x: 0,
                        y: 40,
                        width: 120,
                        height: 60,
                        children: [
                            {
                                id: "btn_1",
                                type: "button",
                                x: 4,
                                y: 4,
                                width: 60,
                                height: 28,
                                text: "OK"
                            }
                        ]
                    }
                ]
            }
        ]
    };
}

describe("duplicateComponentsOnPage", () => {
    it("duplicates a label with new id and offset", () => {
        const project = miniProject();
        const page = project.pages[0];
        const newIds = duplicateComponentsOnPage(page, project, ["lbl_1"]);
        expect(newIds).toHaveLength(1);
        expect(newIds[0]).not.toBe("lbl_1");
        const copy = page.components.find(c => c.id === newIds[0]);
        expect(copy?.type).toBe("label");
        expect(copy?.x).toBe(20);
        expect(copy?.y).toBe(20);
    });

    it("duplicates container subtree once when parent and child both selected", () => {
        const project = miniProject();
        const page = project.pages[0];
        const newIds = duplicateComponentsOnPage(page, project, ["box_1", "btn_1"]);
        expect(newIds).toHaveLength(1);
        const box = page.components.find(c => c.id === newIds[0]);
        expect(box?.type).toBe("container");
        expect(box?.children).toHaveLength(1);
        expect(box?.children?.[0].id).not.toBe("btn_1");
    });
});

describe("pasteComponentsOnPage", () => {
    it("inserts clipboard roots with fresh ids", () => {
        const project = miniProject();
        const page = project.pages[0];
        const src = page.components[0];
        const newIds = pasteComponentsOnPage(page, project, [src], 5, 5);
        expect(newIds).toHaveLength(1);
        expect(page.components.length).toBe(3);
    });
});
