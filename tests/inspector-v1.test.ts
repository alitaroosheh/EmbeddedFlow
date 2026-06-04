import { describe, expect, it } from "vitest";
import { applyComponentPatch, applyPageInspectorPatch } from "../src/embfComponentModel";
import type { Component, EmbfProject } from "../src/types/embf";
import { minimalProject } from "./fixtures";

function slider(): Component {
    return {
        id: "sld",
        type: "slider",
        x: 0,
        y: 0,
        width: 100,
        height: 20,
        min: 0,
        max: 100,
        value: 0
    };
}

function knob(): Component {
    return {
        id: "k1",
        type: "knob",
        x: 0,
        y: 0,
        width: 60,
        height: 60,
        min: 0,
        max: 100,
        value: 0
    };
}

describe("applyComponentPatch — v1 widget fields", () => {
    it("sets and clears styleRefs", () => {
        const c = slider() as Record<string, unknown>;
        applyComponentPatch(c as Component, { styleRefs: ["card", "danger"] });
        expect(c.styleRefs).toEqual(["card", "danger"]);
        applyComponentPatch(c as Component, { styleRefs: [] });
        expect("styleRefs" in c).toBe(false);
    });

    it("filters non-string styleRef entries", () => {
        const c = slider() as Record<string, unknown>;
        applyComponentPatch(c as Component, { styleRefs: ["a", 42, "", "b"] as unknown as string[] });
        expect(c.styleRefs).toEqual(["a", "b"]);
    });

    it("sets and clears the bindings map", () => {
        const c = slider() as Record<string, unknown>;
        applyComponentPatch(c as Component, { bindings: { value: "score" } });
        expect(c.bindings).toEqual({ value: "score" });
        applyComponentPatch(c as Component, { bindings: null });
        expect("bindings" in c).toBe(false);
    });

    it("ignores empty binding values", () => {
        const c = slider() as Record<string, unknown>;
        applyComponentPatch(c as Component, { bindings: { value: "  " } });
        expect("bindings" in c).toBe(false);
    });

    it("replaces animations[] when an array is provided and clears it on null", () => {
        const c = slider() as Record<string, unknown>;
        applyComponentPatch(c as Component, {
            animations: [{ property: "x", from: 0, to: 100, duration: 200 }]
        });
        expect(Array.isArray(c.animations)).toBe(true);
        expect((c.animations as unknown[]).length).toBe(1);
        applyComponentPatch(c as Component, { animations: null });
        expect("animations" in c).toBe(false);
    });

    it("applies knob-specific fields", () => {
        const c = knob() as Record<string, unknown>;
        applyComponentPatch(c as Component, {
            value: 50,
            startAngle: 135,
            endAngle: 45,
            indicatorColor: "#FF6633"
        });
        expect(c.value).toBe(50);
        expect(c.startAngle).toBe(135);
        expect(c.endAngle).toBe(45);
        expect(c.indicatorColor).toBe("#FF6633");
    });
});

describe("applyPageInspectorPatch — project styles and data fields", () => {
    it("creates and updates project.styles[] from projStyles patch", () => {
        const p: EmbfProject = minimalProject();
        applyPageInspectorPatch(p, 0, {
            projStyles: [
                { id: "card", name: "Card", props: { bgColor: "#101010", borderRadius: 8 } }
            ]
        });
        expect(p.styles?.length).toBe(1);
        expect(p.styles?.[0].id).toBe("card");
        expect(p.styles?.[0].name).toBe("Card");
        applyPageInspectorPatch(p, 0, { projStyles: [] });
        expect(p.styles).toBeUndefined();
    });

    it("creates and updates project.dataModel.fields from projDataFields patch", () => {
        const p: EmbfProject = minimalProject();
        applyPageInspectorPatch(p, 0, {
            projDataFields: [
                { id: "score", type: "int", default: 5 },
                { id: "name", type: "string", default: "Alita" }
            ]
        });
        expect(p.dataModel?.fields.length).toBe(2);
        expect(p.dataModel?.fields[0]).toEqual({ id: "score", type: "int", default: 5 });
        applyPageInspectorPatch(p, 0, { projDataFields: [] });
        expect(p.dataModel).toBeUndefined();
    });

    it("creates model.properties from projModelProperties patch", () => {
        const p: EmbfProject = minimalProject();
        applyPageInspectorPatch(p, 0, {
            projModelProperties: [
                { id: "temp_c", type: "float", default: 24, min: 0, max: 100, direction: "push" }
            ]
        });
        expect(p.model?.properties?.length).toBe(1);
        expect(p.model?.properties?.[0].direction).toBe("push");
        applyPageInspectorPatch(p, 0, { projModelProperties: [] });
        expect(p.model?.properties).toBeUndefined();
    });
});
