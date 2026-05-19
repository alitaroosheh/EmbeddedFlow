import { describe, it, expect } from "vitest";
import { addNavigateFlow, collectNavigateFlows, removeNavigateFlow } from "../src/embfFlow";
import { minimalProject } from "./fixtures";

describe("navigate flow", () => {
    it("collects navigate actions across pages", () => {
        const p = minimalProject();
        p.pages.push({
            id: "page_settings",
            name: "Settings",
            components: []
        });
        p.pages[0].components[0].events = [
            {
                trigger: "clicked",
                actions: [{ type: "navigate", target: "page_settings" }]
            }
        ];
        const flows = collectNavigateFlows(p);
        expect(flows).toHaveLength(1);
        expect(flows[0].targetPageId).toBe("page_settings");
    });

    it("adds and removes a navigate flow on a component", () => {
        const p = minimalProject();
        p.pages.push({ id: "page_b", name: "B", components: [] });
        const label = p.pages[0].components[0];
        expect(addNavigateFlow(p, 0, label.id, "clicked", "page_b")).toBe(true);
        expect(collectNavigateFlows(p)).toHaveLength(1);
        expect(removeNavigateFlow(p, 0, label.id, "clicked", "page_b")).toBe(true);
        expect(collectNavigateFlows(p)).toHaveLength(0);
    });

    it("stores animation options on navigate actions", () => {
        const p = minimalProject();
        p.pages.push({ id: "page_b", name: "B", components: [] });
        const label = p.pages[0].components[0];
        expect(
            addNavigateFlow(p, 0, label.id, "clicked", "page_b", { anim: "move_left", time: 250 })
        ).toBe(true);
        const flows = collectNavigateFlows(p);
        expect(flows[0].anim).toBe("move_left");
        expect(flows[0].time).toBe(250);
        const evt = label.events?.find(e => e.trigger === "clicked");
        const nav = evt?.actions.find(a => a.type === "navigate" && a.target === "page_b");
        expect(nav).toMatchObject({ type: "navigate", target: "page_b", anim: "move_left", time: 250 });
    });
});
