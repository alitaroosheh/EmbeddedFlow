import { describe, expect, it } from "vitest";
import { buildNewComponent } from "../src/embfWidgetFactory";
import { WIDGET_PALETTE_ORDER } from "../src/embfPalette";
import { parseEmbfSource } from "../src/embfParser";
import { minimalProject } from "./fixtures";

describe("buildNewComponent", () => {
    it("each palette type produces JSON that passes parseEmbfSource", () => {
        const project = minimalProject();
        const page = project.pages[0];
        for (const t of WIDGET_PALETTE_ORDER) {
            const p = structuredClone(project);
            const pg = p.pages[0];
            const c = buildNewComponent(p, pg, t);
            pg.components.push(c);
            expect(() => parseEmbfSource(JSON.stringify(p))).not.toThrow();
        }
    });

    it("allocates unique ids across nested children", () => {
        const project = minimalProject({
            pages: [
                {
                    id: "p1",
                    name: "P",
                    components: [
                        {
                            id: "lbl_1",
                            type: "label",
                            x: 0,
                            y: 0,
                            width: 10,
                            height: 10,
                            text: "x"
                        },
                        {
                            id: "box_1",
                            type: "container",
                            x: 0,
                            y: 0,
                            width: 100,
                            height: 100,
                            layout: "none",
                            children: [
                                {
                                    id: "lbl_2",
                                    type: "label",
                                    x: 0,
                                    y: 0,
                                    width: 10,
                                    height: 10,
                                    text: "y"
                                }
                            ]
                        }
                    ]
                }
            ]
        });
        const page = project.pages[0];
        const a = buildNewComponent(project, page, "label");
        expect(a.id).not.toBe("lbl_1");
        expect(a.id).not.toBe("lbl_2");
    });
});
