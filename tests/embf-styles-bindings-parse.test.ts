import { describe, expect, it } from "vitest";
import { parseEmbfSource } from "../src/embfParser";
import { minimalProject } from "./fixtures";

function asSource(project: object): string {
    return JSON.stringify(project);
}

describe("parser: project.styles[]", () => {
    it("accepts a valid styles array and known styleRefs", () => {
        const p: any = minimalProject();
        p.styles = [
            { id: "card", name: "Card", props: { bgColor: "#202020", borderRadius: 8 } }
        ];
        p.pages[0].components[0] = {
            id: "card1",
            type: "container",
            x: 0, y: 0, width: 100, height: 100,
            styleRefs: ["card"],
            children: []
        };
        expect(() => parseEmbfSource(asSource(p))).not.toThrow();
    });

    it("rejects duplicate style ids", () => {
        const p: any = minimalProject();
        p.styles = [
            { id: "a", props: {} },
            { id: "a", props: {} }
        ];
        expect(() => parseEmbfSource(asSource(p))).toThrow(/duplicates/);
    });

    it("rejects unknown styleRefs when styles[] is non-empty", () => {
        const p: any = minimalProject();
        p.styles = [{ id: "a", props: {} }];
        p.pages[0].components[0] = {
            id: "card1",
            type: "container",
            x: 0, y: 0, width: 100, height: 100,
            styleRefs: ["missing"],
            children: []
        };
        expect(() => parseEmbfSource(asSource(p))).toThrow(/not defined in project\.styles/);
    });

    it("rejects style ids that are not valid C identifiers", () => {
        const p: any = minimalProject();
        p.styles = [{ id: "1bad", props: {} }];
        expect(() => parseEmbfSource(asSource(p))).toThrow(/valid C identifier/);
    });
});

describe("parser: dataModel + bindings", () => {
    it("accepts label text referencing known fields", () => {
        const p: any = minimalProject();
        p.dataModel = { fields: [{ id: "username", type: "string", default: "x" }] };
        p.pages[0].components[0].text = "Hello {{username}}";
        expect(() => parseEmbfSource(asSource(p))).not.toThrow();
    });

    it("rejects label text referencing unknown fields", () => {
        const p: any = minimalProject();
        p.dataModel = { fields: [{ id: "username", type: "string" }] };
        p.pages[0].components[0].text = "Hello {{missing}}";
        expect(() => parseEmbfSource(asSource(p))).toThrow(/unknown binding field/);
    });

    it("rejects bindings when dataModel.fields[] is empty", () => {
        const p: any = minimalProject();
        p.pages[0].components[0].text = "Hello {{whatever}}";
        expect(() => parseEmbfSource(asSource(p))).toThrow(/dataModel\.fields\[\] is empty/);
    });

    it("validates default value type against declared field type", () => {
        const p: any = minimalProject();
        p.dataModel = { fields: [{ id: "score", type: "int", default: 1.5 }] };
        expect(() => parseEmbfSource(asSource(p))).toThrow(/must be an integer/);
    });
});

describe("parser: numeric bindings", () => {
    it("accepts slider/bar/arc/knob bindings.value pointing at a declared field", () => {
        const p: any = minimalProject();
        p.dataModel = { fields: [{ id: "score", type: "int", default: 5 }] };
        p.pages[0].components.push(
            { id: "sld", type: "slider", x: 0, y: 0, width: 100, height: 20, min: 0, max: 100, value: 0, bindings: { value: "score" } },
            { id: "kn",  type: "knob",   x: 0, y: 30, width: 60, height: 60, min: 0, max: 100, value: 0, bindings: { value: "score" } }
        );
        expect(() => parseEmbfSource(asSource(p))).not.toThrow();
    });

    it("rejects bindings on widget types that don't expose the property", () => {
        const p: any = minimalProject();
        p.dataModel = { fields: [{ id: "x", type: "string" }] };
        p.pages[0].components.push(
            { id: "b1", type: "button", x: 0, y: 0, width: 40, height: 20, label: "B", bindings: { value: "x" } }
        );
        expect(() => parseEmbfSource(asSource(p))).toThrow(/not a bindable property/);
    });

    it("rejects bindings.value pointing at an unknown field", () => {
        const p: any = minimalProject();
        p.dataModel = { fields: [{ id: "score", type: "int" }] };
        p.pages[0].components.push(
            { id: "sld", type: "slider", x: 0, y: 0, width: 100, height: 20, min: 0, max: 100, value: 0, bindings: { value: "nope" } }
        );
        expect(() => parseEmbfSource(asSource(p))).toThrow(/unknown field "nope"/);
    });
});

describe("parser: knob", () => {
    it("accepts a minimal knob definition", () => {
        const p: any = minimalProject();
        p.pages[0].components.push(
            { id: "k1", type: "knob", x: 0, y: 0, width: 80, height: 80, min: 0, max: 100, value: 50 }
        );
        expect(() => parseEmbfSource(asSource(p))).not.toThrow();
    });

    it("rejects knob with non-numeric value", () => {
        const p: any = minimalProject();
        p.pages[0].components.push(
            { id: "k1", type: "knob", x: 0, y: 0, width: 80, height: 80, min: 0, max: 100, value: "x" }
        );
        expect(() => parseEmbfSource(asSource(p))).toThrow(/value must be a finite number/);
    });

    it("rejects knob.indicatorColor when not a string", () => {
        const p: any = minimalProject();
        p.pages[0].components.push(
            { id: "k1", type: "knob", x: 0, y: 0, width: 80, height: 80, min: 0, max: 100, value: 50, indicatorColor: 42 }
        );
        expect(() => parseEmbfSource(asSource(p))).toThrow(/indicatorColor must be a string/);
    });
});

describe("parser: animations[]", () => {
    it("accepts well-formed animation entries", () => {
        const p: any = minimalProject();
        p.pages[0].components[0].animations = [
            { property: "x", from: 0, to: 100, duration: 300, easing: "ease_out" },
            { property: "opacity", from: 0, to: 255, repeat: -1, playback: true }
        ];
        expect(() => parseEmbfSource(asSource(p))).not.toThrow();
    });

    it("rejects unknown animation property", () => {
        const p: any = minimalProject();
        p.pages[0].components[0].animations = [
            { property: "rotation", from: 0, to: 90 }
        ];
        expect(() => parseEmbfSource(asSource(p))).toThrow(/property must be one of/);
    });

    it("rejects unknown easing", () => {
        const p: any = minimalProject();
        p.pages[0].components[0].animations = [
            { property: "x", from: 0, to: 1, easing: "warp" }
        ];
        expect(() => parseEmbfSource(asSource(p))).toThrow(/easing must be one of/);
    });
});
