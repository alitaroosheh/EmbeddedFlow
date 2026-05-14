import type { Component, ComponentType, EmbfProject, Page } from "./types/embf";
import { isPaletteWidgetType } from "./embfPalette";

const PREFIX: Partial<Record<ComponentType, string>> = {
    label: "lbl",
    button: "btn",
    slider: "sld",
    switch: "sw",
    bar: "bar",
    arc: "arc",
    checkbox: "chk",
    dropdown: "dd",
    roller: "rol",
    textarea: "ta",
    line: "ln",
    image: "img",
    container: "box",
    panel: "pnl",
    spinner: "spin"
};

export function cloneEmbfProject(project: EmbfProject): EmbfProject {
    return JSON.parse(JSON.stringify(project)) as EmbfProject;
}

function walkComponents(components: Component[], out: Set<string>): void {
    for (const c of components) {
        out.add(c.id);
        if ("children" in c && Array.isArray((c as { children?: Component[] }).children)) {
            walkComponents((c as { children: Component[] }).children, out);
        }
    }
}

export function collectAllComponentIds(project: EmbfProject): Set<string> {
    const s = new Set<string>();
    for (const p of project.pages) {
        walkComponents(p.components, s);
    }
    return s;
}

function allocateId(ids: Set<string>, prefix: string): string {
    for (let i = 1; i < 100000; i++) {
        const id = `${prefix}_${i}`;
        if (!ids.has(id)) {
            return id;
        }
    }
    return `${prefix}_${Date.now()}`;
}

function layoutSlot(project: EmbfProject, page: Page): { x: number; y: number } {
    const n = page.components.length;
    const col = n % 4;
    const row = Math.floor(n / 4);
    const x = 12 + col * 96;
    const y = 12 + row * 44;
    const maxY = project.display.height - 48;
    if (y > maxY) {
        return { x: 12 + (n % 6) * 72, y: 12 };
    }
    return { x, y };
}

/**
 * Build a new component that satisfies `embfParser` deep validation for `widgetType`.
 */
export function buildNewComponent(project: EmbfProject, page: Page, widgetType: string): Component {
    const t = widgetType.trim().toLowerCase();
    if (!isPaletteWidgetType(t)) {
        throw new Error(`Unsupported palette widget: ${widgetType}`);
    }
    const ids = collectAllComponentIds(project);
    const prefix = PREFIX[t] ?? "w";
    const id = allocateId(ids, prefix);
    const { x, y } = layoutSlot(project, page);

    const base = (w: number, h: number): { id: string; x: number; y: number; width: number; height: number } => ({
        id,
        x,
        y,
        width: w,
        height: h
    });

    switch (t) {
        case "label":
            return {
                ...base(120, 28),
                type: "label",
                text: "Label"
            };
        case "button":
            return {
                ...base(88, 36),
                type: "button",
                label: "Button"
            };
        case "slider":
            return {
                ...base(140, 24),
                type: "slider",
                min: 0,
                max: 100,
                value: 50
            };
        case "switch":
            return {
                ...base(52, 28),
                type: "switch",
                checked: false
            };
        case "bar":
            return {
                ...base(140, 20),
                type: "bar",
                min: 0,
                max: 100,
                value: 40
            };
        case "arc":
            return {
                ...base(80, 80),
                type: "arc",
                min: 0,
                max: 100,
                value: 30
            };
        case "checkbox":
            return {
                ...base(140, 28),
                type: "checkbox",
                text: "Check",
                checked: false
            };
        case "dropdown":
            return {
                ...base(140, 36),
                type: "dropdown",
                options: ["One", "Two", "Three"],
                selectedIndex: 0
            };
        case "roller":
            return {
                ...base(100, 120),
                type: "roller",
                options: ["A", "B", "C"],
                selectedIndex: 0
            };
        case "textarea":
            return {
                ...base(160, 72),
                type: "textarea",
                text: ""
            };
        case "line":
            return {
                ...base(80, 40),
                type: "line",
                points: [
                    { x: 0, y: 0 },
                    { x: 72, y: 0 }
                ]
            };
        case "image":
            return {
                ...base(64, 64),
                type: "image",
                src: "placeholder.png"
            };
        case "container":
            return {
                ...base(160, 120),
                type: "container",
                layout: "none",
                children: []
            };
        case "panel":
            return {
                ...base(160, 120),
                type: "panel",
                children: []
            };
        case "spinner":
            return {
                ...base(48, 48),
                type: "spinner",
                speed: 1000,
                arcLength: 60
            };
        default:
            throw new Error(`Unhandled widget type: ${t}`);
    }
}
