import * as fs from "fs";
import * as path from "path";
import type { EmbfProject, LvglVersion } from "./types/embf";

export const SUPPORTED_VERSIONS: LvglVersion[] = [
    "8.4.0",
    "9.2.2",
    "9.3.0",
    "9.4.0",
    "9.5.0"
];

export class EmbfParseError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "EmbfParseError";
    }
}

export function parseEmbf(filePath: string): EmbfProject {
    let raw: string;
    try {
        raw = fs.readFileSync(filePath, "utf-8");
    } catch (e: any) {
        throw new EmbfParseError(`Cannot read file: ${e.message}`);
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch (e: any) {
        throw new EmbfParseError(`Invalid JSON: ${e.message}`);
    }

    return validateEmbf(parsed, filePath);
}

function validateEmbf(data: unknown, filePath: string): EmbfProject {
    if (typeof data !== "object" || data === null) {
        throw new EmbfParseError("Root must be a JSON object");
    }

    const obj = data as Record<string, unknown>;

    if (obj["version"] !== "1.0") {
        throw new EmbfParseError(`Unsupported version "${obj["version"]}". Expected "1.0"`);
    }

    const project = obj["project"];
    if (typeof project !== "object" || project === null) {
        throw new EmbfParseError("Missing or invalid 'project' section");
    }
    const projectObj = project as Record<string, unknown>;
    if (typeof projectObj["name"] !== "string" || !projectObj["name"]) {
        throw new EmbfParseError("project.name must be a non-empty string");
    }
    if (!SUPPORTED_VERSIONS.includes(projectObj["lvglVersion"] as LvglVersion)) {
        throw new EmbfParseError(
            `project.lvglVersion "${projectObj["lvglVersion"]}" is not supported. ` +
            `Supported: ${SUPPORTED_VERSIONS.join(", ")}`
        );
    }

    const display = obj["display"];
    if (typeof display !== "object" || display === null) {
        throw new EmbfParseError("Missing or invalid 'display' section");
    }
    const dispObj = display as Record<string, unknown>;
    if (typeof dispObj["width"] !== "number" || dispObj["width"] < 1) {
        throw new EmbfParseError("display.width must be a positive integer");
    }
    if (typeof dispObj["height"] !== "number" || dispObj["height"] < 1) {
        throw new EmbfParseError("display.height must be a positive integer");
    }
    if (![16, 24, 32].includes(dispObj["bitDepth"] as number)) {
        throw new EmbfParseError("display.bitDepth must be 16, 24, or 32");
    }

    if (!Array.isArray(obj["pages"]) || (obj["pages"] as unknown[]).length === 0) {
        throw new EmbfParseError("'pages' must be a non-empty array");
    }

    return data as EmbfProject;
}

export function resolveWasmVersion(lvglVersion: LvglVersion): string {
    // Map LVGL version to the exact wasm bundle filename version segment
    const mapping: Record<LvglVersion, string> = {
        "8.4.0": "v8.4.0",
        "9.2.2": "v9.2.2",
        "9.3.0": "v9.3.0",
        "9.4.0": "v9.4.0",
        "9.5.0": "v9.5.0"
    };
    return mapping[lvglVersion];
}

export function getEffectiveDisplaySize(
    project: EmbfProject
): { width: number; height: number } {
    const { width, height, orientation } = project.display;
    const isRotated = orientation === "landscape" || orientation === "landscape_flipped";
    // If the project was authored in portrait but needs landscape, swap
    if (isRotated && height > width) {
        return { width: height, height: width };
    }
    return { width, height };
}

export function watchEmbf(
    filePath: string,
    onChange: (project: EmbfProject | EmbfParseError) => void
): fs.FSWatcher {
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    const watcher = fs.watch(
        path.dirname(filePath),
        { persistent: false },
        (eventType, filename) => {
            if (filename !== path.basename(filePath)) {
                return;
            }
            if (debounceTimer) {
                clearTimeout(debounceTimer);
            }
            debounceTimer = setTimeout(() => {
                debounceTimer = null;
                try {
                    onChange(parseEmbf(filePath));
                } catch (e) {
                    onChange(e instanceof EmbfParseError ? e : new EmbfParseError(String(e)));
                }
            }, 150);
        }
    );

    return watcher;
}
