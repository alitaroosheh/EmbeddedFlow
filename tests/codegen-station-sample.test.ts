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
        expect(pageC).toContain("ui_get_string(UI_STR_STRING_COMFORT)");
        expect(pageC).toContain("ui_get_string(UI_STR_STRING_APP_TITLE)");
        expect(hasFileNamed(r.files, "ui_rtl_fonts.h")).toBe(true);
        expect(hasFileNamed(r.files, "ui_rtl_fonts.c")).toBe(true);
        expect(getFile(r.files, "ui.c")).toContain("ui_font_montserrat_nearest(14)");
        expect(getFile(r.files, "ui.c")).toContain("ui_rtl_fonts_init()");
        expect(pageC).toContain("ui_font_montserrat_nearest(22)");
        expect(pageC).not.toContain("lv_obj_set_style_text_font(ui_page_station_lbl_temp_title, UI_FONT_BIDI");
        expect(pageC).toContain("ui_page_station_lbl_night");
        expect(getFile(r.files, "ui_strings_refresh.c")).toContain(
            "ui_apply_localized_label_style(ui_page_station_lbl_night"
        );
        expect(getFile(r.files, "ui_strings_refresh.c")).toContain("LV_TEXT_ALIGN_LEFT");
        expect(getFile(r.files, "ui_strings_refresh.c")).toContain("ui_font_montserrat_nearest");
        expect(getFile(r.files, "embf_font_latin1_14.c")).toContain('#include "lvgl.h"');
        expect(pageC).not.toMatch(/lv_obj_t \*ui_page_station_arc_temp_gauge = lv_arc_create/);
        expect(pageC).toContain("lv_arc_set_value(ui_page_station_arc_temp_gauge, 24)");
        expect(pageC).toContain("ui_page_station_select_group_0(ui_page_station_btn_hot_1)");
        expect(pageC).toContain("static void ui_page_station_play_animations(void);");
        expect(pageC).toContain("static void ui_anim_opa_cb(void *obj, int32_t v);");
        const opaImplIdx = pageC.indexOf("static void ui_anim_opa_cb(void *obj, int32_t v)\n{");
        const playImplIdx = pageC.indexOf("static void ui_page_station_play_animations(void)\n{");
        const eventIdx = pageC.indexOf("static void ui_page_station_btn_cool_1_on_clicked(lv_event_t *e)\n{");
        expect(opaImplIdx).toBeGreaterThan(-1);
        expect(playImplIdx).toBeGreaterThan(opaImplIdx);
        expect(eventIdx).toBeGreaterThan(playImplIdx);
        expect(getFile(r.files, "ui_page_settings.c")).toContain("ui_page_settings_select_group_0");
        expect(pageC).toContain("lv_bar_set_value(ui_page_station_bar_hum, 56");

        expect(pageC).toContain('lv_label_set_text(ui_page_station_lbl_temp_value, "20")');
        expect(pageC).toContain('lv_label_set_text(ui_page_station_lbl_hum_value, "35")');
        expect(pageC).not.toContain("lv_obj_check_type");
        expect(pageC).not.toContain("ui_set_temp_c");
        expect(pageC).not.toContain("ui_bindings_apply");
    });
});
