import type {
    EmbfProject,
    Page,
    Component,
    EventDef,
    Action,
    NavigateAction,
    NavPushAction,
    NavReplaceAction,
    NavResetAction,
    PageSwipeFlow,
    DataField
} from "../types/embf";
import { widgetVar, screenVar, toIdentifier } from "./naming";
import { screenLoadAnimCConstant } from "./screenLoadAnim";
import { dataSetterName } from "./bindingsGen";
import { emitWidgetTextExpr } from "./stringsGen";
import { getWidgetTextRef } from "../i18n/widgetText";
import { emitNavStackAction } from "./navStackGen";

const BINDING_RE = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;

/** Name for the event callback function of a component+trigger. */
export function eventCbName(pageId: string, compId: string, trigger: string): string {
    return `ui_${toIdentifier(pageId)}_${toIdentifier(compId)}_on_${toIdentifier(trigger)}`;
}

/** LVGL event code constant for a trigger string. */
function lvEventCode(trigger: string): string {
    switch (trigger) {
        case "clicked":       return "LV_EVENT_CLICKED";
        case "long_pressed":  return "LV_EVENT_LONG_PRESSED";
        case "value_changed": return "LV_EVENT_VALUE_CHANGED";
        default:              return "LV_EVENT_CLICKED";
    }
}

/**
 * Emit one event callback function body + its registration call.
 *
 * @returns { decl, impl, registration }
 *   decl:         forward declaration (for the page header)
 *   impl:         full function body (for the page source)
 *   registration: lv_obj_add_event_cb call (inside page init function)
 */
export function emitEventCallback(
    project: EmbfProject,
    page: Page,
    comp: Component,
    evtDef: EventDef,
    stringsApi = false
): { decl: string; impl: string; registration: string } {
    const v9     = project.project.lvglVersion.startsWith("9");
    const cbName = eventCbName(page.id, comp.id, evtDef.trigger);
    const objVar = widgetVar(page.id, comp.id);

    const actionLines = evtDef.actions.map(a => emitAction(project, page, a, v9, stringsApi));
    /* ui_set_*() already calls ui_bindings_apply(); a second apply after every click
     * can corrupt partial-framebuffer displays (green flash / blank labels). */
    const needsBindingsRefresh =
        (project.dataModel?.fields?.length ?? 0) > 0 &&
        evtDef.actions.some(a => actionNeedsBindingsApply(project, page, a));

    const impl = [
        `static void ${cbName}(lv_event_t *e)`,
        `{`,
        `    lv_event_code_t code = lv_event_get_code(e);`,
        `    if (code == ${lvEventCode(evtDef.trigger)}) {`,
        ...actionLines.map(l => `        ${l}`),
        ...(needsBindingsRefresh ? [`        ui_bindings_apply();`] : []),
        `    }`,
        `}`,
    ].join("\n");

    const decl = `static void ${cbName}(lv_event_t *e);`;

    const registration = `    lv_obj_add_event_cb(${objVar}, ${cbName}, ${lvEventCode(evtDef.trigger)}, NULL);`;

    return { decl, impl, registration };
}

/** Emit C to load another page (instant or animated). */
export function emitNavigateStatement(
    project: EmbfProject,
    nav: Pick<NavigateAction, "target" | "anim" | "time" | "delay" | "autoDel"> | PageSwipeFlow,
    v9: boolean
): string {
    const targetPage = project.pages.find(p => p.id === nav.target);
    if (!targetPage) {
        return `/* navigate: page "${nav.target}" not found */`;
    }
    const scr = screenVar(nav.target);
    const anim = nav.anim ?? "none";
    if (anim === "none") {
        const loadFn = v9 ? "lv_screen_load" : "lv_scr_load";
        const load = `${loadFn}(${scr});`;
        if ((project.dataModel?.fields?.length ?? 0) > 0) {
            return `{ ${load} ui_bindings_apply(); }`;
        }
        return load;
    }
    const time = Math.max(0, Math.round(nav.time ?? 300));
    const delay = Math.max(0, Math.round(nav.delay ?? 0));
    const autoDel = nav.autoDel ? "true" : "false";
    const lvAnim = screenLoadAnimCConstant(anim, v9);
    const loadAnimFn = v9 ? "lv_screen_load_anim" : "lv_scr_load_anim";
    const load = `${loadAnimFn}(${scr}, ${lvAnim}, ${time}, ${delay}, ${autoDel});`;
    if ((project.dataModel?.fields?.length ?? 0) > 0) {
        return `{ ${load} ui_bindings_apply(); }`;
    }
    return load;
}

function actionNeedsBindingsApply(project: EmbfProject, page: Page, action: Action): boolean {
    switch (action.type) {
        case "navigate":
            return true;
        case "set_hidden":
        case "set_checked":
        case "set_theme":
            return false;
        case "set_value": {
            const comp = findComponentOnPage(page, action.target);
            const bindField = (comp as { bindings?: { value?: string } } | null)?.bindings?.value;
            if (
                typeof bindField === "string" &&
                project.dataModel?.fields?.some(
                    f => f.id === bindField && (f.type === "int" || f.type === "float")
                )
            ) {
                return false;
            }
            return true;
        }
        case "set_text": {
            const comp = findComponentOnPage(page, action.target);
            if (comp?.type === "label" && typeof comp.text === "string") {
                const fieldId = singleBindingFieldInLabel(comp.text);
                if (fieldId && project.dataModel?.fields?.some(f => f.id === fieldId)) {
                    return false;
                }
            }
            return true;
        }
        default:
            return false;
    }
}

function findComponentOnPage(page: Page, componentId: string): Component | null {
    function walk(comps: Component[]): Component | null {
        for (const c of comps) {
            if (c.id === componentId) {
                return c;
            }
            const ch = (c as { children?: Component[] }).children;
            if (Array.isArray(ch)) {
                const inner = walk(ch);
                if (inner) {
                    return inner;
                }
            }
        }
        return null;
    }
    return walk(page.components);
}

function singleBindingFieldInLabel(text: string): string | null {
    const fields: string[] = [];
    let m: RegExpExecArray | null;
    const re = new RegExp(BINDING_RE.source, "g");
    while ((m = re.exec(text)) !== null) {
        if (!fields.includes(m[1])) {
            fields.push(m[1]);
        }
    }
    if (fields.length !== 1) {
        return null;
    }
    const trimmed = text.replace(/\s/g, "");
    const expected = `{{${fields[0]}}}`;
    return trimmed === expected ? fields[0] : null;
}

function emitDataSetterForNumeric(field: DataField, value: number): string {
    if (field.type === "float") {
        const n = Number(value);
        return `${dataSetterName(field.id)}(${Number.isInteger(n) ? `${n}.0f` : `${n}f`});`;
    }
    return `${dataSetterName(field.id)}(${Math.round(value)});`;
}

function emitDataSetterForText(field: DataField, text: string): string | null {
    switch (field.type) {
        case "string":
            return `${dataSetterName(field.id)}("${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}");`;
        case "int": {
            const n = Number.parseInt(text, 10);
            if (!Number.isFinite(n)) {
                return null;
            }
            return `${dataSetterName(field.id)}(${n});`;
        }
        case "float": {
            const n = Number.parseFloat(text);
            if (!Number.isFinite(n)) {
                return null;
            }
            return emitDataSetterForNumeric(field, n);
        }
        case "bool": {
            const low = text.trim().toLowerCase();
            if (low === "true" || low === "1") {
                return `${dataSetterName(field.id)}(true);`;
            }
            if (low === "false" || low === "0") {
                return `${dataSetterName(field.id)}(false);`;
            }
            return null;
        }
    }
}

function emitWidgetSetValue(page: Page, targetId: string, value: number): string {
    const wv = widgetVar(page.id, targetId);
    const comp = findComponentOnPage(page, targetId);
    if (!comp) {
        return `/* set_value: widget "${targetId}" not found */`;
    }
    switch (comp.type) {
        case "slider":
            return `lv_slider_set_value(${wv}, ${Math.round(value)}, LV_ANIM_OFF);`;
        case "bar":
            return `lv_bar_set_value(${wv}, ${Math.round(value)}, LV_ANIM_OFF);`;
        case "arc":
        case "knob":
            return `lv_arc_set_value(${wv}, ${Math.round(value)});`;
        default:
            return `/* set_value: "${targetId}" is type "${comp.type}", not numeric */`;
    }
}

/** Emit one action as a C statement (no leading indent). */
function emitAction(
    project: EmbfProject,
    page: Page,
    action: Action,
    v9: boolean,
    stringsApi = false
): string {
    switch (action.type) {
        case "navigate":
            return emitNavigateStatement(project, action as NavigateAction, v9);
        case "nav_push":
            return emitNavStackAction(action as NavPushAction, v9);
        case "nav_pop":
            return emitNavStackAction(action, v9);
        case "nav_replace":
            return emitNavStackAction(action as NavReplaceAction, v9);
        case "nav_reset":
            return emitNavStackAction(action as NavResetAction, v9);
        case "set_text": {
            const comp = findComponentOnPage(page, action.target);
            const fieldId =
                comp?.type === "label" && typeof comp.text === "string"
                    ? singleBindingFieldInLabel(comp.text)
                    : null;
            if (fieldId && typeof action.text === "string") {
                const field = project.dataModel?.fields?.find(f => f.id === fieldId);
                if (field) {
                    const setter = emitDataSetterForText(field, action.text);
                    if (setter) {
                        return setter;
                    }
                }
            }
            const textExpr = emitSetTextArg(action.text, stringsApi);
            if (comp?.type === "button") {
                const wv = widgetVar(page.id, action.target);
                return `lv_label_set_text(lv_obj_get_child(${wv}, 0), ${textExpr});`;
            }
            return `lv_label_set_text(${widgetVar(page.id, action.target)}, ${textExpr});`;
        }
        case "set_value": {
            const comp = findComponentOnPage(page, action.target);
            const bindField = (comp as { bindings?: { value?: string } } | null)?.bindings?.value;
            if (typeof bindField === "string") {
                const field = project.dataModel?.fields?.find(f => f.id === bindField);
                if (field && (field.type === "int" || field.type === "float")) {
                    return emitDataSetterForNumeric(field, action.value);
                }
            }
            return emitWidgetSetValue(page, action.target, action.value);
        }
        case "set_checked": {
            const comp = findComponentOnPage(page, action.target);
            const wv = widgetVar(page.id, action.target);
            const on = action.checked;
            switch (comp?.type) {
                case "switch":
                    return on
                        ? `lv_obj_add_state(${wv}, LV_STATE_CHECKED);`
                        : `lv_obj_remove_state(${wv}, LV_STATE_CHECKED);`;
                case "checkbox":
                    return on
                        ? `lv_obj_add_state(${wv}, LV_STATE_CHECKED);`
                        : `lv_obj_remove_state(${wv}, LV_STATE_CHECKED);`;
                default:
                    return on
                        ? `lv_obj_add_state(${wv}, LV_STATE_CHECKED);`
                        : `lv_obj_remove_state(${wv}, LV_STATE_CHECKED);`;
            }
        }
        case "set_hidden": {
            return action.hidden
                ? `lv_obj_add_flag(${widgetVar(page.id, action.target)}, LV_OBJ_FLAG_HIDDEN);`
                : `lv_obj_remove_flag(${widgetVar(page.id, action.target)}, LV_OBJ_FLAG_HIDDEN);`;
        }
        case "set_theme": {
            const primary = themePrimaryColorExpr(project);
            const secondary = themeSecondaryColorExpr(project);
            const darkExpr =
                "dark" in action
                    ? action.dark ? "true" : "false"
                    : "lv_obj_has_state(lv_event_get_target_obj(e), LV_STATE_CHECKED)";
            if (v9) {
                return `{ lv_theme_t *t = lv_theme_default_init(lv_display_get_default(), ${primary}, ${secondary}, ${darkExpr}, LV_FONT_DEFAULT); lv_display_set_theme(lv_display_get_default(), t); lv_obj_invalidate(lv_screen_active()); }`;
            }
            return `{ lv_theme_t *t = lv_theme_default_init(lv_disp_get_default(), ${primary}, ${secondary}, ${darkExpr}, LV_FONT_DEFAULT); lv_disp_set_theme(lv_disp_get_default(), t); lv_obj_invalidate(lv_scr_act()); }`;
        }
        case "set_locale": {
            const loc = action.locale.trim().replace(/\\/g, "\\\\").replace(/"/g, '\\"');
            if (stringsApi) {
                return `{ ui_set_locale("${loc}"); ui_refresh_localized_text(); }`;
            }
            return `/* set_locale "${loc}": string resources not linked — add strings.res and regenerate */`;
        }
        default:
            return `/* unsupported action: ${(action as any).type} */`;
    }
}

function emitSetTextArg(text: import("../types/embf").WidgetTextValue, stringsApi: boolean): string {
    return emitWidgetTextExpr(text, stringsApi);
}

/**
 * Collect all event callback data for a page.
 * Returns arrays of decls, impls, and registration lines.
 */
export function collectPageEvents(
    project: EmbfProject,
    page: Page,
    stringsApi = false
): {
    decls: string[];
    impls: string[];
    registrations: string[];
} {
    const decls: string[] = [];
    const impls: string[] = [];
    const registrations: string[] = [];

    function walk(comps: Component[]): void {
        for (const comp of comps) {
            for (const evtDef of comp.events ?? []) {
                const { decl, impl, registration } = emitEventCallback(
                    project,
                    page,
                    comp,
                    evtDef,
                    stringsApi
                );
                decls.push(decl);
                impls.push(impl);
                registrations.push(registration);
            }
            if ("children" in comp && Array.isArray((comp as any).children)) {
                walk((comp as any).children);
            }
        }
    }

    walk(page.components);
    return { decls, impls, registrations };
}

function themePrimaryColorExpr(project: EmbfProject): string {
    const c = project.theme?.primaryColor;
    return c ? `lv_color_hex(0x${hexToRaw(c)})` : "lv_palette_main(LV_PALETTE_BLUE)";
}

function themeSecondaryColorExpr(project: EmbfProject): string {
    const c = project.theme?.secondaryColor;
    return c ? `lv_color_hex(0x${hexToRaw(c)})` : "lv_palette_main(LV_PALETTE_CYAN)";
}

function hexToRaw(hex: string): string {
    const h = hex.replace("#", "").toUpperCase();
    if (h.length === 3) {
        return h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    }
    return h.slice(0, 6).padStart(6, "0");
}
