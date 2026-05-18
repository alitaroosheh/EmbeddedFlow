import type { EmbfProject, LvglIncludePath } from "../types/embf";

export const DEFAULT_LVGL_INCLUDE: LvglIncludePath = "lvgl/lvgl.h";

export function normalizeLvglIncludePath(value: unknown): LvglIncludePath | undefined {
    if (value === "lvgl.h" || value === "lvgl/lvgl.h") {
        return value;
    }
    return undefined;
}

export function resolveLvglIncludePath(project: EmbfProject): LvglIncludePath {
    return normalizeLvglIncludePath(project.project.lvglInclude) ?? DEFAULT_LVGL_INCLUDE;
}

/** `#include "…"` line for generated C/H files. */
export function lvglIncludeDirective(project: EmbfProject): string {
    return `#include "${resolveLvglIncludePath(project)}"`;
}
