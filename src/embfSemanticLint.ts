import type { Action, Component, EmbfProject, EventDef, Page } from "./types/embf";

export interface EmbfSemanticIssue {
    message: string;
    /** UTF-16 offsets into the source document for highlighting (optional). */
    range?: { start: number; end: number };
}

/** Escapes a string for use inside a RegExp (JSON string value, no quotes). */
function escapeRe(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** `"key": "value"` assignments in JSON; returns spans of the string literal value including quotes. */
export function findJsonStringFieldSpans(
    text: string,
    field: string,
    value: string
): Array<{ start: number; end: number }> {
    const re = new RegExp(`"${escapeRe(field)}"\\s*:\\s*"${escapeRe(value)}"`, "g");
    const spans: Array<{ start: number; end: number }> = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
        spans.push({ start: m.index, end: m.index + m[0].length });
    }
    return spans;
}

function flatComponents(components: Component[]): Component[] {
    const out: Component[] = [];
    for (const c of components) {
        out.push(c);
        if ("children" in c && Array.isArray((c as Component & { children?: Component[] }).children)) {
            out.push(
                ...flatComponents((c as Component & { children: Component[] }).children)
            );
        }
    }
    return out;
}

function componentIdsOnPage(page: Page): Map<string, Component> {
    const m = new Map<string, Component>();
    for (const c of flatComponents(page.components)) {
        m.set(c.id, c);
    }
    return m;
}

function firstTargetSpan(text: string, target: string): { start: number; end: number } | undefined {
    const spans = findJsonStringFieldSpans(text, "target", target);
    return spans[0];
}

function lintAction(
    project: EmbfProject,
    page: Page,
    compId: string,
    evt: EventDef,
    action: Action,
    text: string
): EmbfSemanticIssue[] {
    const issues: EmbfSemanticIssue[] = [];
    const onPage = componentIdsOnPage(page);
    const pageIds = new Set(project.pages.map(p => p.id));

    switch (action.type) {
        case "navigate": {
            if (!pageIds.has(action.target)) {
                issues.push({
                    message: `Event on "${compId}" (${evt.trigger}): navigate target is not a page id: "${action.target}"`,
                    range: firstTargetSpan(text, action.target)
                });
            }
            break;
        }
        case "set_text":
        case "set_value":
        case "set_checked":
        case "set_hidden": {
            const target = action.target;
            const span = firstTargetSpan(text, target);
            if (!onPage.has(target)) {
                issues.push({
                    message:
                        `Event on "${compId}" (${evt.trigger}): action "${action.type}" ` +
                        `refers to "${target}", which is not a widget on page "${page.id}" ` +
                        `(preview and codegen only resolve targets on the same page as the handler)`,
                    range: span
                });
                break;
            }
            const targetComp = onPage.get(target)!;
            if (action.type === "set_text" && targetComp.type !== "label") {
                issues.push({
                    message:
                        `Event on "${compId}": set_text target "${target}" is type "${targetComp.type}"; ` +
                        `only "label" is supported (generated code uses lv_label_set_text)`,
                    range: span
                });
            }
            if (action.type === "set_value" && !["slider", "bar", "arc"].includes(targetComp.type)) {
                issues.push({
                    message:
                        `Event on "${compId}": set_value target "${target}" is type "${targetComp.type}"; ` +
                        `expected slider, bar, or arc`,
                    range: span
                });
            }
            if (
                action.type === "set_checked" &&
                targetComp.type !== "switch" &&
                targetComp.type !== "checkbox"
            ) {
                issues.push({
                    message:
                        `Event on "${compId}": set_checked target "${target}" is type "${targetComp.type}"; ` +
                        `expected switch or checkbox`,
                    range: span
                });
            }
            break;
        }
        case "set_theme":
            break;
        default: {
            const a = action as { type?: string };
            issues.push({
                message: `Event on "${compId}": unsupported action type "${a.type ?? "?"}"`
            });
        }
    }
    return issues;
}

function lintEvents(
    project: EmbfProject,
    page: Page,
    comp: Component,
    text: string
): EmbfSemanticIssue[] {
    const issues: EmbfSemanticIssue[] = [];
    for (const evtDef of comp.events ?? []) {
        for (const action of evtDef.actions) {
            if (!action || typeof action !== "object" || !("type" in action)) {
                issues.push({ message: `Component "${comp.id}": invalid action entry` });
                continue;
            }
            issues.push(...lintAction(project, page, comp.id, evtDef, action as Action, text));
        }
    }
    return issues;
}

/**
 * Structural validation must have succeeded first (`parseEmbfSource`).
 * Returns Issues for duplicate ids, unknown navigate/action targets, and type mismatches.
 */
export function lintEmbfProject(text: string, project: EmbfProject): EmbfSemanticIssue[] {
    const issues: EmbfSemanticIssue[] = [];

    const pageIdCounts = new Map<string, number>();
    for (const p of project.pages) {
        pageIdCounts.set(p.id, (pageIdCounts.get(p.id) ?? 0) + 1);
    }
    for (const [id, count] of pageIdCounts) {
        if (count > 1) {
            // Omit source ranges: `"id": "…"` also matches widget ids with the same string.
            issues.push({ message: `Duplicate page id "${id}" (${count} occurrences)` });
        }
    }

    const compIdToPages = new Map<string, string[]>();
    for (const page of project.pages) {
        for (const c of flatComponents(page.components)) {
            if (!compIdToPages.has(c.id)) {
                compIdToPages.set(c.id, []);
            }
            compIdToPages.get(c.id)!.push(page.id);
        }
    }
    for (const [id, pages] of compIdToPages) {
        const uniq = [...new Set(pages)];
        if (uniq.length > 1 || pages.length > uniq.length) {
            const msg =
                pages.length > uniq.length
                    ? `Duplicate component id "${id}" (same id used more than once; pages: ${uniq.join(", ")})`
                    : `Duplicate component id "${id}" on multiple pages: ${uniq.join(", ")}`;

            const spans = findJsonStringFieldSpans(text, "id", id);
            const maxSpans = Math.min(spans.length, 4);
            for (let i = 0; i < maxSpans; i++) {
                issues.push({ message: msg, range: spans[i] });
            }
            if (spans.length === 0) {
                issues.push({ message: msg });
            }
        }
    }

    const pageIds = new Set(project.pages.map(p => p.id));
    for (const page of project.pages) {
        for (const comp of flatComponents(page.components)) {
            issues.push(...lintEvents(project, page, comp, text));
        }
        for (const swipe of page.swipes ?? []) {
            if (!pageIds.has(swipe.target)) {
                issues.push({
                    message:
                        `Swipe (${swipe.direction}) on page "${page.id}": target is not a page id: "${swipe.target}"`,
                    range: firstTargetSpan(text, swipe.target)
                });
            }
        }
    }

    return dedupeIssues(issues);
}

function dedupeIssues(issues: EmbfSemanticIssue[]): EmbfSemanticIssue[] {
    const seen = new Set<string>();
    const out: EmbfSemanticIssue[] = [];
    for (const i of issues) {
        const key =
            (i.range ? `${i.range.start}:${i.range.end}:` : "") + i.message;
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        out.push(i);
    }
    return out;
}
