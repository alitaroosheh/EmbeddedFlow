import * as path from "path";
import { describe, expect, it } from "vitest";
import { emitAnimationCalls } from "../src/codeGen/animationGen";
import { generateCode } from "../src/codeGen";
import type { AnimationDef } from "../src/types/embf";
import { minimalProject } from "./fixtures";

function getFileByBasename(files: Map<string, string>, name: string): string | undefined {
    for (const [filePath, content] of files) {
        if (path.basename(filePath) === name) {
            return content;
        }
    }
    return undefined;
}

describe("emitAnimationCalls", () => {
    it("returns no lines when animations is empty/undefined", () => {
        expect(emitAnimationCalls("v", undefined)).toEqual([]);
        expect(emitAnimationCalls("v", [])).toEqual([]);
    });

    it("emits init, var, exec, values, time, path, and start for a basic animation", () => {
        const anims: AnimationDef[] = [
            { property: "x", from: 0, to: 100, duration: 400, easing: "ease_out" }
        ];
        const lines = emitAnimationCalls("v", anims).join("\n");
        expect(lines).toContain("lv_anim_t a_v_0;");
        expect(lines).toContain("lv_anim_init(&a_v_0);");
        expect(lines).toContain("lv_anim_set_var(&a_v_0, v);");
        expect(lines).toContain("lv_anim_set_exec_cb(&a_v_0, (lv_anim_exec_xcb_t)lv_obj_set_x);");
        expect(lines).toContain("lv_anim_set_values(&a_v_0, 0, 100);");
        expect(lines).toContain("lv_anim_set_time(&a_v_0, 400);");
        expect(lines).toContain("lv_anim_set_path_cb(&a_v_0, lv_anim_path_ease_out);");
        expect(lines).toContain("lv_anim_start(&a_v_0);");
    });

    it("emits delay, repeat (infinite/finite), and playback when set", () => {
        const a1 = emitAnimationCalls("v", [
            { property: "y", from: 0, to: 50, delay: 100, repeat: -1, playback: true }
        ]).join("\n");
        expect(a1).toContain("lv_anim_set_delay(&a_v_0, 100);");
        expect(a1).toContain("lv_anim_set_repeat_count(&a_v_0, LV_ANIM_REPEAT_INFINITE);");
        expect(a1).toContain("lv_anim_set_playback_time(&a_v_0,");

        const a2 = emitAnimationCalls("v", [
            { property: "width", from: 100, to: 200, repeat: 3 }
        ]).join("\n");
        expect(a2).toContain("lv_anim_set_repeat_count(&a_v_0, 3);");
    });

    it("uses the opacity helper callback for opacity animations", () => {
        const lines = emitAnimationCalls("v", [
            { property: "opacity", from: 0, to: 255, duration: 200 }
        ]).join("\n");
        expect(lines).toContain("(lv_anim_exec_xcb_t)ui_anim_opa_cb");
    });
});

describe("generateCode integration with animations", () => {
    it("emits ui_anim_opa_cb helper once per page when an opacity animation exists", () => {
        const p = minimalProject();
        p.pages[0].components.push({
            id: "fader",
            type: "label",
            x: 0,
            y: 30,
            width: 100,
            height: 20,
            text: "fade",
            animations: [{ property: "opacity", from: 0, to: 255, duration: 200 }]
        });
        const r = generateCode(p, "/p/main.embf", "/p/out");
        const pageSrc = getFileByBasename(r.files, "ui_page_main.c")!;
        expect(pageSrc).toContain("static void ui_anim_opa_cb(void *obj, int32_t v)");
        expect(pageSrc).toContain("lv_obj_set_style_opa((lv_obj_t *)obj");
    });

    it("does not emit ui_anim_opa_cb when no opacity animations exist", () => {
        const p = minimalProject();
        p.pages[0].components.push({
            id: "slider",
            type: "label",
            x: 0,
            y: 30,
            width: 100,
            height: 20,
            text: "move",
            animations: [{ property: "x", from: 0, to: 100 }]
        });
        const r = generateCode(p, "/p/main.embf", "/p/out");
        const pageSrc = getFileByBasename(r.files, "ui_page_main.c")!;
        expect(pageSrc).not.toContain("static void ui_anim_opa_cb");
    });
});
