import * as path from "path";
import { describe, expect, it } from "vitest";
import {
    fontMacroSuffix,
    generateFontsHeader,
    generateFontsSource
} from "../src/codeGen/fontsGen";
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

function projectWithFonts(): EmbfProject {
    const p = minimalProject();
    p.fonts = [
        { id: "title", name: "lv_font_montserrat_24", size: 24 },
        { id: "body", name: "my_app_font_14", size: 14, source: "fonts/my_app_font_14.c" }
    ];
    return p;
}

describe("fontMacroSuffix", () => {
    it("uppercases and sanitises non-identifier characters", () => {
        expect(fontMacroSuffix("title bold")).toBe("TITLE_BOLD");
        expect(fontMacroSuffix("body.text-1")).toBe("BODY_TEXT_1");
        expect(fontMacroSuffix("")).toBe("FONT");
    });
});

describe("generateFontsHeader/Source", () => {
    it("returns null when no fonts are declared", () => {
        expect(generateFontsHeader(minimalProject())).toBeNull();
        expect(generateFontsSource(minimalProject())).toBeNull();
    });

    it("emits LV_FONT_DECLARE and UI_FONT_* macros for each font", () => {
        const h = generateFontsHeader(projectWithFonts())!;
        expect(h).toContain("LV_FONT_DECLARE(lv_font_montserrat_24);");
        expect(h).toContain("LV_FONT_DECLARE(my_app_font_14);");
        expect(h).toContain("#define UI_FONT_TITLE (&lv_font_montserrat_24)");
        expect(h).toContain("#define UI_FONT_BODY (&my_app_font_14)");
    });

    it("includes only custom (non-builtin) fonts in the source notes", () => {
        const c = generateFontsSource(projectWithFonts())!;
        expect(c).toContain("my_app_font_14");
        expect(c).toContain("fonts/my_app_font_14.c");
        expect(c).not.toContain("lv_font_montserrat_24");
    });
});

describe("generateCode integration with fonts", () => {
    it("does not emit ui_fonts.* when project.fonts is empty", () => {
        const r = generateCode(minimalProject(), "/p/main.embf", "/p/out");
        expect(hasFileNamed(r.files, "ui_fonts.h")).toBe(false);
        expect(hasFileNamed(r.files, "ui_fonts.c")).toBe(false);
        const uiH = getFileByBasename(r.files, "ui.h")!;
        expect(uiH).not.toContain("ui_fonts.h");
    });

    it("emits ui_fonts.h/.c and includes it from ui.h when fonts are declared", () => {
        const r = generateCode(projectWithFonts(), "/p/main.embf", "/p/out");
        expect(hasFileNamed(r.files, "ui_fonts.h")).toBe(true);
        expect(hasFileNamed(r.files, "ui_fonts.c")).toBe(true);
        const uiH = getFileByBasename(r.files, "ui.h")!;
        expect(uiH).toContain('#include "ui_fonts.h"');
    });

    it("uses UI_FONT_* macro when a widget's styles.fontFamily matches a font id", () => {
        const p = projectWithFonts();
        p.pages[0].components.push({
            id: "lbl_title",
            type: "label",
            x: 10,
            y: 10,
            width: 100,
            height: 24,
            text: "Hello",
            styles: { fontFamily: "title", fontSize: 20 }
        });
        const r = generateCode(p, "/p/main.embf", "/p/out");
        const pageSrc = getFileByBasename(r.files, "ui_page_main.c")!;
        expect(pageSrc).toContain("&lv_font_montserrat_24");
        expect(pageSrc).not.toContain("&lv_font_montserrat_20");
    });

    it("falls back to builtinFont(size) when fontFamily does not match", () => {
        const p = projectWithFonts();
        p.pages[0].components.push({
            id: "lbl_unknown",
            type: "label",
            x: 10,
            y: 10,
            width: 100,
            height: 16,
            text: "Hello",
            styles: { fontFamily: "missing", fontSize: 14 }
        });
        const r = generateCode(p, "/p/main.embf", "/p/out");
        const pageSrc = getFileByBasename(r.files, "ui_page_main.c")!;
        expect(pageSrc).toContain("&lv_font_montserrat_14");
    });
});
