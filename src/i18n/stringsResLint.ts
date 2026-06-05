import type { EmbfProject } from "../types/embf";
import type { EmbfSemanticIssue } from "../embfSemanticLint";
import { collectStringRefsInProject, listAllStringKeys } from "./widgetText";
import type { StringsResFile } from "./stringsResParser";
import { isRtlLocaleId, resolveTextDirection, textNeedsArabicScript } from "./textDirection";

export function lintStringResourceRefs(
    project: EmbfProject,
    strings: StringsResFile | null
): EmbfSemanticIssue[] {
    const issues: EmbfSemanticIssue[] = [];
    const refs = collectStringRefsInProject(project);

    if (strings) {
        for (const localeId of Object.keys(strings.locales)) {
            const dir = resolveTextDirection(strings, localeId, project.display.direction);
            if (dir !== "rtl") {
                continue;
            }
            const table = strings.locales[localeId] ?? {};
            const needsArabicFont = Object.values(table).some(
                v => typeof v === "string" && textNeedsArabicScript(v)
            );
            if (needsArabicFont || isRtlLocaleId(localeId)) {
                issues.push({
                    message: `RTL locale "${localeId}" is active in strings.res — enable LV_USE_BIDI and an Arabic-script font (e.g. lv_font_dejavu_16_persian_hebrew) in lv_conf.h (RTL8)`
                });
            }
        }
    }

    if (!refs.length) {
        return issues;
    }
    if (!strings) {
        for (const r of refs) {
            issues.push({
                message: `String resource "${r.key}" at ${r.path}: strings file not found or invalid`
            });
        }
        return issues;
    }
    const known = new Set(listAllStringKeys(strings));
    for (const r of refs) {
        if (!known.has(r.key)) {
            issues.push({
                message: `String resource key "${r.key}" at ${r.path} is not defined in strings.res (locales: ${Object.keys(strings.locales).join(", ")})`
            });
        }
    }

    return issues;
}
