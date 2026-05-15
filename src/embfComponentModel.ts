import type { Component, ContainerComponent, Page } from "./types/embf";

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

function deleteFromList(components: Component[], componentId: string): boolean {
    const idx = components.findIndex(c => c.id === componentId);
    if (idx >= 0) {
        components.splice(idx, 1);
        return true;
    }
    for (const c of components) {
        if ("children" in c && Array.isArray((c as { children?: Component[] }).children)) {
            if (deleteFromList((c as { children: Component[] }).children, componentId)) {
                return true;
            }
        }
    }
    return false;
}

export function findComponentOnPage(page: Page, componentId: string): Component | undefined {
    let found: Component | undefined;
    walkComponents(page.components, c => {
        if (c.id === componentId) {
            found = c;
            return true;
        }
        return false;
    });
    return found;
}

/** Update `x` / `y` for a component id anywhere on the page (including nested children). */
export function setComponentPositionOnPage(
    page: Page,
    componentId: string,
    x: number,
    y: number
): boolean {
    const comp = findComponentOnPage(page, componentId);
    if (!comp) {
        return false;
    }
    comp.x = Math.round(x);
    comp.y = Math.round(y);
    return true;
}

export function deleteComponentOnPage(page: Page, componentId: string): boolean {
    return deleteFromList(page.components, componentId);
}

function setNum(comp: Record<string, unknown>, key: string, value: unknown): void {
    if (typeof value === "number" && Number.isFinite(value)) {
        comp[key] = Math.round(value);
    }
}

function setStr(comp: Record<string, unknown>, key: string, value: unknown): void {
    if (typeof value === "string") {
        comp[key] = value;
    }
}

function setBool(comp: Record<string, unknown>, key: string, value: unknown): void {
    if (typeof value === "boolean") {
        comp[key] = value;
    }
}

/**
 * Apply editable inspector fields onto a component (does not validate the full project).
 */
export function applyComponentPatch(comp: Component, patch: Record<string, unknown>): void {
    const r = comp as unknown as Record<string, unknown>;

    if ("x" in patch) setNum(r, "x", patch.x);
    if ("y" in patch) setNum(r, "y", patch.y);
    if ("width" in patch) setNum(r, "width", patch.width);
    if ("height" in patch) setNum(r, "height", patch.height);
    if ("hidden" in patch) setBool(r, "hidden", patch.hidden);

    switch (comp.type) {
        case "label":
            if ("text" in patch) setStr(r, "text", patch.text);
            break;
        case "button":
            if ("label" in patch) setStr(r, "label", patch.label);
            break;
        case "image":
            if ("src" in patch) setStr(r, "src", patch.src);
            break;
        case "slider":
        case "bar":
        case "arc":
            if ("min" in patch) setNum(r, "min", patch.min);
            if ("max" in patch) setNum(r, "max", patch.max);
            if ("value" in patch) setNum(r, "value", patch.value);
            break;
        case "switch":
        case "checkbox":
            if ("checked" in patch) setBool(r, "checked", patch.checked);
            if (comp.type === "checkbox" && "text" in patch) setStr(r, "text", patch.text);
            break;
        case "dropdown":
        case "roller":
            if ("options" in patch && Array.isArray(patch.options)) {
                r.options = patch.options.map(String);
            }
            if ("selectedIndex" in patch) setNum(r, "selectedIndex", patch.selectedIndex);
            break;
        case "textarea":
            if ("text" in patch) setStr(r, "text", patch.text);
            if ("placeholder" in patch) setStr(r, "placeholder", patch.placeholder);
            break;
        case "spinner":
            if ("speed" in patch) setNum(r, "speed", patch.speed);
            if ("arcLength" in patch) setNum(r, "arcLength", patch.arcLength);
            break;
        case "container":
            if ("layout" in patch && typeof patch.layout === "string") {
                const v = patch.layout;
                if (v === "none" || v === "flex" || v === "grid") {
                    (comp as ContainerComponent).layout = v;
                }
            }
            break;
        default:
            break;
    }
}

export function patchComponentOnPage(
    page: Page,
    componentId: string,
    patch: Record<string, unknown>
): boolean {
    const comp = findComponentOnPage(page, componentId);
    if (!comp) {
        return false;
    }
    applyComponentPatch(comp, patch);
    return true;
}
