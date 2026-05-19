import type { EmbfProject, Page, PageSwipeFlow, SwipeDirection } from "../types/embf";
import { screenVar, toIdentifier } from "./naming";
import { emitNavigateStatement } from "./eventGen";
import { isLvglV9 } from "./pageGen";

/** Active pointer indev inside an event handler (LVGL 9 renamed `lv_indev_get_act`). */
function activeIndevExpr(project: EmbfProject): string {
    return isLvglV9(project) ? "lv_indev_active()" : "lv_indev_get_act()";
}

export function swipeCbName(pageId: string): string {
    return `ui_${toIdentifier(pageId)}_on_swipe`;
}

function lvDirConstant(direction: SwipeDirection): string {
    switch (direction) {
        case "left":
            return "LV_DIR_LEFT";
        case "right":
            return "LV_DIR_RIGHT";
        case "top":
            return "LV_DIR_TOP";
        case "bottom":
            return "LV_DIR_BOTTOM";
    }
}

export function collectPageSwipes(project: EmbfProject, page: Page): {
    decls: string[];
    impls: string[];
    registrations: string[];
} {
    const swipes = page.swipes ?? [];
    if (swipes.length === 0) {
        return { decls: [], impls: [], registrations: [] };
    }

    const v9 = isLvglV9(project);
    const indev = activeIndevExpr(project);
    const cbName = swipeCbName(page.id);
    const scrVar = screenVar(page.id);

    const branches = swipes.map((swipe: PageSwipeFlow) => {
        const body = emitNavigateStatement(project, swipe, v9);
        return `    if (dir == ${lvDirConstant(swipe.direction)}) {\n        ${body}\n    }`;
    });

    const impl = [
        `static void ${cbName}(lv_event_t *e)`,
        `{`,
        `    if (lv_event_get_code(e) != LV_EVENT_GESTURE) {`,
        `        return;`,
        `    }`,
        `    lv_dir_t dir = lv_indev_get_gesture_dir(${indev});`,
        ...branches,
        `}`,
    ].join("\n");

    const decl = `static void ${cbName}(lv_event_t *e);`;
    const registration = `    lv_obj_add_event_cb(${scrVar}, ${cbName}, LV_EVENT_GESTURE, NULL);`;

    return { decls: [decl], impls: [impl], registrations: [registration] };
}
