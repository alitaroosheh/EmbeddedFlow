import type { Component, Page } from "./types/embf";

function walkComponents(components: Component[], fn: (c: Component) => boolean): boolean {
    for (const c of components) {
        if (fn(c)) {
            return true;
        }
        if ("children" in c && Array.isArray((c as { children?: Component[] }).children)) {
            if (walkComponents((c as { children: Component[] }).children, fn)) {
                return true;
            }
        }
    }
    return false;
}

/** Update `x` / `y` for a component id anywhere on the page (including nested children). */
export function setComponentPositionOnPage(
    page: Page,
    componentId: string,
    x: number,
    y: number
): boolean {
    return walkComponents(page.components, c => {
        if (c.id !== componentId) {
            return false;
        }
        c.x = Math.round(x);
        c.y = Math.round(y);
        return true;
    });
}
