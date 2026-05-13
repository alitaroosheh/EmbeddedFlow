import type { EmbfProject, Page, Component, EventDef, Action } from "../types/embf";
import { widgetVar, screenVar, toIdentifier } from "./naming";

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
    evtDef: EventDef
): { decl: string; impl: string; registration: string } {
    const v9     = project.project.lvglVersion.startsWith("9");
    const cbName = eventCbName(page.id, comp.id, evtDef.trigger);
    const objVar = widgetVar(page.id, comp.id);

    const actionLines = evtDef.actions.map(a => emitAction(project, page, a, v9));

    const impl = [
        `static void ${cbName}(lv_event_t *e)`,
        `{`,
        `    lv_event_code_t code = lv_event_get_code(e);`,
        `    if (code == ${lvEventCode(evtDef.trigger)}) {`,
        ...actionLines.map(l => `        ${l}`),
        `    }`,
        `}`,
    ].join("\n");

    const decl = `static void ${cbName}(lv_event_t *e);`;

    const registration = `    lv_obj_add_event_cb(${objVar}, ${cbName}, ${lvEventCode(evtDef.trigger)}, NULL);`;

    return { decl, impl, registration };
}

/** Emit one action as a C statement (no leading indent). */
function emitAction(project: EmbfProject, page: Page, action: Action, v9: boolean): string {
    switch (action.type) {
        case "navigate": {
            const targetPage = project.pages.find(p => p.id === action.target);
            if (!targetPage) {
                return `/* navigate: page "${action.target}" not found */`;
            }
            const loadFn = v9 ? "lv_screen_load" : "lv_scr_load";
            return `${loadFn}(${screenVar(action.target)});`;
        }
        case "set_text": {
            // Escape the string
            const escaped = action.text
                .replace(/\\/g, "\\\\")
                .replace(/"/g, '\\"')
                .replace(/\n/g, "\\n");
            return `lv_label_set_text(${widgetVar(page.id, action.target)}, "${escaped}");`;
        }
        case "set_value":
            // Component type determines the correct setter.
            // We emit all three guarded by a NULL check since only one will match.
            return `lv_obj_check_type(${widgetVar(page.id, action.target)}, &lv_slider_class)` +
                   ` ? lv_slider_set_value(${widgetVar(page.id, action.target)}, ${action.value}, LV_ANIM_OFF)` +
                   ` : lv_obj_check_type(${widgetVar(page.id, action.target)}, &lv_arc_class)` +
                   ` ? lv_arc_set_value(${widgetVar(page.id, action.target)}, ${action.value})` +
                   ` : lv_bar_set_value(${widgetVar(page.id, action.target)}, ${action.value}, LV_ANIM_OFF);`;
        case "set_checked": {
            const stateCall = action.checked
                ? `lv_obj_add_state(${widgetVar(page.id, action.target)}, LV_STATE_CHECKED);`
                : `lv_obj_remove_state(${widgetVar(page.id, action.target)}, LV_STATE_CHECKED);`;
            return stateCall;
        }
        case "set_hidden": {
            return action.hidden
                ? `lv_obj_add_flag(${widgetVar(page.id, action.target)}, LV_OBJ_FLAG_HIDDEN);`
                : `lv_obj_remove_flag(${widgetVar(page.id, action.target)}, LV_OBJ_FLAG_HIDDEN);`;
        }
        default:
            return `/* unsupported action: ${(action as any).type} */`;
    }
}

/**
 * Collect all event callback data for a page.
 * Returns arrays of decls, impls, and registration lines.
 */
export function collectPageEvents(project: EmbfProject, page: Page): {
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
                const { decl, impl, registration } = emitEventCallback(project, page, comp, evtDef);
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
