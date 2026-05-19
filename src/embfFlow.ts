import type { Component, EmbfProject, EventDef, EventTrigger, NavigateAction, ScreenLoadAnim } from "./types/embf";

/** A navigate action from a widget on one page to another page. */
export interface NavigateFlow {
    sourcePageIndex: number;
    sourcePageId: string;
    sourcePageName: string;
    componentId: string;
    componentType: string;
    trigger: EventTrigger;
    targetPageId: string;
    targetPageName: string;
    targetPageIndex: number;
    anim: ScreenLoadAnim;
    time: number;
    delay: number;
    autoDel: boolean;
}

export interface NavigateFlowOptions {
    anim?: ScreenLoadAnim;
    time?: number;
    delay?: number;
    autoDel?: boolean;
}

function navigateActionFields(action: NavigateAction): Pick<NavigateFlow, "anim" | "time" | "delay" | "autoDel"> {
    return {
        anim: action.anim ?? "none",
        time: action.time ?? 300,
        delay: action.delay ?? 0,
        autoDel: action.autoDel ?? false
    };
}

function flatComponents(components: Component[]): Component[] {
    const out: Component[] = [];
    for (const c of components) {
        out.push(c);
        if ("children" in c && Array.isArray((c as { children?: Component[] }).children)) {
            out.push(...flatComponents((c as { children: Component[] }).children));
        }
    }
    return out;
}

function findComponentOnPage(page: { components: Component[] }, componentId: string): Component | undefined {
    return flatComponents(page.components).find(c => c.id === componentId);
}

function pageById(project: EmbfProject, pageId: string): { page: (typeof project.pages)[0]; index: number } | undefined {
    const index = project.pages.findIndex(p => p.id === pageId);
    if (index < 0) {
        return undefined;
    }
    return { page: project.pages[index], index };
}

/** Collect all inter-page navigate handlers in the project. */
export function collectNavigateFlows(project: EmbfProject): NavigateFlow[] {
    const flows: NavigateFlow[] = [];
    for (let pi = 0; pi < project.pages.length; pi++) {
        const page = project.pages[pi];
        for (const comp of flatComponents(page.components)) {
            for (const evt of comp.events ?? []) {
                for (const action of evt.actions) {
                    if (action.type !== "navigate") {
                        continue;
                    }
                    const target = pageById(project, action.target);
                    if (!target) {
                        continue;
                    }
                    flows.push({
                        sourcePageIndex: pi,
                        sourcePageId: page.id,
                        sourcePageName: page.name,
                        componentId: comp.id,
                        componentType: comp.type,
                        trigger: evt.trigger,
                        targetPageId: target.page.id,
                        targetPageName: target.page.name,
                        targetPageIndex: target.index,
                        ...navigateActionFields(action)
                    });
                }
            }
        }
    }
    return flows;
}

/**
 * Add `navigate` on `componentId` when `trigger` fires (merges into existing trigger block).
 */
export function addNavigateFlow(
    project: EmbfProject,
    sourcePageIndex: number,
    componentId: string,
    trigger: EventTrigger,
    targetPageId: string,
    options: NavigateFlowOptions = {}
): boolean {
    if (sourcePageIndex < 0 || sourcePageIndex >= project.pages.length) {
        return false;
    }
    if (!pageById(project, targetPageId)) {
        return false;
    }
    const page = project.pages[sourcePageIndex];
    const comp = findComponentOnPage(page, componentId);
    if (!comp) {
        return false;
    }

    if (!comp.events) {
        comp.events = [];
    }

    let evt = comp.events.find(e => e.trigger === trigger);
    if (!evt) {
        evt = { trigger, actions: [] };
        comp.events.push(evt);
    }

    const existing = evt.actions.find(
        a => a.type === "navigate" && a.target === targetPageId
    ) as NavigateAction | undefined;
    if (existing) {
        if (options.anim !== undefined) {
            existing.anim = options.anim;
        }
        if (options.time !== undefined) {
            existing.time = options.time;
        }
        if (options.delay !== undefined) {
            existing.delay = options.delay;
        }
        if (options.autoDel !== undefined) {
            existing.autoDel = options.autoDel;
        }
        return true;
    }

    const action: NavigateAction = { type: "navigate", target: targetPageId };
    if (options.anim !== undefined && options.anim !== "none") {
        action.anim = options.anim;
    }
    if (options.time !== undefined && options.time !== 300) {
        action.time = options.time;
    }
    if (options.delay !== undefined && options.delay !== 0) {
        action.delay = options.delay;
    }
    if (options.autoDel) {
        action.autoDel = true;
    }
    evt.actions.push(action);
    return true;
}

/** Remove a matching navigate action; drops empty event entries. */
export function removeNavigateFlow(
    project: EmbfProject,
    sourcePageIndex: number,
    componentId: string,
    trigger: EventTrigger,
    targetPageId: string
): boolean {
    if (sourcePageIndex < 0 || sourcePageIndex >= project.pages.length) {
        return false;
    }
    const comp = findComponentOnPage(project.pages[sourcePageIndex], componentId);
    if (!comp?.events?.length) {
        return false;
    }

    let removed = false;
    comp.events = comp.events
        .map(evt => {
            if (evt.trigger !== trigger) {
                return evt;
            }
            const actions = evt.actions.filter(a => {
                if (a.type === "navigate" && a.target === targetPageId) {
                    removed = true;
                    return false;
                }
                return true;
            });
            return { ...evt, actions };
        })
        .filter(evt => evt.actions.length > 0);

    if (comp.events.length === 0) {
        delete comp.events;
    }

    return removed;
}

/** Flat component list on a page (for flow UI pickers). */
export function listComponentsOnPage(project: EmbfProject, pageIndex: number): Component[] {
    if (pageIndex < 0 || pageIndex >= project.pages.length) {
        return [];
    }
    return flatComponents(project.pages[pageIndex].components);
}
