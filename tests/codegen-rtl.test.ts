import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { describe, expect, it } from "vitest";
import { generateCode } from "../src/codeGen/index";
import { generateLvConf } from "../src/codeGen/pageGen";
import { generateStringsCodegen } from "../src/codeGen/stringsGen";
import { resolveTextDirection } from "../src/i18n/textDirection";
import { parseStringsResSource } from "../src/i18n/stringsResParser";
import { lintStringResourceRefs } from "../src/i18n/stringsResLint";
import { minimalProject } from "./fixtures";

describe("RTL codegen and strings (RTL2/RTL6/RTL8)", () => {
    it("resolves text direction from localeMeta then inferred locale id", () => {
        const strings = parseStringsResSource(
            JSON.stringify({
                defaultLocale: "en",
                localeMeta: { fa: { direction: "rtl" } },
                locales: { en: {}, fa: {} }
            })
        );
        expect(resolveTextDirection(strings, "fa", "ltr")).toBe("rtl");
        expect(resolveTextDirection(strings, "en", "ltr")).toBe("ltr");
        expect(resolveTextDirection(strings, "en", "rtl")).toBe("rtl");
        expect(resolveTextDirection(strings, "ar", "ltr")).toBe("rtl");
    });

    it("emits base_dir and bidi lv_conf hints when strings.res is linked", () => {
        const p = minimalProject();
        (p.project as { stringsPath?: string }).stringsPath = "strings.res";
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "embf-rtl-"));
        const embfPath = path.join(tmp, "demo.embf");
        const resPath = path.join(tmp, "strings.res");
        fs.writeFileSync(
            resPath,
            JSON.stringify({
                defaultLocale: "en",
                localeMeta: { fa: { direction: "rtl" } },
                locales: { en: { title: "Hi" }, fa: { title: "سلام" } }
            })
        );
        const result = generateCode(p, embfPath, path.join(tmp, "out"));
        const mainC = result.files.get(path.join(tmp, "out", "ui_page_main.c")) ?? "";
        expect(mainC).toContain("lv_obj_set_style_base_dir");
        expect(mainC).toContain("LV_BASE_DIR_LTR");
        expect(mainC).not.toContain("ui_resolve_base_dir()");
        const stringsC = result.files.get(path.join(tmp, "out", "ui_strings.c")) ?? "";
        expect(stringsC).toContain("ui_apply_text_direction");
        expect(stringsC).toContain("ui_refresh_localized_text");
        const refreshC = result.files.get(path.join(tmp, "out", "ui_strings_refresh.c")) ?? "";
        expect(refreshC).toContain("ui_font_montserrat_nearest");
        expect(refreshC).not.toContain("ui_font_montserrat_plain(font_px)");
        expect(refreshC).toContain("ui_apply_localized_label_style");
        expect(stringsC).toContain("lv_async_call(ui_locale_apply_async_cb, NULL)");
        expect(result.files.has(path.join(tmp, "out", "ui_rtl_fonts.h"))).toBe(true);
        expect(result.files.get(path.join(tmp, "out", "ui_rtl_fonts.h"))).toContain("UI_FONT_BIDI");
        expect(result.files.get(path.join(tmp, "out", "ui_rtl_fonts.h"))).toContain("lv_font_dejavu_16_persian_hebrew");
        expect(result.files.has(path.join(tmp, "out", "ui_rtl_fonts.c"))).toBe(true);
        expect(result.files.get(path.join(tmp, "out", "ui_rtl_fonts.c"))).toContain("ui_rtl_fonts_init");
        expect(result.files.get(path.join(tmp, "out", "ui_rtl_fonts.c"))).toContain("embf_font_latin1_14");
        expect(result.files.get(path.join(tmp, "out", "ui_rtl_fonts.c"))).toContain("ui_f_latin_14.fallback = &lv_font_dejavu_16_persian_hebrew");
        expect(result.files.get(path.join(tmp, "out", "ui_rtl_fonts.c"))).toContain("ui_f_ms_14.fallback = &ui_f_latin_14");
        expect(result.files.has(path.join(tmp, "out", "embf_font_latin1_14.c"))).toBe(true);
        expect(result.files.get(path.join(tmp, "out", "embf_font_latin1_14.c"))).toContain('#include "lvgl/lvgl.h"');
        const uiC = result.files.get(path.join(tmp, "out", "ui.c")) ?? "";
        expect(uiC).toContain("ui_font_montserrat_nearest(14)");
        expect(uiC).toContain("ui_rtl_fonts_init()");
        expect(uiC).not.toContain("ui_rtl_fonts_init(); /* duplicate");
        const strings = parseStringsResSource(fs.readFileSync(resPath, "utf8"));
        const lvConf = generateLvConf(p, strings);
        expect(lvConf).toContain("LV_USE_BIDI  1");
        expect(lvConf).toContain("LV_USE_ARABIC_PERSIAN_CHARS  1");
    });

    it("omits RTL lv_conf when project is LTR-only", () => {
        const p = minimalProject();
        const strings = parseStringsResSource(
            JSON.stringify({
                defaultLocale: "en",
                locales: { en: { title: "Hi" }, de: { title: "Hallo" } }
            })
        );
        const lvConf = generateLvConf(p, strings);
        expect(lvConf).toContain("LV_USE_BIDI  0");
        expect(lvConf).toContain("LV_USE_ARABIC_PERSIAN_CHARS  0");
        expect(lvConf).toContain("LV_FONT_DEJAVU_16_PERSIAN_HEBREW  0");
    });

    it("omits direction helpers from strings codegen when LTR-only", () => {
        const p = minimalProject();
        const strings = parseStringsResSource(
            JSON.stringify({
                defaultLocale: "en",
                locales: { en: { title: "Hi" } }
            })
        );
        const bundle = generateStringsCodegen(p, strings, false);
        expect(bundle?.header).not.toContain("ui_resolve_base_dir");
        expect(bundle?.source).not.toContain("ui_apply_text_direction");
    });

    it("lint warns for RTL locales (RTL8)", () => {
        const p = minimalProject();
        const strings = parseStringsResSource(
            JSON.stringify({
                defaultLocale: "en",
                locales: { en: { t: "Hi" }, fa: { t: "سلام" } }
            })
        );
        const issues = lintStringResourceRefs(p, strings);
        expect(issues.some(i => i.message.includes("RTL8"))).toBe(true);
    });
});
