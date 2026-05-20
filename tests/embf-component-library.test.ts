import { describe, it, expect } from "vitest";
import type { EmbfProject, Page } from "../src/types/embf";
import {
    insertLibraryOnPage,
    saveContainerToLibrary,
    removeLibraryEntry
} from "../src/embfComponentLibrary";
import { combineWidgetsOnPage } from "../src/embfComponentModel";

function minimalProject(pages: Page[]): EmbfProject {
    return {
        version: "1.0",
        project: { name: "t", lvglVersion: "9.5.0" },
        display: {
            width: 320,
            height: 240,
            bitDepth: 16,
            colorFormat: "RGB565",
            orientation: "portrait",
            direction: "ltr"
        },
        pages
    };
}

describe("component library", () => {
    it("saves a combined group and inserts a copy with new ids", () => {
        const page: Page = {
            id: "main",
            name: "Main",
            components: [
                {
                    id: "lbl_1",
                    type: "label",
                    x: 10,
                    y: 20,
                    width: 80,
                    height: 24,
                    text: "Hi"
                },
                {
                    id: "btn_1",
                    type: "button",
                    x: 10,
                    y: 50,
                    width: 100,
                    height: 36,
                    label: "Go"
                }
            ]
        };
        const project = minimalProject([page]);
        const combined = combineWidgetsOnPage(project, page, ["lbl_1", "btn_1"]);
        expect(combined.ok).toBe(true);
        if (!combined.ok) {
            return;
        }

        const save = saveContainerToLibrary(
            project,
            page,
            combined.containerId,
            "my_card",
            "My Card"
        );
        expect(save.ok).toBe(true);
        expect(project.componentLibrary).toHaveLength(1);
        expect(project.componentLibrary![0].id).toBe("my_card");
        expect(project.componentLibrary![0].root.children?.length).toBe(2);

        const ins = insertLibraryOnPage(project, page, "my_card");
        expect(ins.ok).toBe(true);
        if (!ins.ok) {
            return;
        }
        expect(page.components.length).toBe(2);
        const inserted = page.components.find(c => c.id === ins.componentId);
        expect(inserted?.type).toBe("container");
        expect(inserted && "children" in inserted && inserted.children?.length).toBe(2);
        const childIds = inserted && "children" in inserted ? inserted.children!.map(c => c.id) : [];
        expect(childIds).not.toContain("lbl_1");
        expect(childIds).not.toContain("btn_1");
    });

    it("rejects duplicate library ids", () => {
        const page: Page = { id: "p", name: "P", components: [] };
        const project = minimalProject([page]);
        project.componentLibrary = [
            {
                id: "dup",
                name: "A",
                width: 10,
                height: 10,
                root: {
                    id: "box_1",
                    type: "container",
                    x: 0,
                    y: 0,
                    width: 10,
                    height: 10,
                    children: []
                }
            }
        ];
        page.components.push({
            id: "box_2",
            type: "container",
            x: 0,
            y: 0,
            width: 20,
            height: 20,
            children: [
                {
                    id: "lbl_2",
                    type: "label",
                    x: 0,
                    y: 0,
                    width: 40,
                    height: 20,
                    text: "x"
                }
            ]
        });
        const r = saveContainerToLibrary(project, page, "box_2", "dup", "B");
        expect(r.ok).toBe(false);
    });

    it("removeLibraryEntry drops an entry", () => {
        const project = minimalProject([{ id: "p", name: "P", components: [] }]);
        project.componentLibrary = [
            {
                id: "a",
                name: "A",
                width: 1,
                height: 1,
                root: {
                    id: "box_1",
                    type: "container",
                    x: 0,
                    y: 0,
                    width: 1,
                    height: 1,
                    children: []
                }
            }
        ];
        expect(removeLibraryEntry(project, "a")).toBe(true);
        expect(project.componentLibrary).toHaveLength(0);
    });
});
