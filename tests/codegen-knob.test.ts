import * as path from "path";
import { describe, expect, it } from "vitest";
import { generateCode } from "../src/codeGen";
import { minimalProject } from "./fixtures";

function getFileByBasename(files: Map<string, string>, name: string): string | undefined {
    for (const [filePath, content] of files) {
        if (path.basename(filePath) === name) {
            return content;
        }
    }
    return undefined;
}

describe("knob codegen", () => {
    it("emits lv_arc primitives with knob-specific defaults", () => {
        const p = minimalProject();
        p.pages[0].components.push({
            id: "vol",
            type: "knob",
            x: 0,
            y: 30,
            width: 80,
            height: 80,
            min: 0,
            max: 100,
            value: 25,
            startAngle: 135,
            endAngle: 45,
            indicatorColor: "#FF6633"
        });
        const r = generateCode(p, "/p/main.embf", "/p/out");
        const pageSrc = getFileByBasename(r.files, "ui_page_main.c")!;
        expect(pageSrc).toContain("lv_arc_create(ui_page_main);");
        expect(pageSrc).toContain("lv_arc_set_range(ui_page_main_vol, 0, 100);");
        expect(pageSrc).toContain("lv_arc_set_value(ui_page_main_vol, 25);");
        expect(pageSrc).toContain("lv_arc_set_bg_angles(ui_page_main_vol, 135, 45);");
        expect(pageSrc).toContain("lv_obj_remove_style(ui_page_main_vol, NULL, LV_PART_KNOB);");
        expect(pageSrc).toContain(
            "lv_obj_set_style_arc_color(ui_page_main_vol, lv_color_hex(0xFF6633), LV_PART_INDICATOR);"
        );
        expect(pageSrc).toContain("lv_obj_add_flag(ui_page_main_vol, LV_OBJ_FLAG_CLICKABLE);");
    });

    it("omits indicator color override when not set", () => {
        const p = minimalProject();
        p.pages[0].components.push({
            id: "vol2",
            type: "knob",
            x: 0,
            y: 30,
            width: 80,
            height: 80,
            min: 0,
            max: 100,
            value: 0
        });
        const r = generateCode(p, "/p/main.embf", "/p/out");
        const pageSrc = getFileByBasename(r.files, "ui_page_main.c")!;
        expect(pageSrc).not.toContain("lv_obj_set_style_arc_color(ui_page_main_vol2");
        // Defaults: full 270° sweep with start=135 / end=45
        expect(pageSrc).toContain("lv_arc_set_bg_angles(ui_page_main_vol2, 135, 45);");
    });
});
