import type {
    Component,
    ComponentLibraryEntry,
    ContainerComponent,
    EmbfProject,
    Page,
    PanelComponent
} from "./types/embf";
import { collectAllComponentIds } from "./embfWidgetFactory";
import { toIdentifier } from "./codeGen/naming";
import { findComponentOnPage } from "./embfComponentModel";

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

/** Visual size of a container/panel including child outset (knobs, etc.). */
export function libraryBoundsForRoot(root: ContainerComponent | PanelComponent): {
    width: number;
    height: number;
} {
    const kids = root.children ?? [];
    if (!kids.length) {
        return { width: Math.max(1, root.width), height: Math.max(1, root.height) };
    }
    let left = root.width;
    let top = root.height;
    let right = 0;
    let bottom = 0;
    for (const ch of kids) {
        const p = componentOutsetPadding(ch.type);
        left = Math.min(left, ch.x - p.l);
        top = Math.min(top, ch.y - p.t);
        right = Math.max(right, ch.x + ch.width + p.r);
        bottom = Math.max(bottom, ch.y + ch.height + p.b);
    }
    return {
        width: Math.max(1, Math.round(right - left)),
        height: Math.max(1, Math.round(bottom - top))
    };
}

function cloneComponentTree(comp: Component, used: Set<string>, idPrefix: string): Component {
    const c = JSON.parse(JSON.stringify(comp)) as Component;
    c.id = allocateUniqueId(used, idPrefix);
    used.add(c.id);
    if ("children" in c && Array.isArray((c as ContainerComponent).children)) {
        (c as ContainerComponent).children = (c as ContainerComponent).children.map(ch =>
            cloneComponentTree(ch, used, idPrefix)
        );
    }
    return c;
}

function allocateUniqueId(used: Set<string>, prefix: string): string {
    const base = toIdentifier(prefix) || "lib";
    for (let i = 1; i < 100000; i++) {
        const id = `${base}_${i}`;
        if (!used.has(id)) {
            return id;
        }
    }
    return `${base}_${Date.now()}`;
}

function normalizeRootForLibrary(root: ContainerComponent | PanelComponent): ContainerComponent | PanelComponent {
    const clone = JSON.parse(JSON.stringify(root)) as ContainerComponent | PanelComponent;
    const { width, height } = libraryBoundsForRoot(clone);
    const kids = clone.children ?? [];
    if (kids.length > 0) {
        let minX = Infinity;
        let minY = Infinity;
        for (const ch of kids) {
            const p = componentOutsetPadding(ch.type);
            minX = Math.min(minX, ch.x - p.l);
            minY = Math.min(minY, ch.y - p.t);
        }
        if (Number.isFinite(minX) && Number.isFinite(minY)) {
            for (const ch of kids) {
                ch.x = Math.round(ch.x - minX);
                ch.y = Math.round(ch.y - minY);
            }
        }
    }
    clone.x = 0;
    clone.y = 0;
    clone.width = width;
    clone.height = height;
    return clone;
}

export function ensureLibraryArray(project: EmbfProject): ComponentLibraryEntry[] {
    if (!project.componentLibrary) {
        project.componentLibrary = [];
    }
    return project.componentLibrary;
}

export type SaveToLibraryResult =
    | { ok: true; entryId: string }
    | { ok: false; reason: string };

/** Copy a page container/panel into `project.componentLibrary`. */
export function saveContainerToLibrary(
    project: EmbfProject,
    page: Page,
    containerId: string,
    libraryId: string,
    displayName: string
): SaveToLibraryResult {
    const id = libraryId.trim();
    const name = displayName.trim();
    if (!id) {
        return { ok: false, reason: "Library id is required." };
    }
    if (!name) {
        return { ok: false, reason: "Display name is required." };
    }

    const comp = findComponentOnPage(page, containerId);
    if (!comp) {
        return { ok: false, reason: "Widget not found on this page." };
    }
    if (comp.type !== "container" && comp.type !== "panel") {
        return { ok: false, reason: "Only a container or panel group can be saved to the library." };
    }

    const lib = ensureLibraryArray(project);
    if (lib.some(e => e.id === id)) {
        return { ok: false, reason: `Library id "${id}" already exists.` };
    }

    const root = normalizeRootForLibrary(comp as ContainerComponent | PanelComponent);
    const { width, height } = libraryBoundsForRoot(root);
    lib.push({
        id,
        name,
        width,
        height,
        root
    });
    return { ok: true, entryId: id };
}

export type InsertLibraryResult =
    | { ok: true; componentId: string }
    | { ok: false; reason: string };

function layoutSlotForLibrary(project: EmbfProject, page: Page, width: number, height: number): {
    x: number;
    y: number;
} {
    const n = page.components.length;
    const col = n % 4;
    const row = Math.floor(n / 4);
    let x = 12 + col * (width + 12);
    let y = 12 + row * (height + 12);
    const maxY = project.display.height - height - 8;
    if (y > maxY) {
        x = 12 + (n % 6) * (width + 8);
        y = 12;
    }
    return { x, y };
}

/** Place a library entry on a page (new ids, copy of subtree). */
export function insertLibraryOnPage(
    project: EmbfProject,
    page: Page,
    libraryId: string,
    at?: { x: number; y: number }
): InsertLibraryResult {
    const entry = project.componentLibrary?.find(e => e.id === libraryId);
    if (!entry) {
        return { ok: false, reason: `Library entry "${libraryId}" not found.` };
    }

    const used = collectAllComponentIds(project);
    const idPrefix = toIdentifier(entry.id);
    const root = cloneComponentTree(entry.root, used, idPrefix) as ContainerComponent | PanelComponent;
    const pos = at ?? layoutSlotForLibrary(project, page, entry.width, entry.height);
    root.x = Math.max(0, Math.round(pos.x));
    root.y = Math.max(0, Math.round(pos.y));
    root.width = entry.width;
    root.height = entry.height;

    page.components.push(root);
    return { ok: true, componentId: root.id };
}

export function removeLibraryEntry(project: EmbfProject, libraryId: string): boolean {
    const lib = project.componentLibrary;
    if (!lib?.length) {
        return false;
    }
    const before = lib.length;
    project.componentLibrary = lib.filter(e => e.id !== libraryId);
    return project.componentLibrary.length < before;
}
