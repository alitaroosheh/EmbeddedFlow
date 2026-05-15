import { describe, expect, it } from "vitest";
import { setComponentPositionOnPage } from "../src/embfComponentModel";
import { parseEmbfSource } from "../src/embfParser";
import { minimalProject } from "./fixtures";

describe("setComponentPositionOnPage", () => {
    it("updates top-level and nested component coordinates", () => {
        const project = minimalProject({
            pages: [
                {
                    id: "p1",
                    name: "P",
                    components: [
                        {
                            id: "box_1",
                            type: "container",
                            x: 10,
                            y: 10,
                            width: 100,
                            height: 100,
                            layout: "none",
                            children: [
                                {
                                    id: "lbl_in",
                                    type: "label",
                                    x: 4,
                                    y: 4,
                                    width: 40,
                                    height: 16,
                                    text: "in"
                                }
                            ]
                        }
                    ]
                }
            ]
        });
        const page = project.pages[0];
        expect(setComponentPositionOnPage(page, "lbl_in", 20, 24)).toBe(true);
        expect(page.components[0].children?.[0].x).toBe(20);
        expect(page.components[0].children?.[0].y).toBe(24);
        expect(() => parseEmbfSource(JSON.stringify(project))).not.toThrow();
    });
});
