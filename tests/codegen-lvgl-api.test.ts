import { describe, it, expect } from "vitest";
import { generateRootSource, isLvglV9 } from "../src/codeGen/pageGen";
import { minimalProject } from "./fixtures";

describe("codegen LVGL API version", () => {
    it("detects v9 from project.lvglVersion", () => {
        expect(isLvglV9(minimalProject())).toBe(true);
        const p9 = minimalProject();
        p9.project.lvglVersion = "9.2.2";
        expect(isLvglV9(p9)).toBe(true);
        const p8 = minimalProject();
        p8.project.lvglVersion = "8.4.0";
        expect(isLvglV9(p8)).toBe(false);
    });

    it("emits LVGL 9 display/screen APIs for 9.x", () => {
        const src = generateRootSource(minimalProject());
        expect(src).toContain("lv_display_get_default()");
        expect(src).toContain("lv_display_set_theme");
        expect(src).toContain("lv_screen_load(");
        expect(src).not.toContain("lv_disp_get_default()");
        expect(src).not.toContain("lv_scr_load(");
    });

    it("emits LVGL 8 display/screen APIs for 8.x", () => {
        const p = minimalProject();
        p.project.lvglVersion = "8.4.0";
        const src = generateRootSource(p);
        expect(src).toContain("lv_disp_get_default()");
        expect(src).toContain("lv_disp_set_theme");
        expect(src).toContain("lv_scr_load(");
        expect(src).not.toContain("lv_display_get_default()");
        expect(src).not.toContain("lv_screen_load(");
        expect(src).toMatch(
            /lv_theme_default_init\(\s*\n\s*lv_disp_get_default\(\)/
        );
    });
});
