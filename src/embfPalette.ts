import type { ComponentType } from "./types/embf";

/** Widget types exposed in the preview “add widget” control (parser-validated subset). */
export const WIDGET_PALETTE_ORDER: readonly ComponentType[] = [
    "label",
    "button",
    "slider",
    "switch",
    "bar",
    "arc",
    "knob",
    "checkbox",
    "dropdown",
    "roller",
    "textarea",
    "line",
    "image",
    "container",
    "panel",
    "spinner"
] as const;

const PALETTE_SET = new Set<string>(WIDGET_PALETTE_ORDER);

export function isPaletteWidgetType(s: string): s is ComponentType {
    return PALETTE_SET.has(s);
}
