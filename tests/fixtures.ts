import type { EmbfProject, DisplayConfig, Page } from "../src/types/embf";

const defaultDisplay: DisplayConfig = {
    width: 800,
    height: 600,
    bitDepth: 32,
    colorFormat: "ARGB8888",
    orientation: "landscape",
    direction: "ltr"
};

const defaultPage: Page = {
    id: "page_main",
    name: "Main",
    components: [
        {
            id: "lbl_a",
            type: "label",
            x: 0,
            y: 0,
            width: 40,
            height: 16,
            text: "A"
        }
    ]
};

/** Minimal valid project for tests (passes `parseEmbfSource`). Always returns a deep clone. */
export function minimalProject(overrides?: {
    display?: Partial<DisplayConfig>;
    pages?: Page[];
}): EmbfProject {
    const display = { ...defaultDisplay, ...overrides?.display };
    const pages = overrides?.pages
        ? clone(overrides.pages)
        : [clone(defaultPage)];
    return {
        version: "1.0",
        project: { name: "Test", lvglVersion: "9.5.0" },
        display,
        pages
    };
}

function clone<T>(v: T): T {
    return JSON.parse(JSON.stringify(v));
}
