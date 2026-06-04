import { describe, expect, it } from "vitest";
import { bindingsInitOnlyCalls, generateBindingsHeader, hasBindings } from "../src/codeGen/bindingsGen";
import { applyPageInspectorPatch } from "../src/embfComponentModel";
import { getPreviewProperties, validateModelPropertyDeep } from "../src/embfModel";
import { EmbfParseError, parseEmbfSource } from "../src/embfParser";
import type { EmbfProject } from "../src/types/embf";

function minimalProject(): EmbfProject {
    return {
        version: "1.0",
        project: { name: "t", lvglVersion: "9.4.0" },
        display: {
            width: 320,
            height: 240,
            bitDepth: 16,
            colorFormat: "RGB565",
            orientation: "portrait",
            direction: "ltr"
        },
        pages: [{ id: "p1", name: "Main", components: [] }]
    };
}

describe("model.properties", () => {
    it("parses model.properties with min, max, direction", () => {
        const raw = {
            version: "1.0",
            project: { name: "t", lvglVersion: "9.4.0" },
            display: {
                width: 320,
                height: 240,
                bitDepth: 16,
                colorFormat: "RGB565",
                orientation: "portrait",
                direction: "ltr"
            },
            model: {
                properties: [
                    {
                        id: "temp_c",
                        type: "float",
                        default: 25.5,
                        min: -40,
                        max: 125,
                        direction: "push"
                    }
                ]
            },
            pages: [{ id: "p1", name: "Main", components: [] }]
        };
        const p = parseEmbfSource(JSON.stringify(raw));
        expect(p.model?.properties?.length).toBe(1);
        expect(p.model?.properties?.[0]).toMatchObject({
            id: "temp_c",
            type: "float",
            direction: "push"
        });
    });

    it("rejects duplicate id in model.properties and dataModel.fields", () => {
        const raw = {
            version: "1.0",
            project: { name: "t", lvglVersion: "9.4.0" },
            display: {
                width: 320,
                height: 240,
                bitDepth: 16,
                colorFormat: "RGB565",
                orientation: "portrait",
                direction: "ltr"
            },
            dataModel: { fields: [{ id: "x", type: "int" }] },
            model: { properties: [{ id: "x", type: "float" }] },
            pages: [{ id: "p1", name: "Main", components: [] }]
        };
        expect(() => parseEmbfSource(JSON.stringify(raw))).toThrow(/duplicates/);
    });

    it("getPreviewProperties prefers model.properties over dataModel", () => {
        const p = minimalProject();
        p.dataModel = { fields: [{ id: "legacy", type: "int", default: 1 }] };
        p.model = { properties: [{ id: "new", type: "string", default: "hi" }] };
        expect(getPreviewProperties(p).map(x => x.id)).toEqual(["new"]);
    });

    it("getPreviewProperties falls back to dataModel when model absent", () => {
        const p = minimalProject();
        p.dataModel = { fields: [{ id: "legacy", type: "int", default: 3 }] };
        expect(getPreviewProperties(p)[0].id).toBe("legacy");
    });

    it("applyPageInspectorPatch writes model.properties and clears legacy dataModel", () => {
        const p = minimalProject();
        p.dataModel = { fields: [{ id: "a", type: "int", default: 1 }] };
        applyPageInspectorPatch(p, 0, {
            projModelProperties: [{ id: "b", type: "float", default: 2.5, direction: "pull" }]
        });
        expect(p.model?.properties?.length).toBe(1);
        expect(p.model?.properties?.[0].id).toBe("b");
        expect(p.dataModel).toBeUndefined();
    });

    it("validateModelPropertyDeep rejects min > max", () => {
        expect(() =>
            validateModelPropertyDeep({ id: "t", type: "int", min: 10, max: 5 }, "p")
        ).toThrow(/min/);
    });

    it("does not emit ui_bindings when only model.properties (Phase 1 — no codegen)", () => {
        const p = minimalProject();
        p.model = {
            properties: [{ id: "temp_c", type: "float", default: 25, direction: "push" }]
        };
        p.pages[0].components = [
            {
                id: "lbl",
                type: "label",
                x: 0,
                y: 0,
                width: 80,
                height: 24,
                text: "{{temp_c}}"
            }
        ];
        expect(hasBindings(p)).toBe(false);
        expect(bindingsInitOnlyCalls(p)).toEqual([]);
        expect(generateBindingsHeader(p)).toBeNull();
    });
});
