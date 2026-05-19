import { describe, it, expect } from "vitest";
import { generatePageSource } from "../src/codeGen/pageGen";
import { minimalProject } from "./fixtures";

describe("codegen page swipe", () => {
    it("emits LV_EVENT_GESTURE handler with lv_indev_get_gesture_dir for LVGL 9", () => {
        const p = minimalProject();
        p.pages.push({ id: "page_b", name: "B", components: [] });
        p.pages[0].swipes = [
            { direction: "left", target: "page_b", anim: "move_left", time: 350 }
        ];
        const src = generatePageSource(p, p.pages[0]);
        expect(src).toContain("ui_page_main_on_swipe");
        expect(src).toContain("LV_EVENT_GESTURE");
        expect(src).toContain("lv_indev_get_gesture_dir(lv_indev_active())");
        expect(src).not.toContain("lv_indev_get_act()");
        expect(src).toContain("if (dir == LV_DIR_LEFT)");
        expect(src).toContain("lv_screen_load_anim(ui_page_b, LV_SCREEN_LOAD_ANIM_MOVE_LEFT, 350, 0, false)");
    });

    it("emits lv_scr_load for instant swipe target on LVGL 8", () => {
        const p = minimalProject();
        p.project.lvglVersion = "8.4.0";
        p.pages.push({ id: "page_b", name: "B", components: [] });
        p.pages[0].swipes = [{ direction: "right", target: "page_b" }];
        const src = generatePageSource(p, p.pages[0]);
        expect(src).toContain("if (dir == LV_DIR_RIGHT)");
        expect(src).toContain("lv_scr_load(ui_page_b)");
        expect(src).toContain("lv_indev_get_gesture_dir(lv_indev_get_act())");
        expect(src).not.toContain("lv_indev_active()");
    });
});
