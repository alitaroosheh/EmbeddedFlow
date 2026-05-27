import * as fs from "fs";
import * as path from "path";
import { describe, expect, it } from "vitest";
import { parseEmbfSource } from "../src/embfParser";
import { generateCode } from "../src/codeGen";

function getFile(files: Map<string, string>, name: string): string {
    for (const [p, c] of files) {
        if (path.basename(p) === name) {
            return c;
        }
    }
    throw new Error(`missing ${name}`);
}

describe("temperature station sample codegen", () => {
    it("emits ui_set_* for bound arc/bar buttons and safe handlers", () => {
        const embfPath = path.join(__dirname, "../sample/temperature_humidity_station_1024x600_lvgl9.embf");
        const src = fs.readFileSync(embfPath, "utf-8");
        const project = parseEmbfSource(src);
        const r = generateCode(project, embfPath, "/tmp/out");
        const pageC = getFile(r.files, "ui_page_station.c");
        const bindC = getFile(r.files, "ui_bindings.c");

        expect(bindC).toContain("ui_data_humidity");
        expect(bindC).toContain("snprintf(buf, sizeof(buf), \"%d\"");
        expect(bindC).toContain("ui_page_station_lbl_hum_value");
        expect(bindC).toContain("ui_page_station_arc_temp_gauge");

        expect(pageC).toContain("ui_set_temp_c(20);");
        expect(pageC).toContain("ui_set_temp_c(24);");
        expect(pageC).toContain("ui_set_temp_c(30);");
        expect(pageC).toContain("ui_set_humidity(35);");
        expect(pageC).not.toContain("lv_obj_check_type");

        expect(pageC).not.toMatch(/btn_cool[\s\S]*?ui_bindings_apply\(\)/);
        expect(pageC).not.toMatch(/btn_hum_dry[\s\S]*?ui_bindings_apply\(\)/);
        expect(pageC).toContain('ui_set_humidity_band("Dry")');

        const bindApply = bindC.slice(
            bindC.indexOf("void ui_bindings_apply"),
            bindC.indexOf("void ui_set_")
        );
        expect(bindApply).toContain("ui_page_station_lbl_clock");
        expect(bindApply).toContain('"%s:%s"');
        expect(bindApply).toContain("lv_obj_invalidate(scr)");

        const uiC = getFile(r.files, "ui.c");
        const loadIdx = uiC.indexOf("lv_screen_load");
        const applyIdx = uiC.lastIndexOf("ui_bindings_apply();");
        expect(loadIdx).toBeGreaterThan(-1);
        expect(applyIdx).toBeGreaterThan(loadIdx);
    });
});
