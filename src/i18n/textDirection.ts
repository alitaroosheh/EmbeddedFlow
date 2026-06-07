import type { TextDirection } from "../types/embf";
import type { StringsResFile } from "./stringsResParser";

/** Locale ids commonly written right-to-left. */
export const RTL_LOCALE_IDS = new Set(["ar", "fa", "he", "ur", "ps", "ku", "dv"]);

export function isRtlLocaleId(localeId: string): boolean {
    const base = localeId.split(/[-_]/)[0]?.toLowerCase() ?? localeId.toLowerCase();
    return RTL_LOCALE_IDS.has(base);
}

/** RTL2: active locale → localeMeta → inferred RTL id → display.direction → ltr */
export function resolveTextDirection(
    strings: StringsResFile | null | undefined,
    locale: string | undefined,
    displayDirection: TextDirection | undefined
): TextDirection {
    const loc = (locale ?? strings?.defaultLocale ?? "").trim();
    if (loc && strings?.localeMeta?.[loc]?.direction) {
        return strings.localeMeta[loc].direction;
    }
    if (loc && isRtlLocaleId(loc)) {
        return "rtl";
    }
    if (displayDirection === "rtl" || displayDirection === "ltr") {
        return displayDirection;
    }
    return "ltr";
}

/** True if any code point is in the Arabic script block (covers Persian UI text). */
export function textNeedsArabicScript(text: string): boolean {
    for (const ch of text) {
        const cp = ch.codePointAt(0) ?? 0;
        if (cp >= 0x0600 && cp <= 0x06ff) {
            return true;
        }
        if (cp >= 0xfb50 && cp <= 0xfdff) {
            return true;
        }
        if (cp >= 0xfe70 && cp <= 0xfeff) {
            return true;
        }
    }
    return false;
}

/** True when generated firmware / lv_conf should enable BIDI, Arabic shaping, and DejaVu. */
export function projectNeedsRtl(
    project: { display: { direction?: TextDirection } },
    strings: StringsResFile | null | undefined
): boolean {
    if (project.display.direction === "rtl") {
        return true;
    }
    if (!strings) {
        return false;
    }
    for (const localeId of Object.keys(strings.locales)) {
        if (strings.localeMeta?.[localeId]?.direction === "rtl") {
            return true;
        }
        if (isRtlLocaleId(localeId)) {
            return true;
        }
        const table = strings.locales[localeId] ?? {};
        for (const text of Object.values(table)) {
            if (typeof text === "string" && textNeedsArabicScript(text)) {
                return true;
            }
        }
    }
    return false;
}
