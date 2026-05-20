import { EmbfProject, LvglVersion } from "./types/embf";

/** Sanitize project name for use as `.embf` filename (without extension). */
export function sanitizeProjectFileName(name: string): string {
    const trimmed = name.trim();
    const safe = trimmed.replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "");
    return safe || "MyDisplay";
}

export function buildNewProjectTemplate(name: string, lvglVersion: LvglVersion): EmbfProject {
    return {
        version: "1.0",
        project: {
            name: name.trim(),
            lvglVersion,
            description: ""
        },
        display: {
            width: 320,
            height: 240,
            bitDepth: 16,
            colorFormat: "RGB565",
            orientation: "landscape",
            direction: "ltr",
            dpi: 100
        },
        theme: {
            dark: false
        },
        pages: [
            {
                id: "page_main",
                name: "Main",
                components: [
                    {
                        id: "lbl_hello",
                        type: "label",
                        x: 10,
                        y: 10,
                        width: 200,
                        height: 30,
                        text: "Hello, EmbeddedFlow!"
                    }
                ]
            }
        ]
    };
}
