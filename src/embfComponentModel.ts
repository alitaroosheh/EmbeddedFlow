import type { Component, ContainerComponent, EmbfProject, Page, StyleProps } from "./types/embf";

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

function getChildrenArray(c: Component): Component[] | null {
    if ("children" in c && Array.isArray((c as { children?: Component[] }).children)) {
        return (c as { children: Component[] }).children;
    }
    return null;
}

/**
 * Find a component on the page tree and the absolute origin of its parent
 * (parent top-left in screen coordinates; page root uses 0,0).
 */
function locateWithParentOrigin(
    components: Component[],
    componentId: string,
    parentAbsX: number,
    parentAbsY: number
): { comp: Component; parentAbsX: number; parentAbsY: number } | null {
    for (const c of components) {
        if (c.id === componentId) {
            return { comp: c, parentAbsX, parentAbsY };
        }
        const children = getChildrenArray(c);
        if (children?.length) {
            const ax = parentAbsX + c.x;
            const ay = parentAbsY + c.y;
            const found = locateWithParentOrigin(children, componentId, ax, ay);
            if (found) {
                return found;
            }
        }
    }
    return null;
}

/** Set component top-left in absolute (screen) coordinates. */
export function setAbsolutePositionOnPage(
    page: Page,
    componentId: string,
    absX: number,
    absY: number
): boolean {
    const id = componentId.trim();
    if (!id) {
        return false;
    }
    const loc = locateWithParentOrigin(page.components, id, 0, 0);
    if (!loc) {
        return false;
    }
    loc.comp.x = Math.round(absX - loc.parentAbsX);
    loc.comp.y = Math.round(absY - loc.parentAbsY);
    return true;
}

export function bulkSetAbsolutePositionsOnPage(
    page: Page,
    moves: { componentId: string; absX: number; absY: number }[]
): boolean {
    if (!moves.length) {
        return false;
    }
    for (const m of moves) {
        if (!setAbsolutePositionOnPage(page, m.componentId, m.absX, m.absY)) {
            return false;
        }
    }
    return true;
}

export function bulkPatchComponentsOnPage(
    page: Page,
    updates: { componentId: string; patch: Record<string, unknown> }[]
): boolean {
    if (!updates.length) {
        return false;
    }
    for (const u of updates) {
        if (!patchComponentOnPage(page, u.componentId.trim(), u.patch)) {
            return false;
        }
    }
    return true;
}

export function bulkDeleteComponentsOnPage(page: Page, componentIds: string[]): boolean {
    const ids = [...new Set(componentIds.map(id => id.trim()).filter(Boolean))];
    if (!ids.length) {
        return false;
    }
    for (const id of ids) {
        if (!deleteComponentOnPage(page, id)) {
            return false;
        }
    }
    return true;
}

function setFiniteInt(comp: Record<string, unknown>, key: string, value: unknown): void {
    if (typeof value === "number" && Number.isFinite(value)) {
        comp[key] = Math.round(value);
    }
}

function setFiniteNum(comp: Record<string, unknown>, key: string, value: unknown): void {
    if (typeof value === "number" && Number.isFinite(value)) {
        comp[key] = value;
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
 * Merge style keys from an inspector snapshot.
 * Each key may be `null`/`""` to remove; keys absent from `incoming` leave the previous value unchanged.
 */
function mergeInspectorStyles(comp: Component, incoming: Record<string, unknown>): void {
    const cur = { ...((comp as { styles?: StyleProps }).styles ?? {}) } as Record<string, unknown>;
    const alignAllowed = new Set(["left", "center", "right"]);

    const strKeys = [
        "bgColor",
        "indicatorColor",
        "textColor",
        "borderColor",
        "fontFamily"
    ] as const;
    for (const k of strKeys) {
        if (!Object.prototype.hasOwnProperty.call(incoming, k)) continue;
        const raw = incoming[k];
        if (raw === null || raw === "") {
            delete cur[k];
            continue;
        }
        if (typeof raw === "string") {
            const t = raw.trim();
            if (t) {
                cur[k] = t;
            } else {
                delete cur[k];
            }
        }
    }

    function numOrClear(key: "bgOpacity" | "borderWidth" | "borderRadius" | "fontSize"): void {
        if (!Object.prototype.hasOwnProperty.call(incoming, key)) return;
        const raw = incoming[key];
        if (raw === null) {
            delete cur[key];
            return;
        }
        if (typeof raw === "number" && Number.isFinite(raw)) {
            if (key === "bgOpacity") {
                cur.bgOpacity = Math.min(255, Math.max(0, Math.round(raw)));
            } else if (key === "fontSize") {
                const n = Math.round(raw);
                if (n >= 4) cur.fontSize = n;
                else delete cur.fontSize;
            } else {
                cur[key] = Math.round(Math.max(0, raw));
            }
        }
    }

    numOrClear("bgOpacity");
    numOrClear("borderWidth");
    numOrClear("borderRadius");
    numOrClear("fontSize");

    if (Object.prototype.hasOwnProperty.call(incoming, "align")) {
        const al = incoming["align"];
        if (al === null || al === "") {
            delete cur.align;
        } else if (typeof al === "string" && alignAllowed.has(al)) {
            cur.align = al;
        } else {
            delete cur.align;
        }
    }

    if (Object.prototype.hasOwnProperty.call(incoming, "padding")) {
        const pd = incoming["padding"];
        if (pd === null) {
            delete cur.padding;
        } else if (typeof pd === "number" && Number.isInteger(pd) && pd >= 0) {
            cur.padding = pd;
        } else if (Array.isArray(pd)) {
            const arr = (pd as unknown[]).filter(
                x => typeof x === "number" && Number.isInteger(x) && x >= 0
            ) as number[];
            if (arr.length >= 2 && arr.length <= 4) {
                cur.padding = arr as StyleProps["padding"];
            }
        }
    }

    const keys = Object.keys(cur);
    if (keys.length === 0) {
        delete (comp as { styles?: StyleProps }).styles;
    } else {
        (comp as { styles?: StyleProps }).styles = cur as StyleProps;
    }
}

/** Parse textarea line points: each line x,y — optional spaces. */
export function parseLinePointsText(raw: string): Array<{ x: number; y: number }> | undefined {
    const lines = raw
        .split(/[\r\n]+/)
        .map(s => s.trim())
        .filter(Boolean);
    const out: Array<{ x: number; y: number }> = [];
    for (const ln of lines) {
        const m = ln.split(/[, ]+/).map(p => Number(p.trim()));
        if (
            m.length >= 2 &&
            Number.isFinite(m[0]) &&
            Number.isFinite(m[1])
        ) {
            out.push({ x: Math.round(m[0]), y: Math.round(m[1]) });
        }
    }
    return out.length >= 2 ? out : undefined;
}

export function stringifyLinePoints(pts?: Array<{ x: number; y: number }>): string {
    if (!pts?.length) {
        return "";
    }
    return pts.map(p => `${p.x}, ${p.y}`).join("\n");
}

function setBarMode(comp: Record<string, unknown>, value: unknown): void {
    if (value === "" || value === undefined) {
        delete comp["mode"];
        return;
    }
    if (typeof value === "string" && /^(normal|symmetrical|range)$/.test(value)) {
        comp["mode"] = value;
    }
}

function setArcMode(comp: Record<string, unknown>, value: unknown): void {
    if (value === "" || value === undefined) {
        delete comp["mode"];
        return;
    }
    if (typeof value === "string" && /^(normal|reverse|symmetrical)$/.test(value)) {
        comp["mode"] = value;
    }
}

function setRollerMode(comp: Record<string, unknown>, value: unknown): void {
    if (value === "" || value === undefined) {
        delete comp["mode"];
        return;
    }
    if (typeof value === "string" && /^(normal|infinite)$/.test(value)) {
        comp["mode"] = value;
    }
}

/**
 * Apply editable inspector fields onto a component (does not validate the full project).
 */
export function applyComponentPatch(comp: Component, patch: Record<string, unknown>): void {
    const r = comp as unknown as Record<string, unknown>;

    if ("x" in patch) setFiniteInt(r, "x", patch.x);
    if ("y" in patch) setFiniteInt(r, "y", patch.y);
    if ("width" in patch) setFiniteInt(r, "width", patch.width);
    if ("height" in patch) setFiniteInt(r, "height", patch.height);
    if ("hidden" in patch) setBool(r, "hidden", patch.hidden);

    if ("styles" in patch && patch.styles !== undefined) {
        if (typeof patch.styles === "object" && patch.styles !== null && !Array.isArray(patch.styles)) {
            mergeInspectorStyles(comp, patch.styles as Record<string, unknown>);
        }
    }

    if ("events" in patch) {
        if (Array.isArray(patch.events)) {
            r.events = patch.events as unknown[];
        }
    }

    switch (comp.type) {
        case "label":
            if ("text" in patch) setStr(r, "text", patch.text);
            if ("longMode" in patch) {
                const lm = patch.longMode;
                if (typeof lm === "string" && lm.trim() === "") {
                    delete r.longMode;
                } else if (typeof lm === "string" && /^(wrap|dot|scroll|clip)$/.test(lm)) {
                    r.longMode = lm;
                }
            }
            break;
        case "button":
            if ("label" in patch) setStr(r, "label", patch.label);
            break;
        case "image":
            if ("src" in patch) setStr(r, "src", patch.src);
            break;
        case "slider":
            if ("min" in patch) setFiniteNum(r, "min", patch.min);
            if ("max" in patch) setFiniteNum(r, "max", patch.max);
            if ("value" in patch) setFiniteNum(r, "value", patch.value);
            break;
        case "bar":
            if ("min" in patch) setFiniteNum(r, "min", patch.min);
            if ("max" in patch) setFiniteNum(r, "max", patch.max);
            if ("value" in patch) setFiniteNum(r, "value", patch.value);
            if ("mode" in patch) setBarMode(r, patch.mode);
            break;
        case "arc":
            if ("min" in patch) setFiniteNum(r, "min", patch.min);
            if ("max" in patch) setFiniteNum(r, "max", patch.max);
            if ("value" in patch) setFiniteNum(r, "value", patch.value);
            if ("startAngle" in patch) setFiniteNum(r, "startAngle", patch.startAngle);
            if ("endAngle" in patch) setFiniteNum(r, "endAngle", patch.endAngle);
            if ("mode" in patch) setArcMode(r, patch.mode);
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
            if ("selectedIndex" in patch) setFiniteInt(r, "selectedIndex", patch.selectedIndex);
            if (comp.type === "roller" && "mode" in patch) setRollerMode(r, patch.mode);
            break;
        case "textarea":
            if ("text" in patch) setStr(r, "text", patch.text);
            if ("placeholder" in patch) setStr(r, "placeholder", patch.placeholder);
            if ("oneLine" in patch) setBool(r, "oneLine", patch.oneLine);
            break;
        case "spinner":
            if ("speed" in patch) setFiniteNum(r, "speed", patch.speed);
            if ("arcLength" in patch) setFiniteNum(r, "arcLength", patch.arcLength);
            break;
        case "line":
            if ("points" in patch && Array.isArray(patch.points)) {
                const pts = (patch.points as unknown[]).filter(
                    p =>
                        typeof p === "object" &&
                        p !== null &&
                        Number.isFinite((p as { x?: unknown }).x) &&
                        Number.isFinite((p as { y?: unknown }).y)
                );
                if (pts.length >= 2) {
                    r.points = pts.map(o => ({
                        x: Math.round(Number((o as { x: number }).x)),
                        y: Math.round(Number((o as { y: number }).y))
                    }));
                }
            }
            if ("rounded" in patch) setBool(r, "rounded", patch.rounded);
            break;
        case "container":
            if ("layout" in patch && typeof patch.layout === "string") {
                const v = patch.layout;
                if (v === "none" || v === "flex" || v === "grid") {
                    (comp as ContainerComponent).layout = v;
                }
            }
            if ("flexFlow" in patch && typeof patch.flexFlow === "string") {
                const ff = patch.flexFlow;
                if (ff.trim() === "") {
                    delete (comp as ContainerComponent).flexFlow;
                } else if (/^(row|column|row_wrap|column_wrap)$/.test(ff)) {
                        (comp as ContainerComponent).flexFlow = ff as NonNullable<ContainerComponent["flexFlow"]>;
                }
            }
            break;
        default:
            break;
    }
}

/**
 * Inspector edits for the current page and project theme (.embf root `theme`).
 * `backgroundColor`: `null`/empty clears the property so LVGL theme sets screen bg (light/dark).
 */
export function applyPageInspectorPatch(
    project: EmbfProject,
    pageIndex: number,
    patch: Record<string, unknown>
): boolean {
    if (pageIndex < 0 || pageIndex >= project.pages.length) {
        return false;
    }
    const page = project.pages[pageIndex];

    if (patch.pageName !== undefined && typeof patch.pageName === "string") {
        const t = patch.pageName.trim();
        if (t) {
            page.name = t;
        }
    }

    if (Object.prototype.hasOwnProperty.call(patch, "backgroundColor")) {
        const v = patch.backgroundColor;
        if (v === null || v === "") {
            delete page.backgroundColor;
        } else if (typeof v === "string" && v.trim()) {
            page.backgroundColor = v.trim();
        }
    }

    if (patch.themeDark !== undefined && typeof patch.themeDark === "boolean") {
        project.theme ??= { dark: false };
        project.theme.dark = patch.themeDark;
    }

    return true;
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
