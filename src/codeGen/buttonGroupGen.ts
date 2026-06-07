import type { Action, Component, EmbfProject, Page, StyleProps } from "../types/embf";
import { widgetVar } from "./naming";
import { emitStyleCalls } from "./styleGen";

function findComponentOnPage(page: Page, componentId: string): Component | null {
    function walk(comps: Component[]): Component | null {
        for (const c of comps) {
            if (c.id === componentId) {
                return c;
            }
            if ("children" in c && Array.isArray((c as { children?: Component[] }).children)) {
                const hit = walk((c as { children: Component[] }).children);
                if (hit) {
                    return hit;
                }
            }
        }
        return null;
    }
    return walk(page.components);
}

export interface ButtonGroupDef {
    /** Stable id within the page, e.g. group_0 */
    id: string;
    members: string[];
    selectedStyles: StyleProps;
}

function groupKey(members: string[]): string {
    return [...members].sort().join("\0");
}

function walkComponents(comps: Component[], fn: (c: Component) => void): void {
    for (const c of comps) {
        fn(c);
        if ("children" in c && Array.isArray((c as { children?: Component[] }).children)) {
            walkComponents((c as { children: Component[] }).children, fn);
        }
    }
}

function collectActions(page: Page): Action[] {
    const out: Action[] = [];
    walkComponents(page.components, c => {
        for (const evt of c.events ?? []) {
            for (const a of evt.actions) {
                out.push(a);
            }
        }
    });
    return out;
}

function normalizeHex(hex: string | undefined): string {
    if (!hex) {
        return "";
    }
    return hex.replace(/^#/, "").toLowerCase();
}

/** True when widget styles match the group's selected / theme accent colors (design-time default). */
export function stylesLookSelected(
    styles: StyleProps | undefined,
    selected: StyleProps,
    project: EmbfProject
): boolean {
    if (!styles?.bgColor) {
        return false;
    }
    const bg = normalizeHex(styles.bgColor);
    const selBg = normalizeHex(selected.bgColor);
    const primary = normalizeHex(project.theme?.primaryColor ?? "#2dd4ff");
    const secondary = normalizeHex(project.theme?.secondaryColor ?? "#a78bfa");
    return bg === selBg || bg === primary || bg === secondary;
}

function templateUnselectedStyles(page: Page, group: ButtonGroupDef, project: EmbfProject): StyleProps {
    for (const id of group.members) {
        const comp = findComponentOnPage(page, id);
        if (comp?.styles && !stylesLookSelected(comp.styles, group.selectedStyles, project)) {
            return comp.styles;
        }
    }
    return {
        textColor: "#e5e7eb",
        bgColor: "#0f172a",
        borderColor: "#1f2a44",
        borderWidth: 2,
        borderRadius: 12
    };
}

/** Styles for a group member when it is not the active button. */
export function inactiveStylesForMember(
    page: Page,
    memberId: string,
    group: ButtonGroupDef,
    project: EmbfProject
): StyleProps {
    const comp = findComponentOnPage(page, memberId);
    const styles = comp?.styles;
    if (styles && !stylesLookSelected(styles, group.selectedStyles, project)) {
        return styles;
    }
    return templateUnselectedStyles(page, group, project);
}

/** Member that is styled as selected in the .embf (design default), else first member. */
export function defaultActiveMemberId(page: Page, group: ButtonGroupDef, project: EmbfProject): string | null {
    for (const id of group.members) {
        const comp = findComponentOnPage(page, id);
        if (comp?.styles && stylesLookSelected(comp.styles, group.selectedStyles, project)) {
            return id;
        }
    }
    return group.members[0] ?? null;
}

/** Unique mutually-exclusive button groups referenced on a page. */
export function collectButtonGroups(page: Page, project: EmbfProject): ButtonGroupDef[] {
    const seen = new Map<string, ButtonGroupDef>();
    let idx = 0;
    for (const action of collectActions(page)) {
        if (action.type !== "select_button_group") {
            continue;
        }
        const members = action.members.map(m => m.trim()).filter(Boolean);
        if (members.length < 2) {
            continue;
        }
        const key = groupKey(members);
        if (seen.has(key)) {
            continue;
        }
        const selectedStyles =
            action.selectedStyles ??
            ({
                bgColor: project.theme?.primaryColor ?? "#2dd4ff",
                textColor: "#0f172a",
                borderColor: project.theme?.primaryColor ?? "#2dd4ff"
            } satisfies StyleProps);
        seen.set(key, {
            id: `group_${idx++}`,
            members,
            selectedStyles
        });
    }
    return [...seen.values()];
}

function helperName(pageId: string, group: ButtonGroupDef): string {
    return `ui_${pageId}_select_${group.id}`;
}

export function buttonGroupHelperCall(pageId: string, group: ButtonGroupDef, activeId: string): string {
    return `${helperName(pageId, group)}(${widgetVar(pageId, activeId)});`;
}

export function emitButtonGroupHelper(page: Page, project: EmbfProject, group: ButtonGroupDef): string {
    const fn = helperName(page.id, group);
    const lines: string[] = [
        `static void ${fn}(lv_obj_t *active)`,
        `{`,
        `    if (active == NULL) {`,
        `        return;`,
        `    }`
    ];
    for (const memberId of group.members) {
        const v = widgetVar(page.id, memberId);
        const inactive = inactiveStylesForMember(page, memberId, group, project);
        lines.push(`    if (${v}) {`);
        lines.push(...emitStyleCalls(v, inactive, "        "));
        lines.push(`    }`);
    }
    lines.push(`    if (active) {`);
    lines.push(...emitStyleCalls("active", group.selectedStyles, "        "));
    lines.push(`    }`);
    lines.push(`}`);
    return lines.join("\n");
}

/** Apply design-time default selection at end of page init. */
export function emitButtonGroupInitCalls(page: Page, project: EmbfProject): string[] {
    const lines: string[] = [];
    for (const group of collectButtonGroups(page, project)) {
        const active = defaultActiveMemberId(page, group, project);
        if (active) {
            lines.push(`    ${buttonGroupHelperCall(page.id, group, active)}`);
        }
    }
    return lines;
}

export function findButtonGroupForActive(page: Page, project: EmbfProject, activeId: string): ButtonGroupDef | null {
    for (const g of collectButtonGroups(page, project)) {
        if (g.members.includes(activeId)) {
            return g;
        }
    }
    return null;
}
