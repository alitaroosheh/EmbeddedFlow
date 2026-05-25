import * as path from "path";
import { describe, expect, it } from "vitest";
import {
    generateBindingsHeader,
    generateBindingsSource,
    dataVarName,
    dataSetterName,
    dataGetterName
} from "../src/codeGen/bindingsGen";
import { generateCode } from "../src/codeGen";
import type { EmbfProject } from "../src/types/embf";
import { minimalProject } from "./fixtures";

function getFileByBasename(files: Map<string, string>, name: string): string | undefined {
    for (const [filePath, content] of files) {
        if (path.basename(filePath) === name) {
            return content;
        }
    }
    return undefined;
}

function hasFileNamed(files: Map<string, string>, name: string): boolean {
    return getFileByBasename(files, name) !== undefined;
}

function projectWithBindings(): EmbfProject {
    const p = minimalProject();
    p.dataModel = {
        fields: [
            { id: "username", type: "string", default: "Alita" },
            { id: "score", type: "int", default: 42 },
            { id: "ratio", type: "float", default: 1.25 },
            { id: "active", type: "bool", default: true }
        ]
    };
    return p;
}

describe("data field helpers", () => {
    it("derive consistent C identifiers", () => {
        expect(dataVarName("foo")).toBe("ui_data_foo");
        expect(dataSetterName("foo")).toBe("ui_set_foo");
        expect(dataGetterName("foo")).toBe("ui_get_foo");
    });
});

describe("generateBindingsHeader/Source", () => {
    it("returns null when no dataModel is defined", () => {
        expect(generateBindingsHeader(minimalProject())).toBeNull();
        expect(generateBindingsSource(minimalProject())).toBeNull();
    });

    it("emits externs, setters, getters and init in header", () => {
        const h = generateBindingsHeader(projectWithBindings())!;
        expect(h).toContain("extern const char *ui_data_username;");
        expect(h).toContain("extern int32_t ui_data_score;");
        expect(h).toContain("extern float ui_data_ratio;");
        expect(h).toContain("extern bool ui_data_active;");
        expect(h).toContain("void ui_set_username(const char *value);");
        expect(h).toContain("void ui_set_score(int32_t value);");
        expect(h).toContain("int32_t ui_get_score(void);");
        expect(h).toContain("void ui_bindings_init(void);");
        expect(h).toContain("void ui_bindings_apply(void);");
    });

    it("initialises backing storage from default values in source", () => {
        const c = generateBindingsSource(projectWithBindings())!;
        expect(c).toContain('ui_data_username = "Alita";');
        expect(c).toContain("ui_data_score = 42;");
        expect(c).toContain("ui_data_ratio = 1.25f;");
        expect(c).toContain("ui_data_active = true;");
        expect(c).toContain("void ui_set_username(const char *value)");
        expect(c).toContain("ui_bindings_apply();");
    });
});

describe("generateCode integration with bindings", () => {
    it("does not emit ui_bindings.* when no dataModel is set", () => {
        const r = generateCode(minimalProject(), "/p/main.embf", "/p/out");
        expect(hasFileNamed(r.files, "ui_bindings.h")).toBe(false);
        expect(hasFileNamed(r.files, "ui_bindings.c")).toBe(false);
        const uiH = getFileByBasename(r.files, "ui.h")!;
        expect(uiH).not.toContain("ui_bindings.h");
    });

    it("emits ui_bindings.h/.c and wires init + apply calls in ui.c", () => {
        const p = projectWithBindings();
        p.pages[0].components.push({
            id: "lbl_user",
            type: "label",
            x: 0,
            y: 50,
            width: 200,
            height: 20,
            text: "Hello {{username}}"
        });
        const r = generateCode(p, "/p/main.embf", "/p/out");
        expect(hasFileNamed(r.files, "ui_bindings.h")).toBe(true);
        expect(hasFileNamed(r.files, "ui_bindings.c")).toBe(true);
        const uiH = getFileByBasename(r.files, "ui.h")!;
        expect(uiH).toContain('#include "ui_bindings.h"');
        const uiC = getFileByBasename(r.files, "ui.c")!;
        expect(uiC).toContain("ui_bindings_init();");
        expect(uiC).toContain("ui_bindings_apply();");
    });

    it("rewires bound numeric widgets (slider/bar/arc/knob) via ui_bindings_apply", () => {
        const p = projectWithBindings();
        p.pages[0].components.push(
            { id: "sld", type: "slider", x: 0, y: 80, width: 100, height: 20, min: 0, max: 100, value: 0, bindings: { value: "score" } },
            { id: "br",  type: "bar",    x: 0, y: 110, width: 100, height: 12, min: 0, max: 100, value: 0, bindings: { value: "score" } },
            { id: "ar",  type: "arc",    x: 0, y: 130, width: 60, height: 60,  min: 0, max: 100, value: 0, bindings: { value: "score" } },
            { id: "kn",  type: "knob",   x: 60, y: 130, width: 60, height: 60, min: 0, max: 100, value: 0, bindings: { value: "score" } }
        );
        const r = generateCode(p, "/p/main.embf", "/p/out");
        const bindC = getFileByBasename(r.files, "ui_bindings.c")!;
        expect(bindC).toContain("lv_slider_set_value(ui_page_main_sld, (int32_t)ui_get_score(), LV_ANIM_OFF);");
        expect(bindC).toContain("lv_bar_set_value(ui_page_main_br, (int32_t)ui_get_score(), LV_ANIM_OFF);");
        expect(bindC).toContain("lv_arc_set_value(ui_page_main_ar, (int32_t)ui_get_score());");
        expect(bindC).toContain("lv_arc_set_value(ui_page_main_kn, (int32_t)ui_get_score());");
    });

    it("rewires bound labels in ui_bindings_apply with the correct printf spec per type", () => {
        const p = projectWithBindings();
        p.pages[0].components.push({
            id: "lbl_user",
            type: "label",
            x: 0,
            y: 50,
            width: 200,
            height: 20,
            text: "user={{username}} score={{score}}"
        });
        const r = generateCode(p, "/p/main.embf", "/p/out");
        const bindC = getFileByBasename(r.files, "ui_bindings.c")!;
        expect(bindC).toContain("ui_page_main_lbl_user");
        expect(bindC).toContain("lv_label_set_text(ui_page_main_lbl_user, buf);");
        // string + int formatting
        expect(bindC).toMatch(/snprintf\(buf, sizeof\(buf\), "user=%s score=%d"/);
        expect(bindC).toContain("ui_get_username()");
        expect(bindC).toContain("(int)ui_get_score()");
    });
});
