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

function hasFileNamed(files: Map<string, string>, name: string): boolean {
    for (const p of files.keys()) {
        if (path.basename(p) === name) {
            return true;
        }
    }
    return false;
}

describe("temperature station sample codegen", () => {
    it("uses literal label text and direct lv_* setters (no dataModel bindings)", () => {
        const embfPath = path.join(__dirname, "../sample/temperature_humidity_station_1024x600_lvgl9.embf");
        const src = fs.readFileSync(embfPath, "utf-8");
        const project = parseEmbfSource(src);
        const r = generateCode(project, embfPath, "/tmp/out");
        const pageC = getFile(r.files, "ui_page_station.c");

        expect(hasFileNamed(r.files, "ui_bindings.c")).toBe(false);
        expect(project.dataModel).toBeUndefined();

        expect(pageC).toContain('lv_label_set_text(ui_page_station_lbl_temp_value, "24")');
        expect(pageC).toContain('lv_label_set_text(ui_page_station_lbl_hum_value, "56")');
        expect(pageC).toContain('lv_label_set_text(ui_page_station_lbl_clock, "08:41")');
        expect(pageC).toContain('lv_label_set_text(ui_page_station_lbl_hum_status, "Comfort")');
        expect(pageC).toContain("lv_arc_set_value(ui_page_station_arc_temp_gauge, 24)");
        expect(pageC).toContain("lv_bar_set_value(ui_page_station_bar_hum, 56");

        expect(pageC).toContain('lv_label_set_text(ui_page_station_lbl_temp_value, "20")');
        expect(pageC).toContain('lv_label_set_text(ui_page_station_lbl_hum_value, "35")');
        expect(pageC).not.toContain("lv_obj_check_type");
        expect(pageC).not.toContain("ui_set_temp_c");
        expect(pageC).not.toContain("ui_bindings_apply");
    });
});
