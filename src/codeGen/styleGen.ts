import type { FontDef, StyleProps } from "../types/embf";
import { uiFontLocalizedCall } from "./rtlFontsGen";

/** Optional context passed to {@link emitStyleCalls} for project-aware lookups. */
export interface StyleEmitContext {
    /** Project-declared fonts; enables `fontFamily` → `UI_FONT_*` resolution. */
    fonts?: FontDef[];
    /** When true, use DejaVu Arabic/Persian font for widget text (RTL projects). */
    useRtlFontFallback?: boolean;
}

/**
 * Emit lv_obj_set_style_* calls for a widget's inline styles.
 *
 * @param varName  C variable name of the object (e.g. `ui_main_lbl_title`)
 * @param styles   StyleProps from the .embf component
 * @param indent   leading whitespace string (e.g. "    ")
 * @param selector LVGL part+state selector (default: `LV_PART_MAIN | LV_STATE_DEFAULT`)
 * @param ctx      Optional project context (fonts) for advanced style resolution
 */
export function emitStyleCalls(
    varName: string,
    styles: StyleProps,
    indent: string = "    ",
    selector: string = "LV_PART_MAIN | LV_STATE_DEFAULT",
    ctx?: StyleEmitContext
): string[] {
    const lines: string[] = [];

    const s = (fn: string, ...args: string[]) =>
        `${indent}lv_obj_set_style_${fn}(${varName}, ${args.join(", ")}, ${selector});`;

    // ── Background ──────────────────────────────────────────────────────────
    if (styles.bgColor !== undefined) {
        lines.push(s("bg_color", hexToLvColor(styles.bgColor)));
        lines.push(s("bg_opa", "LV_OPA_COVER"));
    }
    if (styles.indicatorColor !== undefined) {
        const indSel = "LV_PART_INDICATOR | LV_STATE_DEFAULT";
        lines.push(
            `${indent}lv_obj_set_style_bg_color(${varName}, ${hexToLvColor(styles.indicatorColor)}, ${indSel});`,
            `${indent}lv_obj_set_style_bg_opa(${varName}, LV_OPA_COVER, ${indSel});`
        );
    }
    if (styles.bgOpacity !== undefined) {
        lines.push(s("bg_opa", String(Math.round(styles.bgOpacity))));
    }

    // ── Border ──────────────────────────────────────────────────────────────
    if (styles.borderColor !== undefined) {
        lines.push(s("border_color", hexToLvColor(styles.borderColor)));
    }
    if (styles.borderWidth !== undefined) {
        lines.push(s("border_width", String(styles.borderWidth)));
    }
    if (styles.borderRadius !== undefined) {
        lines.push(s("radius", String(styles.borderRadius)));
    }

    // ── Text ────────────────────────────────────────────────────────────────
    if (styles.textColor !== undefined) {
        lines.push(s("text_color", hexToLvColor(styles.textColor)));
    }
    const fontExpr = resolveFontExpr(styles, ctx?.fonts);
    if (fontExpr) {
        lines.push(s("text_font", fontExpr));
    } else if (styles.fontSize !== undefined) {
        lines.push(s("text_font", builtinFont(styles.fontSize, ctx)));
    }
    if (styles.align !== undefined) {
        const alignMap: Record<string, string> = {
            left:   "LV_TEXT_ALIGN_LEFT",
            center: "LV_TEXT_ALIGN_CENTER",
            right:  "LV_TEXT_ALIGN_RIGHT"
        };
        lines.push(s("text_align", alignMap[styles.align] ?? "LV_TEXT_ALIGN_LEFT"));
    }

    // ── Padding ─────────────────────────────────────────────────────────────
    if (styles.padding !== undefined) {
        if (typeof styles.padding === "number") {
            lines.push(s("pad_all", String(styles.padding)));
        } else if (Array.isArray(styles.padding)) {
            const p = styles.padding as number[];
            if (p.length === 2) {
                lines.push(s("pad_top",    String(p[0])));
                lines.push(s("pad_bottom", String(p[0])));
                lines.push(s("pad_left",   String(p[1])));
                lines.push(s("pad_right",  String(p[1])));
            } else if (p.length === 4) {
                lines.push(s("pad_top",    String(p[0])));
                lines.push(s("pad_right",  String(p[1])));
                lines.push(s("pad_bottom", String(p[2])));
                lines.push(s("pad_left",   String(p[3])));
            }
        }
    }

    return lines;
}

/**
 * Convert a CSS hex color (#rgb, #rrggbb, #rrggbbaa) to an lv_color_hex() call.
 * e.g. "#0078d4" → "lv_color_hex(0x0078d4)"
 */
export function hexToLvColor(hex: string): string {
    const h = hex.replace("#", "").toLowerCase();
    let r: number, g: number, b: number;

    if (h.length === 3) {
        r = parseInt(h[0] + h[0], 16);
        g = parseInt(h[1] + h[1], 16);
        b = parseInt(h[2] + h[2], 16);
    } else if (h.length >= 6) {
        r = parseInt(h.slice(0, 2), 16);
        g = parseInt(h.slice(2, 4), 16);
        b = parseInt(h.slice(4, 6), 16);
    } else {
        return "lv_color_hex(0x000000)";
    }

    const packed = (r << 16) | (g << 8) | b;
    return `lv_color_hex(0x${packed.toString(16).padStart(6, "0").toUpperCase()})`;
}

/**
 * Resolve a font expression from `styles.fontFamily` against the project's `fonts[]`.
 * Returns `&<font_symbol>` when the family matches a declared id, otherwise `null`.
 */
function resolveFontExpr(styles: StyleProps, fonts: FontDef[] | undefined): string | null {
    const family = styles.fontFamily?.trim();
    if (!family || !fonts) {
        return null;
    }
    const def = fonts.find(f => f.id === family);
    return def?.name ? `&${def.name}` : null;
}

/**
 * Map a font size (px) to the nearest available Montserrat built-in font.
 * Falls back to `LV_FONT_DEFAULT` for unknown sizes.
 */
export function builtinFont(size: number, ctx?: StyleEmitContext): string {
    const available = [8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32, 34, 36, 38, 40, 42, 44, 46, 48];
    const nearest = available.reduce((prev, cur) =>
        Math.abs(cur - size) < Math.abs(prev - size) ? cur : prev
    );
    if (ctx?.useRtlFontFallback) {
        return uiFontLocalizedCall(size);
    }
    return `&lv_font_montserrat_${nearest}`;
}
