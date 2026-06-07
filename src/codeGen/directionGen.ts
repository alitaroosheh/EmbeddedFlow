import type { EmbfProject, TextDirection } from "../types/embf";
import type { StringsResFile } from "../i18n/stringsResParser";
import { RTL_LOCALE_IDS, resolveTextDirection } from "../i18n/textDirection";
/** C base-dir constant for resolved direction. */
export function baseDirCConstant(dir: TextDirection): string {
    return dir === "rtl" ? "LV_BASE_DIR_RTL" : "LV_BASE_DIR_LTR";
}

/** Lines emitted at page screen creation — layout stays LTR; RTL applies to text widgets only. */
export function emitPageInitBaseDir(scrVar: string): string {
    return `    lv_obj_set_style_base_dir(${scrVar}, LV_BASE_DIR_LTR, LV_PART_MAIN);`;
}

function escapeCString(text: string): string {
    return text.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/** Extra C for ui_strings: resolve direction + apply to all screens. */
export function emitDirectionHelpers(project: EmbfProject, strings: StringsResFile): string[] {
    const defaultDir = resolveTextDirection(strings, strings.defaultLocale, project.display.direction);
    const localeIds = Object.keys(strings.locales).sort();

    const metaEntries: string[] = [];
    for (const loc of localeIds) {
        const explicit = strings.localeMeta?.[loc]?.direction;
        if (explicit === "ltr" || explicit === "rtl") {
            metaEntries.push(
                `    { "${escapeCString(loc)}", ${explicit === "rtl" ? 1 : 0} }`
            );
        }
    }

    const rtlBases = [...RTL_LOCALE_IDS].sort();

    const metaBlock =        metaEntries.length > 0
            ? [
                  `typedef struct {`,
                  `    const char *id;`,
                  `    int rtl; /* 1 = rtl, 0 = ltr */`,
                  `} ui_locale_dir_entry_t;`,
                  ``,
                  `static const ui_locale_dir_entry_t ui_locale_dir_meta[] = {`,
                  metaEntries.join(",\n"),
                  `};`,
                  ``,
                  `static int ui_locale_meta_is_rtl(const char *locale_id)`,
                  `{`,
                  `    if (!locale_id) return -1;`,
                  `    for (unsigned i = 0; i < sizeof(ui_locale_dir_meta) / sizeof(ui_locale_dir_meta[0]); i++) {`,
                  `        if (strcmp(locale_id, ui_locale_dir_meta[i].id) == 0) {`,
                  `            return ui_locale_dir_meta[i].rtl;`,
                  `        }`,
                  `    }`,
                  `    return -1;`,
                  `}`,
                  ``
              ]
            : [
                  `static int ui_locale_meta_is_rtl(const char *locale_id)`,
                  `{`,
                  `    (void)locale_id;`,
                  `    return -1;`,
                  `}`,
                  ``
              ];

    const rtlBaseLiterals = rtlBases.map(b => `"${escapeCString(b)}"`).join(", ");

    return [
        ...metaBlock,
        `static int ui_locale_id_inferred_rtl(const char *locale_id)`,
        `{`,
        `    if (!locale_id || !locale_id[0]) return 0;`,
        `    static const char *const bases[] = { ${rtlBaseLiterals} };`,
        `    for (unsigned i = 0; i < sizeof(bases) / sizeof(bases[0]); i++) {`,
        `        size_t n = strlen(bases[i]);`,
        `        if (strncmp(locale_id, bases[i], n) != 0) continue;`,
        `        if (locale_id[n] == '\\0' || locale_id[n] == '-' || locale_id[n] == '_') return 1;`,
        `    }`,
        `    return 0;`,
        `}`,
        ``,
        `lv_base_dir_t ui_resolve_base_dir(void)`,
        `{`,
        `    const char *loc = ui_get_active_locale();`,
        `    if (loc && loc[0]) {`,
        `        int meta = ui_locale_meta_is_rtl(loc);`,
        `        if (meta >= 0) {`,
        `            return meta ? LV_BASE_DIR_RTL : LV_BASE_DIR_LTR;`,
        `        }`,
        `        if (ui_locale_id_inferred_rtl(loc)) {`,
        `            return LV_BASE_DIR_RTL;`,
        `        }`,
        `    }`,
        `    return ${baseDirCConstant(defaultDir)};`,
        `}`,
        ``,
        `void ui_apply_text_direction(void)`,
        `{`,
        `    /* Absolute-position layouts stay LTR; localized labels get dir in ui_refresh_localized_text(). */`,
        `    ui_refresh_localized_text();`,
        `}`,
        ``
    ];
}

/** Comment block for generated lv_conf.h bidi/font hints (RTL6). */
export function lvConfRtlCommentBlock(): string {
    return [
        `/* RTL / bidi (required when using ar/fa/he locales):`,
        ` *   #define LV_USE_BIDI  1`,
        `/* Required for joined Persian/Arabic letters (not just RTL order). */`,
        ` *   #define LV_USE_ARABIC_PERSIAN_CHARS  1`,
        ` */`
    ].join("\n");
}
