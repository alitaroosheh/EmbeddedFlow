import { describe, expect, it } from "vitest";
import { applyPageInspectorPatch } from "../src/embfComponentModel";
import { parseEmbfSource } from "../src/embfParser";
import { minimalProject } from "./fixtures";

function asSource(project: ReturnType<typeof minimalProject>): string {
    return JSON.stringify(project, null, 2);
}

describe("dataModel.sources + bindings (Phase 2 step 3.2/3.3)", () => {
    it("parses dataModel with sources and bindings without legacy fields", () => {
        const p = minimalProject();
        p.dataModel = {
            sources: [{ id: "src_app_data", kind: "global", symbol: "app_data", type: "app_state_t" }],
            bindings: [{ target: "lbl_temp.text", sourceId: "src_app_data", path: "temp_c" }]
        };
        const parsed = parseEmbfSource(asSource(p));
        expect(parsed.dataModel?.sources?.[0]?.symbol).toBe("app_data");
        expect(parsed.dataModel?.bindings?.[0]?.path).toBe("temp_c");
    });

    it("rejects binding with unknown sourceId when sources are declared", () => {
        const p = minimalProject();
        p.dataModel = {
            sources: [{ id: "src_a", kind: "global", symbol: "a" }],
            bindings: [{ target: "lbl_x.text", sourceId: "missing", path: "" }]
        };
        expect(() => parseEmbfSource(asSource(p))).toThrow(/not declared in dataModel\.sources/);
    });

    it("rejects invalid binding target shape", () => {
        const p = minimalProject();
        p.dataModel = {
            sources: [{ id: "src_a", kind: "global", symbol: "a" }],
            bindings: [{ target: "badtarget", sourceId: "src_a", path: "" }]
        };
        expect(() => parseEmbfSource(asSource(p))).toThrow(/widgetId\.text/);
    });

    it("applyPageInspectorPatch writes sources and bindings", () => {
        const p = minimalProject();
        applyPageInspectorPatch(p, 0, {
            projDataSources: [{ id: "src_g", kind: "global", symbol: "g_temp" }],
            projDataBindings: [{ target: "sld1.value", sourceId: "src_g", path: "" }]
        });
        expect(p.dataModel?.sources?.length).toBe(1);
        expect(p.dataModel?.bindings?.[0]?.target).toBe("sld1.value");
    });

    it("clearing bindings removes dataModel when nothing else remains", () => {
        const p = minimalProject();
        applyPageInspectorPatch(p, 0, {
            projDataSources: [{ id: "src_g", kind: "global", symbol: "g_temp" }],
            projDataBindings: [{ target: "sld1.value", sourceId: "src_g", path: "" }]
        });
        applyPageInspectorPatch(p, 0, { projDataBindings: null, projDataSources: null });
        expect(p.dataModel).toBeUndefined();
    });
});
