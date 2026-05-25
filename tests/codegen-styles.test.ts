import * as path from "path";
import { describe, expect, it } from "vitest";
import {
    generateStylesHeader,
    generateStylesSource,
    styleVarName
} from "../src/codeGen/stylesGen";
import { generateCode } from "../src/codeGen";
import type { EmbfProject, StyleDef } from "../src/types/embf";
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

function projectWithStyles(): EmbfProject {
    const p = minimalProject();
    const styles: StyleDef[] = [
        {
            id: "card",
            name: "Card",
            props: { bgColor: "#202020", borderRadius: 8, padding: 12 }
        },
        {
            id: "danger",
            props: { textColor: "#FF3344", borderColor: "#FF3344", borderWidth: 2 }
        }
    ];
    p.styles = styles;
    return p;
}

describe("styleVarName", () => {
    it("prefixes with ui_style_ and keeps C identifiers intact", () => {
        expect(styleVarName("card")).toBe("ui_style_card");
        expect(styleVarName("danger_v2")).toBe("ui_style_danger_v2");
    });
});

describe("generateStylesHeader/Source", () => {
    it("returns null when no styles declared", () => {
        expect(generateStylesHeader(minimalProject())).toBeNull();
        expect(generateStylesSource(minimalProject())).toBeNull();
    });

    it("emits externs + init declaration in header", () => {
        const h = generateStylesHeader(projectWithStyles())!;
        expect(h).toContain("extern lv_style_t ui_style_card;");
        expect(h).toContain("extern lv_style_t ui_style_danger;");
        expect(h).toContain("void ui_styles_init(void);");
    });

    it("emits lv_style_init + setters in source", () => {
        const c = generateStylesSource(projectWithStyles())!;
        expect(c).toContain("lv_style_t ui_style_card;");
        expect(c).toContain("lv_style_init(&ui_style_card);");
        expect(c).toContain("lv_style_set_bg_color(&ui_style_card");
        expect(c).toContain("lv_style_set_radius(&ui_style_card, 8);");
        expect(c).toContain("lv_style_set_pad_all(&ui_style_card, 12);");
        expect(c).toContain("lv_style_init(&ui_style_danger);");
        expect(c).toContain("lv_style_set_text_color(&ui_style_danger");
        expect(c).toContain("lv_style_set_border_width(&ui_style_danger, 2);");
    });
});

describe("generateCode integration with named styles", () => {
    it("does not emit ui_styles.* when project.styles is empty", () => {
        const r = generateCode(minimalProject(), "/p/main.embf", "/p/out");
        expect(hasFileNamed(r.files, "ui_styles.h")).toBe(false);
        expect(hasFileNamed(r.files, "ui_styles.c")).toBe(false);
        const uiH = getFileByBasename(r.files, "ui.h")!;
        expect(uiH).not.toContain("ui_styles.h");
    });

    it("emits ui_styles.h/.c, includes from ui.h, and calls ui_styles_init() from ui_init()", () => {
        const r = generateCode(projectWithStyles(), "/p/main.embf", "/p/out");
        expect(hasFileNamed(r.files, "ui_styles.h")).toBe(true);
        expect(hasFileNamed(r.files, "ui_styles.c")).toBe(true);
        const uiH = getFileByBasename(r.files, "ui.h")!;
        expect(uiH).toContain('#include "ui_styles.h"');
        const uiC = getFileByBasename(r.files, "ui.c")!;
        expect(uiC).toContain("ui_styles_init();");
    });

    it("emits lv_obj_add_style for widgets that reference a styleRef id", () => {
        const p = projectWithStyles();
        p.pages[0].components.push({
            id: "card1",
            type: "container",
            x: 0,
            y: 50,
            width: 200,
            height: 100,
            styleRefs: ["card"],
            children: []
        });
        const r = generateCode(p, "/p/main.embf", "/p/out");
        const pageSrc = getFileByBasename(r.files, "ui_page_main.c")!;
        expect(pageSrc).toContain(
            "lv_obj_add_style(ui_page_main_card1, &ui_style_card, LV_PART_MAIN | LV_STATE_DEFAULT);"
        );
    });

    it("warns (in a comment) when a styleRef does not exist in project.styles[]", () => {
        const p = projectWithStyles();
        p.pages[0].components.push({
            id: "bad",
            type: "container",
            x: 0,
            y: 50,
            width: 100,
            height: 50,
            styleRefs: ["missing"],
            children: []
        });
        // The parser refuses unknown styleRefs when styles[] is non-empty;
        // bypass the parser by feeding directly to generateCode.
        const r = generateCode(p, "/p/main.embf", "/p/out");
        const pageSrc = getFileByBasename(r.files, "ui_page_main.c")!;
        expect(pageSrc).toContain('/* WARN: styleRef "missing" not declared');
    });
});
