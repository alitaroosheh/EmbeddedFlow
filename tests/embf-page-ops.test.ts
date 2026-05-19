import { describe, it, expect } from "vitest";
import {
    addPageToProject,
    allocateNewPageId,
    removePageFromProject,
    renamePageOnProject
} from "../src/embfComponentModel";
import { minimalProject } from "./fixtures";

describe("page list operations", () => {
    it("allocates unique page ids", () => {
        const p = minimalProject();
        expect(allocateNewPageId(p)).toBe("page_2");
        p.pages.push({ id: "page_2", name: "Two", components: [] });
        expect(allocateNewPageId(p)).toBe("page_3");
    });

    it("adds a page at the end", () => {
        const p = minimalProject();
        const idx = addPageToProject(p);
        expect(idx).toBe(1);
        expect(p.pages).toHaveLength(2);
        expect(p.pages[1].components).toEqual([]);
    });

    it("refuses to remove the only page", () => {
        const p = minimalProject();
        expect(removePageFromProject(p, 0)).toBeUndefined();
        expect(p.pages).toHaveLength(1);
    });

    it("removes a page and returns a valid new index", () => {
        const p = minimalProject();
        addPageToProject(p);
        addPageToProject(p);
        const next = removePageFromProject(p, 1);
        expect(next).toBe(1);
        expect(p.pages).toHaveLength(2);
    });

    it("renames name and id when unique", () => {
        const p = minimalProject();
        expect(renamePageOnProject(p, 0, { name: "Home", id: "page_home" })).toBe(true);
        expect(p.pages[0].name).toBe("Home");
        expect(p.pages[0].id).toBe("page_home");
    });

    it("rejects duplicate page id on rename", () => {
        const p = minimalProject();
        addPageToProject(p);
        p.pages[1].id = "page_other";
        expect(renamePageOnProject(p, 0, { id: "page_other" })).toBe(false);
    });
});
