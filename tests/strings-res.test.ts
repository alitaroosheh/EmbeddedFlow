import * as os from "os";
import * as path from "path";
import { describe, expect, it } from "vitest";
import { EmbfParseError, parseEmbfSource } from "../src/embfParser";
import { applyPageInspectorPatch } from "../src/embfComponentModel";
import {
    DEFAULT_STRINGS_RES_REL_PATH,
    getStringsResRelPath,
    resolveStringsResPath
} from "../src/i18n/stringsResPath";
import { parseStringsResSource } from "../src/i18n/stringsResParser";
import { StringsResParseError } from "../src/i18n/stringsResErrors";
import { minimalProject } from "./fixtures";

describe("stringsPath (I18n1)", () => {
    it("defaults to i18n/strings.res when project.stringsPath is omitted", () => {
        const p = minimalProject();
        expect(getStringsResRelPath(p)).toBe(DEFAULT_STRINGS_RES_REL_PATH);
        const abs = resolveStringsResPath(p, path.join(os.tmpdir(), "app", "demo.embf"));
        expect(abs).toBe(path.join(os.tmpdir(), "app", "i18n", "strings.res"));
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
});
