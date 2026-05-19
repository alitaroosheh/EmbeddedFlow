import { describe, it, expect } from "vitest";
import {
    addPageSwipeFlow,
    collectPageSwipeFlows,
    removePageSwipeFlow
} from "../src/embfPageSwipe";
import { minimalProject } from "./fixtures";

describe("page swipe flow", () => {
    it("collects swipe navigations on pages", () => {
        const p = minimalProject();
        p.pages.push({ id: "page_b", name: "B", components: [] });
        p.pages[0].swipes = [{ direction: "left", target: "page_b" }];
        const flows = collectPageSwipeFlows(p);
        expect(flows).toHaveLength(1);
        expect(flows[0].direction).toBe("left");
        expect(flows[0].targetPageId).toBe("page_b");
    });

    it("adds and removes swipe flow on a page", () => {
        const p = minimalProject();
        delete p.pages[0].swipes;
        p.pages.push({ id: "page_b", name: "B", components: [] });
        expect(addPageSwipeFlow(p, 0, "right", "page_b", { anim: "fade_in", time: 200 })).toBe(true);
        expect(collectPageSwipeFlows(p)).toHaveLength(1);
        expect(p.pages[0].swipes?.[0]).toMatchObject({
            direction: "right",
            target: "page_b",
            anim: "fade_in",
            time: 200
        });
        expect(removePageSwipeFlow(p, 0, "right")).toBe(true);
        expect(collectPageSwipeFlows(p)).toHaveLength(0);
    });

    it("replaces swipe on same direction", () => {
        const p = minimalProject();
        delete p.pages[0].swipes;
        p.pages.push({ id: "page_b", name: "B", components: [] });
        p.pages.push({ id: "page_c", name: "C", components: [] });
        addPageSwipeFlow(p, 0, "left", "page_b");
        addPageSwipeFlow(p, 0, "left", "page_c");
        expect(p.pages[0].swipes).toHaveLength(1);
        expect(p.pages[0].swipes?.[0].target).toBe("page_c");
    });
});
