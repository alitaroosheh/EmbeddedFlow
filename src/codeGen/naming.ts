/**
 * Naming conventions for generated C symbols.
 *
 * All public symbols follow:  ui_<page>_<widget>
 * Screen variables:           ui_<page>
 * Style variables:            ui_style_<style_id>
 */

const C_RESERVED = new Set([
    "auto","break","case","char","const","continue","default","do","double",
    "else","enum","extern","float","for","goto","if","inline","int","long",
    "register","restrict","return","short","signed","sizeof","static","struct",
    "switch","typedef","union","unsigned","void","volatile","while",
    "_Bool","_Complex","_Imaginary"
]);

/** Convert an arbitrary string to a valid C identifier (snake_case). */
export function toIdentifier(raw: string): string {
    let s = raw
        .replace(/[^a-zA-Z0-9_]/g, "_")  // replace illegal chars
        .replace(/^([0-9])/, "_$1");       // can't start with digit

    if (C_RESERVED.has(s)) {
        s = "_" + s;
    }

    return s || "_unnamed";
}

/** Screen/page variable: `ui_<page_id>` */
export function screenVar(pageId: string): string {
    return `ui_${toIdentifier(pageId)}`;
}

/** Widget variable inside a page: `ui_<page_id>_<widget_id>` */
export function widgetVar(pageId: string, widgetId: string): string {
    return `ui_${toIdentifier(pageId)}_${toIdentifier(widgetId)}`;
}

/** Per-page create function name: `ui_<page_id>_screen_init` */
export function screenInitFn(pageId: string): string {
    return `ui_${toIdentifier(pageId)}_screen_init`;
}

/** Header guard macro: `UI_<PAGE_ID>_H` */
export function headerGuard(pageId: string): string {
    return `UI_${toIdentifier(pageId).toUpperCase()}_H`;
}

/** Style variable: `ui_style_<style_id>` */
export function styleVar(styleId: string): string {
    return `ui_style_${toIdentifier(styleId)}`;
}
