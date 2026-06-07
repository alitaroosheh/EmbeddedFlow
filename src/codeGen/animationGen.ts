import type { AnimationDef, AnimationEasing, AnimationProperty, Component, Page } from "../types/embf";
import { widgetVar } from "./naming";

/** LVGL setter name and cast for each animatable property. */
const PROPERTY_MAP: Record<AnimationProperty, { setter: string; cast: string }> = {
    x: { setter: "lv_obj_set_x", cast: "lv_anim_exec_xcb_t" },
    y: { setter: "lv_obj_set_y", cast: "lv_anim_exec_xcb_t" },
    width: { setter: "lv_obj_set_width", cast: "lv_anim_exec_xcb_t" },
    height: { setter: "lv_obj_set_height", cast: "lv_anim_exec_xcb_t" },
    opacity: { setter: "ui_anim_opa_cb", cast: "lv_anim_exec_xcb_t" }
};

const EASING_MAP: Record<AnimationEasing, string> = {
    linear: "lv_anim_path_linear",
    ease_in: "lv_anim_path_ease_in",
    ease_out: "lv_anim_path_ease_out",
    ease_in_out: "lv_anim_path_ease_in_out",
    overshoot: "lv_anim_path_overshoot",
    bounce: "lv_anim_path_bounce",
    step: "lv_anim_path_step"
};

/** `true` if any widget in `comps` (recursively) has an opacity animation. */
export function anyOpacityAnimation(comps: { animations?: AnimationDef[]; children?: any[] }[]): boolean {
    for (const c of comps) {
        if (c.animations?.some(a => a.property === "opacity")) {
            return true;
        }
        if (Array.isArray(c.children) && anyOpacityAnimation(c.children)) {
            return true;
        }
    }
    return false;
}

/** Static `ui_anim_opa_cb` helper emitted once per page when opacity animations exist. */
export function emitOpacityHelperLines(): string[] {
    return [
        `static void ui_anim_opa_cb(void *obj, int32_t v)`,
        `{`,
        `    lv_obj_set_style_opa((lv_obj_t *)obj, (lv_opa_t)v, LV_PART_MAIN | LV_STATE_DEFAULT);`,
        `}`,
        ``
    ];
}

/** Emit `lv_anim_t` setup + `lv_anim_start` for each animation on `varName`. */
export function emitAnimationCalls(varName: string, animations: AnimationDef[] | undefined): string[] {
    if (!animations?.length) {
        return [];
    }
    const lines: string[] = [];
    animations.forEach((a, idx) => {
        const aVar = `a_${varName}_${idx}`;
        const map = PROPERTY_MAP[a.property];
        const duration = Math.max(0, Math.round(a.duration ?? 500));
        const delay = a.delay !== undefined ? Math.max(0, Math.round(a.delay)) : null;
        const easing = a.easing ? EASING_MAP[a.easing] : "lv_anim_path_linear";
        const repeat = a.repeat;
        const playback = a.playback === true;

        lines.push(`    {`);
        lines.push(`        lv_anim_t ${aVar};`);
        lines.push(`        lv_anim_init(&${aVar});`);
        lines.push(`        lv_anim_set_var(&${aVar}, ${varName});`);
        lines.push(`        lv_anim_set_exec_cb(&${aVar}, (${map.cast})${map.setter});`);
        lines.push(`        lv_anim_set_values(&${aVar}, ${Math.round(a.from)}, ${Math.round(a.to)});`);
        lines.push(`        lv_anim_set_time(&${aVar}, ${duration});`);
        if (delay !== null) {
            lines.push(`        lv_anim_set_delay(&${aVar}, ${delay});`);
        }
        lines.push(`        lv_anim_set_path_cb(&${aVar}, ${easing});`);
        if (repeat !== undefined) {
            if (repeat < 0) {
                lines.push(`        lv_anim_set_repeat_count(&${aVar}, LV_ANIM_REPEAT_INFINITE);`);
            } else if (repeat > 0) {
                lines.push(`        lv_anim_set_repeat_count(&${aVar}, ${Math.round(repeat)});`);
            }
        }
        if (playback) {
            lines.push(`        lv_anim_set_playback_time(&${aVar}, ${duration});`);
        }
        lines.push(`        lv_anim_start(&${aVar});`);
        lines.push(`    }`);
    });
    return lines;
}

function walkComponents(comps: Component[], fn: (c: Component) => void): void {
    for (const c of comps) {
        fn(c);
        if ("children" in c && Array.isArray((c as { children?: Component[] }).children)) {
            walkComponents((c as { children: Component[] }).children, fn);
        }
    }
}

/** Emit `ui_<page>_play_animations()` when the page has widget animations. */
export function emitPagePlayAnimationsFn(page: Page): string | null {
    const blocks: string[] = [];
    walkComponents(page.components, c => {
        if (!c.animations?.length) {
            return;
        }
        const v = widgetVar(page.id, c.id);
        blocks.push(...emitAnimationCalls(v, c.animations).map(l => l.replace(/^    /, "    ")));
    });
    if (!blocks.length) {
        return null;
    }
    const fn = `ui_${page.id}_play_animations`;
    return [
        `static void ${fn}(void)`,
        `{`,
        ...blocks,
        `}`
    ].join("\n");
}

export function pagePlayAnimationsCall(pageId: string): string {
    return `ui_${pageId}_play_animations();`;
}
