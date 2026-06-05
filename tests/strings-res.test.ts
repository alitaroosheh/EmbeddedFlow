import * as os from "os";
import * as path from "path";
import * as fs from "fs";
import { describe, expect, it } from "vitest";
import { EmbfParseError, parseEmbfSource } from "../src/embfParser";
import { applyPageInspectorPatch, applyComponentPatch } from "../src/embfComponentModel";
import {
    DEFAULT_STRINGS_RES_REL_PATH,
    getStringsResRelPath,
    resolveStringsResPath
} from "../src/i18n/stringsResPath";
import { parseStringsResSource } from "../src/i18n/stringsResParser";
import { StringsResParseError } from "../src/i18n/stringsResErrors";
import { lintStringResourceRefs } from "../src/i18n/stringsResLint";
import {
    collectStringRefsInProject,
    resolveWidgetText,
    validateWidgetTextField
} from "../src/i18n/widgetText";
import { serializeStringsRes, writeStringsResFileAtomic, defaultStringsResFile } from "../src/i18n/stringsResWrite";
import { minimalProject } from "./fixtures";

describe("stringsPath (I18n1)", () => {
    it("defaults to strings.res when project.stringsPath is omitted", () => {
        const p = minimalProject();
        expect(getStringsResRelPath(p)).toBe(DEFAULT_STRINGS_RES_REL_PATH);
        const abs = resolveStringsResPath(p, path.join(os.tmpdir(), "app", "demo.embf"));
        expect(abs).toBe(path.join(os.tmpdir(), "app", "strings.res"));
    });

    it("parses project.stringsPath when set to a .res path", () => {
        const raw = minimalProject();
        (raw.project as { stringsPath?: string }).stringsPath = "locales/ui.res";
        const p = parseEmbfSource(JSON.stringify(raw));
        expect(p.project.stringsPath).toBe("locales/ui.res");
        expect(getStringsResRelPath(p)).toBe("locales/ui.res");
    });

    it("rejects project.stringsPath without .res extension", () => {
        const raw = minimalProject();
        (raw.project as { stringsPath?: string }).stringsPath = "i18n/strings.json";
        expect(() => parseEmbfSource(JSON.stringify(raw))).toThrow(EmbfParseError);
        expect(() => parseEmbfSource(JSON.stringify(raw))).toThrow(/\.res/);
    });

    it("persists stringsPath via page inspector patch", () => {
        const p = minimalProject();
        applyPageInspectorPatch(p, 0, { projStringsPath: "translations/app.res" });
        expect(p.project.stringsPath).toBe("translations/app.res");
        applyPageInspectorPatch(p, 0, { projStringsPath: null });
        expect(p.project.stringsPath).toBeUndefined();
    });
});

describe("strings.res parse (I18n2)", () => {
    const sample = {
        defaultLocale: "en",
        locales: {
            en: {
                temp_label: "Temperature",
                settings_title: "Settings"
            },
            fa: {
                temp_label: "دما",
                settings_title: "تنظیمات"
            }
        }
    };

    it("accepts a valid .res document", () => {
        const doc = parseStringsResSource(JSON.stringify(sample));
        expect(doc.defaultLocale).toBe("en");
        expect(doc.locales.en.temp_label).toBe("Temperature");
        expect(doc.locales.fa.settings_title).toBe("تنظیمات");
    });

    it("rejects missing defaultLocale in locales", () => {
        const bad = { ...sample, defaultLocale: "de" };
        expect(() => parseStringsResSource(JSON.stringify(bad))).toThrow(StringsResParseError);
    });

    it("rejects non-string translation values", () => {
        const bad = {
            defaultLocale: "en",
            locales: { en: { key: 42 } }
        };
        expect(() => parseStringsResSource(JSON.stringify(bad))).toThrow(StringsResParseError);
    });

    it("parses localeMeta direction (RTL1)", () => {
        const doc = parseStringsResSource(
            JSON.stringify({
                defaultLocale: "en",
                localeMeta: { fa: { direction: "rtl" }, en: { direction: "ltr" } },
                locales: { en: { k: "Hi" }, fa: { k: "سلام" } }
            })
        );
        expect(doc.localeMeta?.fa?.direction).toBe("rtl");
        expect(doc.localeMeta?.en?.direction).toBe("ltr");
    });

    it("rejects invalid localeMeta direction", () => {
        expect(() =>
            parseStringsResSource(
                JSON.stringify({
                    defaultLocale: "en",
                    localeMeta: { fa: { direction: "vertical" } },
                    locales: { en: {}, fa: {} }
                })
            )
        ).toThrow(StringsResParseError);
    });
});

describe("widget text refs (I18n6/I18n7)", () => {
    it("parses label text as string resource ref", () => {
        const raw = minimalProject();
        raw.pages[0].components.push({
            id: "lbl1",
            type: "label",
            x: 0,
            y: 0,
            width: 100,
            height: 24,
            text: { ref: "hello_world" }
        });
        const p = parseEmbfSource(JSON.stringify(raw));
        const lbl = p.pages[0].components.find(c => c.id === "lbl1");
        expect(lbl?.type).toBe("label");
        if (lbl?.type === "label") {
            expect(lbl.text).toEqual({ ref: "hello_world" });
        }
    });

    it("rejects invalid resource ref keys", () => {
        expect(() => validateWidgetTextField({ ref: "bad-key" }, "pages[0].lbl.text")).toThrow(
            EmbfParseError
        );
    });

    it("resolves preview text via defaultLocale then key id", () => {
        const strings = parseStringsResSource(
            JSON.stringify({
                defaultLocale: "en",
                locales: { en: { title: "Hello" }, de: { title: "Hallo" } }
            })
        );
        expect(resolveWidgetText({ ref: "title" }, strings)).toBe("Hello");
        expect(resolveWidgetText({ ref: "missing" }, strings)).toBe("missing");
        expect(resolveWidgetText("literal", strings)).toBe("literal");
    });

    it("patches widget text ref via inspector patch", () => {
        const p = minimalProject();
        p.pages[0].components.push({
            id: "btn1",
            type: "button",
            x: 0,
            y: 0,
            width: 80,
            height: 32,
            label: "OK"
        });
        const btn = p.pages[0].components.find(c => c.id === "btn1");
        applyComponentPatch(btn!, { label: { ref: "btn_ok" } });
        const btnAfter = p.pages[0].components.find(c => c.id === "btn1");
        expect(btnAfter?.type).toBe("button");
        if (btnAfter?.type === "button") {
            expect(btnAfter.label).toEqual({ ref: "btn_ok" });
        }
    });

    it("lints missing string resource keys", () => {
        const p = minimalProject();
        p.pages[0].components.push({
            id: "lbl1",
            type: "label",
            x: 0,
            y: 0,
            width: 100,
            height: 24,
            text: { ref: "unknown_key" }
        });
        const refs = collectStringRefsInProject(p);
        expect(refs).toHaveLength(1);
        const issues = lintStringResourceRefs(p, null);
        expect(issues.length).toBeGreaterThan(0);
        expect(issues[0].message).toMatch(/unknown_key/);
    });
});

describe("strings.res atomic write (I18n5)", () => {
    it("writes valid JSON atomically", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "embf-res-"));
        const file = path.join(dir, "strings.res");
        const data = defaultStringsResFile();
        data.locales.en.greeting = "Hi";
        writeStringsResFileAtomic(file, data);
        const parsed = parseStringsResSource(fs.readFileSync(file, "utf8"));
        expect(parsed.locales.en.greeting).toBe("Hi");
        expect(serializeStringsRes(parsed).endsWith("\n")).toBe(true);
    });
});
