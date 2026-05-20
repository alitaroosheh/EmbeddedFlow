import type {
    ColorFormat,
    Component,
    ContainerComponent,
    EmbfProject,
    LvglVersion,
    Orientation,
    Page,
    StyleProps,
    TextDirection
} from "./types/embf";
import { SUPPORTED_VERSIONS } from "./embfParser";
import { allocateNewComponentId } from "./embfWidgetFactory";

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

const COLOR_FORMATS = new Set<ColorFormat>(["RGB565", "RGB888", "ARGB8888", "L8", "AL88"]);
const ORIENTATIONS = new Set<Orientation>([
    "portrait",
    "landscape",
    "portrait_flipped",
    "landscape_flipped"
]);
const TEXT_DIRECTIONS = new Set<TextDirection>(["ltr", "rtl"]);

/**
 * Inspector edits for the active page, project meta, display, theme, and codegen path.
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

    if (patch.pageId !== undefined && typeof patch.pageId === "string") {
        const id = patch.pageId.trim();
        if (id && isPageIdAvailable(project, id, pageIndex)) {
            page.id = id;
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

    if (patch.projName !== undefined && typeof patch.projName === "string") {
        const t = patch.projName.trim();
        if (t) {
            project.project.name = t;
        }
    }

    if (patch.projLvglVersion !== undefined && typeof patch.projLvglVersion === "string") {
        const v = patch.projLvglVersion.trim() as LvglVersion;
        if (SUPPORTED_VERSIONS.includes(v)) {
            project.project.lvglVersion = v;
        }
    }

    if (Object.prototype.hasOwnProperty.call(patch, "projDescription")) {
        const d = patch.projDescription;
        if (d === null || d === "") {
            delete project.project.description;
        } else if (typeof d === "string") {
            project.project.description = d;
        }
    }

    if (Object.prototype.hasOwnProperty.call(patch, "projOutputPath")) {
        const op = patch.projOutputPath;
        if (op === null || op === "") {
            delete project.project.outputPath;
        } else if (typeof op === "string" && op.trim()) {
            project.project.outputPath = op.trim();
        }
    }

    if (patch.projLvglInclude !== undefined && typeof patch.projLvglInclude === "string") {
        const inc = patch.projLvglInclude.trim();
        if (inc === "lvgl.h" || inc === "lvgl/lvgl.h") {
            project.project.lvglInclude = inc;
        }
    }

    const disp = project.display;

    if (patch.dispWidth !== undefined) {
        const n = Number(patch.dispWidth);
        if (Number.isFinite(n) && n >= 1) {
            disp.width = Math.round(n);
        }
    }
    if (patch.dispHeight !== undefined) {
        const n = Number(patch.dispHeight);
        if (Number.isFinite(n) && n >= 1) {
            disp.height = Math.round(n);
        }
    }
    if (patch.dispBitDepth !== undefined) {
        const n = Number(patch.dispBitDepth);
        if (n === 16 || n === 24 || n === 32) {
            disp.bitDepth = n;
        }
    }
    if (patch.dispColorFormat !== undefined && typeof patch.dispColorFormat === "string") {
        const cf = patch.dispColorFormat as ColorFormat;
        if (COLOR_FORMATS.has(cf)) {
            disp.colorFormat = cf;
        }
    }
    if (patch.dispOrientation !== undefined && typeof patch.dispOrientation === "string") {
        const o = patch.dispOrientation as Orientation;
        if (ORIENTATIONS.has(o)) {
            disp.orientation = o;
        }
    }
    if (patch.dispDirection !== undefined && typeof patch.dispDirection === "string") {
        const d = patch.dispDirection as TextDirection;
        if (TEXT_DIRECTIONS.has(d)) {
            disp.direction = d;
        }
    }
    if (Object.prototype.hasOwnProperty.call(patch, "dispDpi")) {
        const dpi = patch.dispDpi;
        if (dpi === null || dpi === "") {
            delete disp.dpi;
        } else {
            const n = Number(dpi);
            if (Number.isFinite(n) && n >= 1) {
                disp.dpi = Math.round(n);
            }
        }
    }
    if (patch.dispRound !== undefined && typeof patch.dispRound === "boolean") {
        disp.round = patch.dispRound;
    }

    if (patch.themeDark !== undefined && typeof patch.themeDark === "boolean") {
        project.theme ??= { dark: false };
        project.theme.dark = patch.themeDark;
    }

    if (Object.prototype.hasOwnProperty.call(patch, "themePrimaryColor")) {
        const v = patch.themePrimaryColor;
        project.theme ??= { dark: false };
        if (v === null || v === "") {
            delete project.theme.primaryColor;
        } else if (typeof v === "string" && v.trim()) {
            project.theme.primaryColor = v.trim();
        }
    }

    if (Object.prototype.hasOwnProperty.call(patch, "themeSecondaryColor")) {
        const v = patch.themeSecondaryColor;
        project.theme ??= { dark: false };
        if (v === null || v === "") {
            delete project.theme.secondaryColor;
        } else if (typeof v === "string" && v.trim()) {
            project.theme.secondaryColor = v.trim();
        }
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

export type CombineWidgetsPageResult =
    | { ok: true; containerId: string }
    | { ok: false; reason: string };

export type UngroupContainerPageResult =
    | { ok: true; liftedIds: string[] }
    | { ok: false; reason: string };

/**
 * Find where a component sits in the tree: its siblings array and index.
 */
function findSiblingPlacement(
    components: Component[],
    componentId: string,
    parent: Component | null
): { siblings: Component[]; index: number; parent: Component | null } | null {
    for (let i = 0; i < components.length; i++) {
        const c = components[i];
        if (c.id === componentId) {
            return { siblings: components, index: i, parent };
        }
        const ch = getChildrenArray(c);
        if (ch?.length) {
            const inner = findSiblingPlacement(ch, componentId, c);
            if (inner) {
                return inner;
            }
        }
    }
    return null;
}

/**
 * Extra margin outside widget width/height when building a group box.
 * LVGL draws slider knobs and similar parts outside the logical widget rect.
 */
function componentOutsetPadding(type: string): { l: number; t: number; r: number; b: number } {
    switch (type) {
        case "slider":
        case "bar":
            return { l: 14, t: 6, r: 14, b: 6 };
        case "switch":
            return { l: 10, t: 4, r: 10, b: 4 };
        case "arc":
            return { l: 8, t: 8, r: 8, b: 8 };
        case "dropdown":
        case "roller":
            return { l: 2, t: 2, r: 2, b: 4 };
        default:
            return { l: 0, t: 0, r: 0, b: 0 };
    }
}

/** Same parent (same sibling list) widgets → one `container` wrapping them. Child order follows ascending z-index in that list. */
export function combineWidgetsOnPage(
    project: EmbfProject,
    page: Page,
    componentIds: string[]
): CombineWidgetsPageResult {
    const uniq = [...new Set(componentIds.map(id => id.trim()).filter(Boolean))];
    if (uniq.length < 2) {
        return { ok: false, reason: "Select at least two widgets to combine." };
    }

    type Pla = { siblings: Component[]; index: number; parent: Component | null };
    const placements = uniq.map(id => {
        const pla = findSiblingPlacement(page.components, id, null);
        return { id, pla };
    });

    if (placements.some(p => !p.pla)) {
        return { ok: false, reason: "One or more widgets were not found on this page." };
    }

    const sibRef = placements[0]!.pla!.siblings;
    if (!placements.every(p => p.pla!.siblings === sibRef)) {
        return { ok: false, reason: "Widgets must share the same parent (siblings)." };
    }

    const sorted = [...placements].sort((a, b) => a.pla!.index - b.pla!.index);

    type AbsSnap = { clone: Component; ax: number; ay: number; w: number; h: number };
    const snaps: AbsSnap[] = [];
    for (const { id } of sorted) {
        const loc = locateWithParentOrigin(page.components, id, 0, 0);
        if (!loc) {
            return { ok: false, reason: "Could not resolve widget geometry." };
        }
        snaps.push({
            clone: JSON.parse(JSON.stringify(loc.comp)) as Component,
            ax: loc.parentAbsX + loc.comp.x,
            ay: loc.parentAbsY + loc.comp.y,
            w: loc.comp.width,
            h: loc.comp.height
        });
    }

    const parentLoc = locateWithParentOrigin(page.components, sorted[0]!.id, 0, 0);
    if (!parentLoc) {
        return { ok: false, reason: "Could not resolve parent origin." };
    }
    const pax = parentLoc.parentAbsX;
    const pay = parentLoc.parentAbsY;

    const minAx = Math.min(
        ...snaps.map(s => {
            const p = componentOutsetPadding(s.clone.type);
            return s.ax - p.l;
        })
    );
    const minAy = Math.min(
        ...snaps.map(s => {
            const p = componentOutsetPadding(s.clone.type);
            return s.ay - p.t;
        })
    );
    const maxRx = Math.max(
        ...snaps.map(s => {
            const p = componentOutsetPadding(s.clone.type);
            return s.ax + s.w + p.r;
        })
    );
    const maxBy = Math.max(
        ...snaps.map(s => {
            const p = componentOutsetPadding(s.clone.type);
            return s.ay + s.h + p.b;
        })
    );

    const idSet = new Set(uniq);
    const insertOriginalIndex = Math.min(...sorted.map(p => p.pla!.index));
    const siblings = sibRef;

    const newId = allocateNewComponentId(project, "box");
    const group: ContainerComponent = {
        id: newId,
        type: "container",
        x: Math.round(minAx - pax),
        y: Math.round(minAy - pay),
        width: Math.max(1, Math.round(maxRx - minAx)),
        height: Math.max(1, Math.round(maxBy - minAy)),
        layout: "none",
        hidden: false,
        children: snaps.map(s => {
            const ch = s.clone;
            ch.x = Math.round(s.ax - minAx);
            ch.y = Math.round(s.ay - minAy);
            return ch;
        })
    };

    const rebuilt: Component[] = [];
    let inserted = false;
    for (let i = 0; i < siblings.length; i++) {
        const c = siblings[i];
        if (idSet.has(c.id)) {
            if (i === insertOriginalIndex) {
                rebuilt.push(group);
                inserted = true;
            }
            continue;
        }
        rebuilt.push(c);
    }

    if (!inserted) {
        return { ok: false, reason: "Could not insert group (internal error)." };
    }

    siblings.splice(0, siblings.length, ...rebuilt);
    return { ok: true, containerId: newId };
}

/** Move `container` / `panel` children to the parent list at the group’s index; remove the group. */
export function ungroupContainerOnPage(page: Page, containerId: string): UngroupContainerPageResult {
    const id = containerId.trim();
    if (!id) {
        return { ok: false, reason: "Invalid widget id." };
    }

    const ctx = findSiblingPlacement(page.components, id, null);
    if (!ctx) {
        return { ok: false, reason: "Widget not found on this page." };
    }

    const comp = ctx.siblings[ctx.index];
    if (comp.type !== "container" && comp.type !== "panel") {
        return { ok: false, reason: "Only a container or panel can be ungrouped." };
    }

    const children = getChildrenArray(comp);
    if (!children?.length) {
        return { ok: false, reason: "This group has no children to ungroup." };
    }

    const loc = locateWithParentOrigin(page.components, id, 0, 0);
    if (!loc) {
        return { ok: false, reason: "Could not resolve group geometry." };
    }

    const absGx = loc.parentAbsX + comp.x;
    const absGy = loc.parentAbsY + comp.y;
    const pax = loc.parentAbsX;
    const pay = loc.parentAbsY;

    const lifted: Component[] = children.map(ch => {
        const copy = JSON.parse(JSON.stringify(ch)) as Component;
        const absCx = absGx + copy.x;
        const absCy = absGy + copy.y;
        copy.x = Math.round(absCx - pax);
        copy.y = Math.round(absCy - pay);
        return copy;
    });

    const at = ctx.index;
    ctx.siblings.splice(at, 1);
    for (let i = 0; i < lifted.length; i++) {
        ctx.siblings.splice(at + i, 0, lifted[i]!);
    }

    return { ok: true, liftedIds: lifted.map(c => c.id) };
}

// ─── Page list operations (preview sidebar) ───────────────────────────────────

export function collectPageIds(project: EmbfProject): Set<string> {
    return new Set(project.pages.map(p => p.id));
}

export function allocateNewPageId(project: EmbfProject): string {
    const ids = collectPageIds(project);
    if (!ids.has("page_main")) {
        return "page_main";
    }
    for (let i = 2; i < 100000; i++) {
        const id = `page_${i}`;
        if (!ids.has(id)) {
            return id;
        }
    }
    return `page_${Date.now()}`;
}

/** Append a new empty page; returns its index. */
export function addPageToProject(project: EmbfProject): number {
    const id = allocateNewPageId(project);
    const page: Page = {
        id,
        name: `Page ${project.pages.length + 1}`,
        components: []
    };
    project.pages.push(page);
    return project.pages.length - 1;
}

/** Remove a page when more than one exists. Returns new selected index hint. */
export function removePageFromProject(project: EmbfProject, pageIndex: number): number | undefined {
    if (project.pages.length <= 1) {
        return undefined;
    }
    if (pageIndex < 0 || pageIndex >= project.pages.length) {
        return undefined;
    }
    project.pages.splice(pageIndex, 1);
    return Math.min(pageIndex, project.pages.length - 1);
}

export function isPageIdAvailable(project: EmbfProject, pageId: string, exceptIndex: number): boolean {
    const t = pageId.trim();
    if (!t) {
        return false;
    }
    return !project.pages.some((p, i) => i !== exceptIndex && p.id === t);
}

/** Rename display name and/or page id. Returns false if id collides or invalid. */
export function renamePageOnProject(
    project: EmbfProject,
    pageIndex: number,
    patch: { name?: string; id?: string }
): boolean {
    if (pageIndex < 0 || pageIndex >= project.pages.length) {
        return false;
    }
    const page = project.pages[pageIndex];
    if (patch.name !== undefined) {
        const n = patch.name.trim();
        if (!n) {
            return false;
        }
        page.name = n;
    }
    if (patch.id !== undefined) {
        const id = patch.id.trim();
        if (!id || !isPageIdAvailable(project, id, pageIndex)) {
            return false;
        }
        page.id = id;
    }
    return true;
}
