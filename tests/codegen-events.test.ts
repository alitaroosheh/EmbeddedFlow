import { describe, expect, it } from "vitest";
import { generatePageSource } from "../src/codeGen/pageGen";
import { minimalProject } from "./fixtures";

describe("codegen event actions", () => {
    it("emits type-specific set_value (not lv_obj_check_type fallback chain)", () => {
        const p = minimalProject();
        p.dataModel = { fields: [{ id: "temp_c", type: "int", default: 24 }] };
        p.pages[0].components.push(
            {
                id: "arc1",
                type: "arc",
                x: 0,
                y: 0,
                width: 80,
                height: 80,
                min: 0,
                max: 50,
                value: 24,
                bindings: { value: "temp_c" },
                events: [
                    {
                        trigger: "clicked",
                        actions: [{ type: "set_value", target: "arc1", value: 30 }]
                    }
                ]
            },
            {
                id: "bar1",
                type: "bar",
                x: 0,
                y: 90,
                width: 120,
                height: 16,
                min: 0,
                max: 100,
                value: 50,
                events: [
                    {
                        trigger: "clicked",
                        actions: [{ type: "set_value", target: "bar1", value: 70 }]
                    }
                ]
            }
        );
        const src = generatePageSource(p, p.pages[0]);
        expect(src).toContain("ui_set_temp_c(30);");
        expect(src).not.toContain("lv_obj_check_type");
        expect(src).toContain("lv_bar_set_value(ui_page_main_bar1, 70, LV_ANIM_OFF);");
        expect(src).toContain("ui_bindings_apply();");
    });

    it("does not append ui_bindings_apply when actions use ui_set_* only", () => {
        const p = minimalProject();
        p.dataModel = { fields: [{ id: "temp_c", type: "int", default: 24 }] };
        p.pages[0].components.push({
            id: "btn1",
            type: "button",
            x: 0,
            y: 0,
            width: 80,
            height: 36,
            label: "Go",
            events: [
                {
                    trigger: "clicked",
                    actions: [{ type: "set_value", target: "arc1", value: 30 }]
                }
            ]
        });
        p.pages[0].components.push({
            id: "arc1",
            type: "arc",
            x: 0,
            y: 40,
            width: 80,
            height: 80,
            min: 0,
            max: 50,
            value: 24,
            bindings: { value: "temp_c" }
        });
        const src = generatePageSource(p, p.pages[0]);
        expect(src).toContain("ui_set_temp_c(30);");
        expect(src).not.toMatch(/btn1[\s\S]*?ui_bindings_apply\(\)/);
    });

    it("routes set_text on {{field}} labels through data setters", () => {
        const p = minimalProject();
        p.dataModel = { fields: [{ id: "humidity", type: "int", default: 56 }] };
        p.pages[0].components.push({
            id: "lbl_h",
            type: "label",
            x: 0,
            y: 0,
            width: 80,
            height: 32,
            text: "{{humidity}}",
            events: [
                {
                    trigger: "clicked",
                    actions: [{ type: "set_text", target: "lbl_h", text: "78" }]
                }
            ]
        });
        const src = generatePageSource(p, p.pages[0]);
        expect(src).toContain("ui_set_humidity(78);");
        expect(src).not.toContain('lv_label_set_text(ui_page_main_lbl_h, "78")');
    });

    it("does not use lv_obj_report_style_change for set_theme", () => {
        const p = minimalProject();
        p.pages[0].components.push({
            id: "sw1",
            type: "switch",
            x: 0,
            y: 0,
            width: 52,
            height: 28,
            checked: false,
            events: [{ trigger: "value_changed", actions: [{ type: "set_theme" }] }]
        });
        const src = generatePageSource(p, p.pages[0]);
        expect(src).not.toContain("lv_obj_report_style_change");
        expect(src).toContain("lv_obj_invalidate(lv_screen_active())");
    });
});
