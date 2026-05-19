import type { ScreenLoadAnim } from "../types/embf";

const ANIM_IDS: ScreenLoadAnim[] = [
    "none",
    "move_left",
    "move_right",
    "move_top",
    "move_bottom",
    "over_left",
    "over_right",
    "over_top",
    "over_bottom",
    "fade_in",
    "fade_out",
    "out_left",
    "out_right",
    "out_top",
    "out_bottom"
];

/** Validate and normalize `anim` from .embf JSON; default `none`. */
export function normalizeScreenLoadAnim(value: unknown): ScreenLoadAnim | undefined {
    if (value === undefined || value === null) {
        return undefined;
    }
    if (typeof value === "string" && (ANIM_IDS as string[]).includes(value)) {
        return value as ScreenLoadAnim;
    }
    return undefined;
}

/** LVGL C constant for codegen (v8 `LV_SCR_LOAD_ANIM_*` / v9 `LV_SCREEN_LOAD_ANIM_*`). */
export function screenLoadAnimCConstant(anim: ScreenLoadAnim, lvglV9: boolean): string {
    const prefix = lvglV9 ? "LV_SCREEN_LOAD_ANIM_" : "LV_SCR_LOAD_ANIM_";
    const suffix = anim === "none" ? "NONE" : anim.toUpperCase();
    return prefix + suffix;
}

export const SCREEN_LOAD_ANIM_OPTIONS: { value: ScreenLoadAnim; label: string }[] = [
    { value: "none", label: "None (instant)" },
    { value: "move_left", label: "Move left" },
    { value: "move_right", label: "Move right" },
    { value: "move_top", label: "Move top" },
    { value: "move_bottom", label: "Move bottom" },
    { value: "over_left", label: "Over left" },
    { value: "over_right", label: "Over right" },
    { value: "over_top", label: "Over top" },
    { value: "over_bottom", label: "Over bottom" },
    { value: "fade_in", label: "Fade in" },
    { value: "fade_out", label: "Fade out" },
    { value: "out_left", label: "Out left" },
    { value: "out_right", label: "Out right" },
    { value: "out_top", label: "Out top" },
    { value: "out_bottom", label: "Out bottom" }
];
