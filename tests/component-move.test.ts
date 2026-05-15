import { describe, expect, it } from "vitest";
import {
    deleteComponentOnPage,
    patchComponentOnPage,
    setComponentPositionOnPage
} from "../src/embfComponentModel";
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

    it("patches label text and deletes a component", () => {
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
                            width: 40,
                            height: 16,
                            text: "A"
                        },
                        {
                            id: "btn_1",
                            type: "button",
                            x: 0,
                            y: 20,
                            width: 40,
                            height: 20,
                            label: "Go"
                        }
                    ]
                }
            ]
        });
        const page = project.pages[0];
        expect(patchComponentOnPage(page, "lbl_1", { text: "Hello" })).toBe(true);
        expect(page.components[0].text).toBe("Hello");
        expect(deleteComponentOnPage(page, "btn_1")).toBe(true);
        expect(page.components).toHaveLength(1);
        expect(() => parseEmbfSource(JSON.stringify(project))).not.toThrow();
    });
});
