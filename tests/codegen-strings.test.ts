import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { describe, expect, it } from "vitest";
import { generateCode } from "../src/codeGen/index";
import { generateStringsCodegen, stringKeyToEnumSymbol } from "../src/codeGen/stringsGen";
import { parseEmbfSource } from "../src/embfParser";
import { writeStringsResFileAtomic, defaultStringsResFile } from "../src/i18n/stringsResWrite";
import { minimalProject } from "./fixtures";

describe("strings X-Macro codegen (I18n9–11)", () => {
    it("emits ui_strings_ids.h, locale .def files, ui_strings.h, ui_strings.c", () => {
        const raw = minimalProject();
        raw.pages[0].components.push({
            id: "lbl_title",
            type: "label",
            x: 0,
            y: 0,
            width: 120,
            height: 24,
            text: { ref: "app_title" }
        });
        const project = parseEmbfSource(JSON.stringify(raw));
        const strings = {
            defaultLocale: "en",
            locales: {
                en: { app_title: "Hello" },
                de: { app_title: "Hallo" }
            }
        };
        const bundle = generateStringsCodegen(project, strings);
        expect(bundle).not.toBeNull();
        expect(bundle!.idsHeader).toContain("UI_STR_APP_TITLE");
        expect(bundle!.idsHeader).toContain("#define UI_STRING_KEYS");
        expect(bundle!.header).toContain("ui_string_id_t");
        expect(bundle!.header).toContain("ui_get_string");
        expect(bundle!.header).toContain("ui_set_locale");
        expect(bundle!.source).toContain("ui_strings_table_en");
        expect(bundle!.source).toContain("ui_strings_table_de");
        expect(bundle!.refreshSource).toContain("ui_refresh_localized_text");
        expect(bundle!.localeDefs.get("en")).toContain('X(UI_STR_APP_TITLE, "Hello")');
        expect(bundle!.localeDefs.get("de")).toContain('X(UI_STR_APP_TITLE, "Hallo")');
    });

    it("generateCode writes string resource files when .res exists", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "embf-codegen-i18n-"));
        const embfPath = path.join(dir, "demo.embf");
        const raw = minimalProject();
        raw.pages[0].components.push({
            id: "lbl1",
            type: "label",
            x: 0,
            y: 0,
            width: 80,
            height: 20,
            text: { ref: "greeting" }
        });
        fs.writeFileSync(embfPath, JSON.stringify(raw, null, 2), "utf8");
        const res = defaultStringsResFile();
        res.locales.en.greeting = "Hi";
        res.locales.de = { greeting: "Hallo" };
        writeStringsResFileAtomic(path.join(dir, "strings.res"), res);

        const outDir = path.join(dir, "ui_out");
        const result = generateCode(parseEmbfSource(JSON.stringify(raw)), embfPath, outDir);
        expect(result.files.has(path.join(outDir, "ui_strings.h"))).toBe(true);
        expect(result.files.has(path.join(outDir, "ui_strings.c"))).toBe(true);
        expect(result.files.has(path.join(outDir, "ui_strings_en.def"))).toBe(true);
        expect(result.files.has(path.join(outDir, "ui_strings_de.def"))).toBe(true);

        const pageC = result.files.get(path.join(outDir, "ui_page_main.c")) ?? "";
        expect(pageC).toContain("ui_get_string(UI_STR_GREETING)");
        const uiH = result.files.get(path.join(outDir, "ui.h")) ?? "";
        expect(uiH).toContain('#include "ui_strings.h"');
    });
});

describe("widget / action string refs (I18n10, I18n12)", () => {
    it("maps resource keys to UI_STR_* enum symbols", () => {
        expect(stringKeyToEnumSymbol("app_title")).toBe("UI_STR_APP_TITLE");
        expect(stringKeyToEnumSymbol("temp_label")).toBe("UI_STR_TEMP_LABEL");
    });

    it("set_text action with resource ref emits ui_get_string in event handler", () => {
        const raw = minimalProject();
        raw.pages[0].components.push({
            id: "lbl_status",
            type: "label",
            x: 0,
            y: 0,
            width: 100,
            height: 24,
            text: "Status",
            events: [
                {
                    trigger: "clicked",
                    actions: [{ type: "set_text", target: "lbl_status", text: { ref: "status_ok" } }]
                }
            ]
        });
        const project = parseEmbfSource(JSON.stringify(raw));
        const strings = {
            defaultLocale: "en",
            locales: { en: { status_ok: "OK" } }
        };
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "embf-set-text-ref-"));
        const embfPath = path.join(dir, "t.embf");
        fs.writeFileSync(embfPath, JSON.stringify(raw), "utf8");
        writeStringsResFileAtomic(path.join(dir, "strings.res"), strings);
        const result = generateCode(project, embfPath, path.join(dir, "out"));
        const pageC = result.files.get(path.join(dir, "out", "ui_page_main.c")) ?? "";
        expect(pageC).toContain("ui_get_string(UI_STR_STATUS_OK)");
    });

    it("set_locale action emits ui_set_locale and ui_refresh_localized_text", () => {
        const raw = minimalProject();
        raw.pages[0].components.push({
            id: "btn_lang",
            type: "button",
            x: 0,
            y: 0,
            width: 100,
            height: 32,
            label: "DE",
            events: [
                {
                    trigger: "clicked",
                    actions: [{ type: "set_locale", locale: "de" }]
                }
            ]
        });
        const project = parseEmbfSource(JSON.stringify(raw));
        const strings = {
            defaultLocale: "en",
            locales: { en: { greeting: "Hi" }, de: { greeting: "Hallo" } }
        };
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "embf-set-locale-"));
        const embfPath = path.join(dir, "t.embf");
        fs.writeFileSync(embfPath, JSON.stringify(raw), "utf8");
        writeStringsResFileAtomic(path.join(dir, "strings.res"), strings);
        const result = generateCode(project, embfPath, path.join(dir, "out"));
        const pageC = result.files.get(path.join(dir, "out", "ui_page_main.c")) ?? "";
        expect(pageC).toContain('ui_set_locale("de")');
        expect(pageC).toContain("ui_refresh_localized_text()");
    });
});
