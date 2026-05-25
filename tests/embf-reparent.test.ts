import { describe, expect, it } from "vitest";
import { reparentComponentOnPage } from "../src/embfComponentModel";
import type { ContainerComponent, EmbfProject, Page } from "../src/types/embf";

function projectWithGroup(): EmbfProject {
    const child: import("../src/types/embf").LabelComponent = {
        id: "lbl_inner",
        type: "label",
        x: 5,
        y: 5,
        width: 60,
        height: 16,
        text: "inner"
    };
    const box: ContainerComponent = {
        id: "box1",
        type: "container",
        x: 30,
        y: 40,
        width: 100,
        height: 80,
        children: [child]
    };
    const free: import("../src/types/embf").LabelComponent = {
        id: "lbl_free",
        type: "label",
        x: 200,
        y: 100,
        width: 40,
        height: 16,
        text: "free"
    };
    const page: Page = {
        id: "page_main",
        name: "Main",
        components: [box, free]
    };
    return {
        version: "1.0",
        project: { name: "T", lvglVersion: "9.5.0" },
        display: {
            width: 480,
            height: 320,
            bitDepth: 16,
            colorFormat: "RGB565",
            orientation: "landscape",
            direction: "ltr"
        },
        pages: [page]
    };
}

describe("reparentComponentOnPage", () => {
    it("moves a root widget into a container preserving absolute position", () => {
        const p = projectWithGroup();
        const page = p.pages[0];
        const r = reparentComponentOnPage(page, "lbl_free", "box1");
        expect(r.ok).toBe(true);
        const box = page.components[0] as ContainerComponent;
        expect(box.children.map(c => c.id)).toContain("lbl_free");
        const moved = box.children.find(c => c.id === "lbl_free")!;
        expect(moved.x).toBe(200 - 30);
        expect(moved.y).toBe(100 - 40);
        expect(page.components.some(c => c.id === "lbl_free")).toBe(false);
    });

    it("moves a child widget out to page root preserving absolute position", () => {
        const p = projectWithGroup();
        const page = p.pages[0];
        const r = reparentComponentOnPage(page, "lbl_inner", null);
        expect(r.ok).toBe(true);
        const box = page.components.find(c => c.id === "box1") as ContainerComponent;
        expect(box.children.length).toBe(0);
        const lifted = page.components.find(c => c.id === "lbl_inner")!;
        expect(lifted.x).toBe(30 + 5);
        expect(lifted.y).toBe(40 + 5);
    });

    it("rejects dropping a widget into one of its descendants", () => {
        const p = projectWithGroup();
        const page = p.pages[0];
        const r = reparentComponentOnPage(page, "box1", "lbl_inner");
        expect(r.ok).toBe(false);
    });

    it("rejects dropping onto a non-container widget", () => {
        const p = projectWithGroup();
        const page = p.pages[0];
        const r = reparentComponentOnPage(page, "lbl_free", "lbl_inner");
        expect(r.ok).toBe(false);
        if (!r.ok) {
            expect(r.reason).toMatch(/contain children/i);
        }
    });

    it("inserts before a given sibling id when provided", () => {
        const p = projectWithGroup();
        const page = p.pages[0];
        // Add another root sibling so we have a stable order to test.
        page.components.push({
            id: "lbl_third",
            type: "label",
            x: 0,
            y: 0,
            width: 20,
            height: 10,
            text: "x"
        });
        const r = reparentComponentOnPage(page, "lbl_inner", null, "lbl_third");
        expect(r.ok).toBe(true);
        const order = page.components.map(c => c.id);
        const liftedIdx = order.indexOf("lbl_inner");
        const thirdIdx = order.indexOf("lbl_third");
        expect(liftedIdx).toBeGreaterThanOrEqual(0);
        expect(thirdIdx).toBeGreaterThan(liftedIdx);
    });

    it("rejects dropping a widget on itself", () => {
        const p = projectWithGroup();
        const page = p.pages[0];
        const r = reparentComponentOnPage(page, "box1", "box1");
        expect(r.ok).toBe(false);
    });
});
