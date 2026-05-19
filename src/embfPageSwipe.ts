import type { EmbfProject, NavigateAction, PageSwipeFlow, ScreenLoadAnim, SwipeDirection } from "./types/embf";

/** Collected swipe → page flow for UI and tooling. */
export interface CollectedPageSwipeFlow {
    sourcePageIndex: number;
    sourcePageId: string;
    sourcePageName: string;
    direction: SwipeDirection;
    targetPageId: string;
    targetPageName: string;
    targetPageIndex: number;
    anim: ScreenLoadAnim;
    time: number;
    delay: number;
    autoDel: boolean;
}

export interface PageSwipeOptions {
    anim?: ScreenLoadAnim;
    time?: number;
    delay?: number;
    autoDel?: boolean;
}

const SWIPE_DIRECTIONS: SwipeDirection[] = ["left", "right", "top", "bottom"];

export function isSwipeDirection(v: string): v is SwipeDirection {
    return (SWIPE_DIRECTIONS as string[]).includes(v);
}

function swipeFields(swipe: PageSwipeFlow): Pick<CollectedPageSwipeFlow, "anim" | "time" | "delay" | "autoDel"> {
    return {
        anim: swipe.anim ?? "none",
        time: swipe.time ?? 300,
        delay: swipe.delay ?? 0,
        autoDel: swipe.autoDel ?? false
    };
}

export function swipeToNavigateAction(swipe: PageSwipeFlow): NavigateAction {
    return {
        type: "navigate",
        target: swipe.target,
        anim: swipe.anim,
        time: swipe.time,
        delay: swipe.delay,
        autoDel: swipe.autoDel
    };
}

/** Collect all page swipe navigations in the project. */
export function collectPageSwipeFlows(project: EmbfProject): CollectedPageSwipeFlow[] {
    const flows: CollectedPageSwipeFlow[] = [];
    for (let pi = 0; pi < project.pages.length; pi++) {
        const page = project.pages[pi];
        for (const swipe of page.swipes ?? []) {
            const ti = project.pages.findIndex(p => p.id === swipe.target);
            if (ti < 0) {
                continue;
            }
            const target = project.pages[ti];
            flows.push({
                sourcePageIndex: pi,
                sourcePageId: page.id,
                sourcePageName: page.name,
                direction: swipe.direction,
                targetPageId: target.id,
                targetPageName: target.name,
                targetPageIndex: ti,
                ...swipeFields(swipe)
            });
        }
    }
    return flows;
}

/** Add or update a swipe navigation on a page (one target per direction). */
export function addPageSwipeFlow(
    project: EmbfProject,
    sourcePageIndex: number,
    direction: SwipeDirection,
    targetPageId: string,
    options: PageSwipeOptions = {}
): boolean {
    if (sourcePageIndex < 0 || sourcePageIndex >= project.pages.length) {
        return false;
    }
    if (!project.pages.some(p => p.id === targetPageId)) {
        return false;
    }

    const page = project.pages[sourcePageIndex];
    if (!page.swipes) {
        page.swipes = [];
    }

    const existing = page.swipes.find(s => s.direction === direction);
    if (existing) {
        existing.target = targetPageId;
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

    const swipe: PageSwipeFlow = { direction, target: targetPageId };
    if (options.anim !== undefined && options.anim !== "none") {
        swipe.anim = options.anim;
    }
    if (options.time !== undefined && options.time !== 300) {
        swipe.time = options.time;
    }
    if (options.delay !== undefined && options.delay !== 0) {
        swipe.delay = options.delay;
    }
    if (options.autoDel) {
        swipe.autoDel = true;
    }
    page.swipes.push(swipe);
    return true;
}

export function removePageSwipeFlow(
    project: EmbfProject,
    sourcePageIndex: number,
    direction: SwipeDirection
): boolean {
    if (sourcePageIndex < 0 || sourcePageIndex >= project.pages.length) {
        return false;
    }
    const page = project.pages[sourcePageIndex];
    if (!page.swipes?.length) {
        return false;
    }
    const before = page.swipes.length;
    const next = page.swipes.filter(s => s.direction !== direction);
    if (next.length === before) {
        return false;
    }
    if (next.length === 0) {
        delete page.swipes;
    } else {
        page.swipes = next;
    }
    return true;
}
