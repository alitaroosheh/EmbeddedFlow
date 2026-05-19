import { describe, it, expect } from "vitest";
import { generatePageSource } from "../src/codeGen/pageGen";
import { minimalProject } from "./fixtures";

describe("codegen navigate screen animation", () => {
    function projectWithNavigate(anim: string, lvglVersion: string) {
        const p = minimalProject();
        p.project.lvglVersion = lvglVersion;
        p.pages.push({ id: "page_b", name: "B", components: [] });
        p.pages[0].components[0].events = [
            {
                trigger: "clicked",
                actions: [{ type: "navigate", target: "page_b", anim, time: 400 }]
            }
        ];
        return p;
    }

    it("emits lv_screen_load_anim for LVGL 9", () => {
        const p = projectWithNavigate("move_left", "9.2.2");
        const src = generatePageSource(p, p.pages[0]);
        expect(src).toContain("lv_screen_load_anim(ui_page_b, LV_SCREEN_LOAD_ANIM_MOVE_LEFT, 400, 0, false)");
        expect(src).not.toContain("lv_screen_load(ui_page_b)");
    });

    it("emits lv_scr_load_anim for LVGL 8", () => {
        const p = projectWithNavigate("fade_in", "8.4.0");
        const src = generatePageSource(p, p.pages[0]);
        expect(src).toContain("lv_scr_load_anim(ui_page_b, LV_SCR_LOAD_ANIM_FADE_IN, 400, 0, false)");
        expect(src).not.toContain("lv_scr_load(ui_page_b)");
    });

    it("emits instant load when anim is none", () => {
        const p = projectWithNavigate("none", "9.2.2");
        const src = generatePageSource(p, p.pages[0]);
        expect(src).toContain("lv_screen_load(ui_page_b)");
        expect(src).not.toContain("lv_screen_load_anim");
    });
});
