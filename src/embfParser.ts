import * as fs from "fs";
import * as path from "path";
import type { EmbfProject, LvglVersion } from "./types/embf";

const COLOR_FORMATS = new Set<string>(["RGB565", "RGB888", "ARGB8888", "L8", "AL88"]);
const ORIENTATIONS = new Set<string>([
    "portrait",
    "landscape",
    "portrait_flipped",
    "landscape_flipped"
]);
const TEXT_DIRECTIONS = new Set<string>(["ltr", "rtl"]);
const COMPONENT_TYPES = new Set<string>([
    "label",
    "button",
    "image",
    "slider",
    "switch",
    "bar",
    "spinner",
    "arc",
    "checkbox",
    "dropdown",
    "roller",
    "textarea",
    "line",
    "container",
    "panel"
]);
const EVENT_TRIGGERS = new Set<string>(["clicked", "long_pressed", "value_changed"]);

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

    return parseEmbfSource(raw);
}

/** Parse and validate `.embf` JSON from a string (e.g. unsaved editor buffer). */
export function parseEmbfSource(content: string): EmbfProject {
    let parsed: unknown;
    try {
        parsed = JSON.parse(content);
    } catch (e: any) {
        throw new EmbfParseError(`Invalid JSON: ${e.message}`);
    }
    return validateEmbf(parsed);
}

function validateEmbf(data: unknown): EmbfProject {
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
    if (projectObj["description"] !== undefined && typeof projectObj["description"] !== "string") {
        throw new EmbfParseError("project.description must be a string when set");
    }
    if (projectObj["outputPath"] !== undefined) {
        const op = projectObj["outputPath"];
        if (typeof op !== "string" || !op.trim()) {
            throw new EmbfParseError("project.outputPath must be a non-empty string when set");
        }
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

    const cf = dispObj["colorFormat"];
    if (typeof cf !== "string" || !COLOR_FORMATS.has(cf)) {
        throw new EmbfParseError(
            `display.colorFormat must be one of: ${[...COLOR_FORMATS].join(", ")}`
        );
    }
    const ori = dispObj["orientation"];
    if (typeof ori !== "string" || !ORIENTATIONS.has(ori)) {
        throw new EmbfParseError(
            `display.orientation must be one of: ${[...ORIENTATIONS].join(", ")}`
        );
    }
    const dir = dispObj["direction"];
    if (typeof dir !== "string" || !TEXT_DIRECTIONS.has(dir)) {
        throw new EmbfParseError(`display.direction must be "ltr" or "rtl"`);
    }
    if (dispObj["dpi"] !== undefined) {
        const dpi = dispObj["dpi"];
        if (typeof dpi !== "number" || dpi < 1 || !Number.isFinite(dpi)) {
            throw new EmbfParseError("display.dpi must be a positive number when set");
        }
    }
    if (dispObj["round"] !== undefined && typeof dispObj["round"] !== "boolean") {
        throw new EmbfParseError("display.round must be a boolean when set");
    }

    const theme = obj["theme"];
    if (theme !== undefined) {
        if (typeof theme !== "object" || theme === null) {
            throw new EmbfParseError("'theme' must be an object when present");
        }
        const th = theme as Record<string, unknown>;
        if (typeof th["dark"] !== "boolean") {
            throw new EmbfParseError("theme.dark must be a boolean");
        }
        for (const col of ["primaryColor", "secondaryColor"] as const) {
            if (th[col] !== undefined && typeof th[col] !== "string") {
                throw new EmbfParseError(`theme.${col} must be a string when set`);
            }
        }
    }

    if (!Array.isArray(obj["pages"]) || (obj["pages"] as unknown[]).length === 0) {
        throw new EmbfParseError("'pages' must be a non-empty array");
    }

    validatePagesDeep(obj["pages"] as unknown[]);

    return data as EmbfProject;
}

function isFiniteNumber(n: unknown): n is number {
    return typeof n === "number" && Number.isFinite(n);
}

function validateOptionalEvents(o: Record<string, unknown>, path: string): void {
    if (o["events"] === undefined) {
        return;
    }
    if (!Array.isArray(o["events"])) {
        throw new EmbfParseError(`${path}.events must be an array`);
    }
    const evs = o["events"] as unknown[];
    for (let i = 0; i < evs.length; i++) {
        const evPath = `${path}.events[${i}]`;
        const ev = evs[i];
        if (typeof ev !== "object" || ev === null) {
            throw new EmbfParseError(`${evPath} must be an object`);
        }
        const evo = ev as Record<string, unknown>;
        if (typeof evo["trigger"] !== "string" || !EVENT_TRIGGERS.has(evo["trigger"])) {
            throw new EmbfParseError(
                `${evPath}.trigger must be one of: clicked, long_pressed, value_changed`
            );
        }
        if (!Array.isArray(evo["actions"])) {
            throw new EmbfParseError(`${evPath}.actions must be an array`);
        }
        const acts = evo["actions"] as unknown[];
        for (let ai = 0; ai < acts.length; ai++) {
            const a = acts[ai];
            if (typeof a !== "object" || a === null) {
                throw new EmbfParseError(`${evPath}.actions[${ai}] must be an object`);
            }
            const ao = a as Record<string, unknown>;
            if (typeof ao["type"] !== "string") {
                throw new EmbfParseError(`${evPath}.actions[${ai}].type must be a string`);
            }
            validateEventActionShape(ao, `${evPath}.actions[${ai}]`);
        }
    }
}

function validateEventActionShape(action: Record<string, unknown>, ap: string): void {
    const ty = action["type"] as string;
    const needTarget = (label: string) => {
        if (typeof action["target"] !== "string" || !action["target"].trim()) {
            throw new EmbfParseError(`${ap}: ${label} requires non-empty string "target"`);
        }
    };

    switch (ty) {
        case "navigate":
            needTarget("navigate");
            break;
        case "set_text":
            needTarget("set_text");
            if (typeof action["text"] !== "string") {
                throw new EmbfParseError(`${ap}: set_text requires string "text"`);
            }
            break;
        case "set_value":
            needTarget("set_value");
            if (!isFiniteNumber(action["value"])) {
                throw new EmbfParseError(`${ap}: set_value requires finite numeric "value"`);
            }
            break;
        case "set_checked":
            needTarget("set_checked");
            if (typeof action["checked"] !== "boolean") {
                throw new EmbfParseError(`${ap}: set_checked requires boolean "checked"`);
            }
            break;
        case "set_hidden":
            needTarget("set_hidden");
            if (typeof action["hidden"] !== "boolean") {
                throw new EmbfParseError(`${ap}: set_hidden requires boolean "hidden"`);
            }
            break;
        case "set_theme":
            if (action["dark"] !== undefined && typeof action["dark"] !== "boolean") {
                throw new EmbfParseError(`${ap}: set_theme "dark" must be a boolean when set`);
            }
            break;
        default:
            throw new EmbfParseError(`${ap}: unknown action type "${ty}"`);
    }
}

function validateComponentDeep(comp: unknown, path: string): void {
    if (typeof comp !== "object" || comp === null) {
        throw new EmbfParseError(`${path} must be an object`);
    }
    const o = comp as Record<string, unknown>;

    if (typeof o["id"] !== "string" || !o["id"].trim()) {
        throw new EmbfParseError(`${path}.id must be a non-empty string`);
    }
    if (typeof o["type"] !== "string" || !COMPONENT_TYPES.has(o["type"])) {
        throw new EmbfParseError(
            `${path}.type must be a known widget type (got ${JSON.stringify(o["type"])})`
        );
    }
    for (const key of ["x", "y", "width", "height"] as const) {
        if (!isFiniteNumber(o[key])) {
            throw new EmbfParseError(`${path}.${key} must be a finite number`);
        }
    }

    validateOptionalEvents(o, path);

    if (o["hidden"] !== undefined && typeof o["hidden"] !== "boolean") {
        throw new EmbfParseError(`${path}.hidden must be a boolean when set`);
    }

    validateOptionalStyles(o, path);

    const t = o["type"] as string;
    switch (t) {
        case "label": {
            if (typeof o["text"] !== "string") {
                throw new EmbfParseError(`${path}.text must be a string`);
            }
            if (o["longMode"] !== undefined) {
                const lm = o["longMode"];
                if (lm !== "wrap" && lm !== "dot" && lm !== "scroll" && lm !== "clip") {
                    throw new EmbfParseError(`${path}.longMode must be wrap, dot, scroll, or clip`);
                }
            }
            break;
        }
        case "button":
            if (o["label"] !== undefined && typeof o["label"] !== "string") {
                throw new EmbfParseError(`${path}.label must be a string when set`);
            }
            break;
        case "image":
            if (typeof o["src"] !== "string" || !o["src"]) {
                throw new EmbfParseError(`${path}.src must be a non-empty string`);
            }
            break;
        case "slider":
        case "bar":
        case "arc": {
            for (const k of ["min", "max", "value"] as const) {
                if (!isFiniteNumber(o[k])) {
                    throw new EmbfParseError(`${path}.${k} must be a finite number`);
                }
            }
            if (t === "bar" && o["mode"] !== undefined) {
                const m = o["mode"];
                if (m !== "normal" && m !== "symmetrical" && m !== "range") {
                    throw new EmbfParseError(`${path}.mode must be normal, symmetrical, or range`);
                }
            }
            if (t === "arc") {
                if (o["startAngle"] !== undefined && !isFiniteNumber(o["startAngle"])) {
                    throw new EmbfParseError(`${path}.startAngle must be a finite number`);
                }
                if (o["endAngle"] !== undefined && !isFiniteNumber(o["endAngle"])) {
                    throw new EmbfParseError(`${path}.endAngle must be a finite number`);
                }
                if (o["mode"] !== undefined) {
                    const m = o["mode"];
                    if (m !== "normal" && m !== "reverse" && m !== "symmetrical") {
                        throw new EmbfParseError(`${path}.mode must be normal, reverse, or symmetrical`);
                    }
                }
            }
            break;
        }
        case "switch":
        case "checkbox":
            if (typeof o["checked"] !== "boolean") {
                throw new EmbfParseError(`${path}.checked must be a boolean`);
            }
            if (t === "checkbox" && o["text"] !== undefined && typeof o["text"] !== "string") {
                throw new EmbfParseError(`${path}.text must be a string when set`);
            }
            break;
        case "dropdown":
        case "roller": {
            if (!Array.isArray(o["options"])) {
                throw new EmbfParseError(`${path}.options must be an array`);
            }
            const opts = o["options"] as unknown[];
            for (let i = 0; i < opts.length; i++) {
                if (typeof opts[i] !== "string") {
                    throw new EmbfParseError(`${path}.options[${i}] must be a string`);
                }
            }
            if (!isFiniteNumber(o["selectedIndex"])) {
                throw new EmbfParseError(`${path}.selectedIndex must be a finite number`);
            }
            if (t === "roller" && o["mode"] !== undefined) {
                const m = o["mode"];
                if (m !== "normal" && m !== "infinite") {
                    throw new EmbfParseError(`${path}.mode must be normal or infinite`);
                }
            }
            break;
        }
        case "textarea":
            if (o["text"] !== undefined && typeof o["text"] !== "string") {
                throw new EmbfParseError(`${path}.text must be a string when set`);
            }
            if (o["placeholder"] !== undefined && typeof o["placeholder"] !== "string") {
                throw new EmbfParseError(`${path}.placeholder must be a string when set`);
            }
            if (o["oneLine"] !== undefined && typeof o["oneLine"] !== "boolean") {
                throw new EmbfParseError(`${path}.oneLine must be a boolean when set`);
            }
            break;
        case "line": {
            if (!Array.isArray(o["points"])) {
                throw new EmbfParseError(`${path}.points must be an array`);
            }
            const pts = o["points"] as unknown[];
            for (let i = 0; i < pts.length; i++) {
                const pt = pts[i];
                if (typeof pt !== "object" || pt === null) {
                    throw new EmbfParseError(`${path}.points[${i}] must be an object`);
                }
                const pto = pt as Record<string, unknown>;
                if (!isFiniteNumber(pto["x"]) || !isFiniteNumber(pto["y"])) {
                    throw new EmbfParseError(`${path}.points[${i}] must have finite numeric x and y`);
                }
            }
            if (o["rounded"] !== undefined && typeof o["rounded"] !== "boolean") {
                throw new EmbfParseError(`${path}.rounded must be a boolean when set`);
            }
            break;
        }
        case "spinner":
            if (o["speed"] !== undefined && !isFiniteNumber(o["speed"])) {
                throw new EmbfParseError(`${path}.speed must be a finite number when set`);
            }
            if (o["arcLength"] !== undefined && !isFiniteNumber(o["arcLength"])) {
                throw new EmbfParseError(`${path}.arcLength must be a finite number when set`);
            }
            break;
        case "container":
        case "panel": {
            if (!Array.isArray(o["children"])) {
                throw new EmbfParseError(`${path}.children must be an array`);
            }
            const kids = o["children"] as unknown[];
            for (let i = 0; i < kids.length; i++) {
                validateComponentDeep(kids[i], `${path}.children[${i}]`);
            }
            if (t === "container") {
                if (o["layout"] !== undefined) {
                    const ly = o["layout"];
                    if (ly !== "none" && ly !== "flex" && ly !== "grid") {
                        throw new EmbfParseError(`${path}.layout must be none, flex, or grid`);
                    }
                }
                if (o["flexFlow"] !== undefined) {
                    const ff = o["flexFlow"];
                    if (ff !== "row" && ff !== "column" && ff !== "row_wrap" && ff !== "column_wrap") {
                        throw new EmbfParseError(
                            `${path}.flexFlow must be row, column, row_wrap, or column_wrap`
                        );
                    }
                }
            }
            break;
        }
        default:
            break;
    }
}

const ALIGN_VALUES = new Set<string>(["left", "center", "right"]);

function validateOptionalStyles(o: Record<string, unknown>, path: string): void {
    if (o["styles"] === undefined) {
        return;
    }
    const raw = o["styles"];
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
        throw new EmbfParseError(`${path}.styles must be an object`);
    }
    const st = raw as Record<string, unknown>;

    function needStr(prop: string, v: unknown): string {
        if (typeof v !== "string") {
            throw new EmbfParseError(`${path}.styles.${prop} must be a string`);
        }
        return v;
    }

    function needFinNum(prop: string, v: unknown): number {
        if (!isFiniteNumber(v)) {
            throw new EmbfParseError(`${path}.styles.${prop} must be a finite number`);
        }
        return v as number;
    }

    function needUint(prop: string, v: unknown): number {
        const n = needFinNum(prop, v);
        if (n < 0 || Math.floor(n) !== n) {
            throw new EmbfParseError(`${path}.styles.${prop} must be a non-negative integer`);
        }
        return n;
    }

    const allowedKeys = new Set([
        "bgColor",
        "indicatorColor",
        "bgOpacity",
        "textColor",
        "borderColor",
        "borderWidth",
        "borderRadius",
        "padding",
        "fontSize",
        "fontFamily",
        "align"
    ]);
    for (const key of Object.keys(st)) {
        if (!allowedKeys.has(key)) {
            throw new EmbfParseError(
                `${path}.styles has unknown property "${key}" (allowed: ${[...allowedKeys].join(", ")})`
            );
        }
    }

    if (st["bgColor"] !== undefined) {
        void needStr("bgColor", st["bgColor"]);
    }
    if (st["indicatorColor"] !== undefined) {
        void needStr("indicatorColor", st["indicatorColor"]);
    }
    if (st["bgOpacity"] !== undefined) {
        const a = needFinNum("bgOpacity", st["bgOpacity"]);
        if (a < 0 || a > 255) {
            throw new EmbfParseError(`${path}.styles.bgOpacity must be between 0 and 255`);
        }
    }
    if (st["textColor"] !== undefined) {
        void needStr("textColor", st["textColor"]);
    }
    if (st["borderColor"] !== undefined) {
        void needStr("borderColor", st["borderColor"]);
    }
    if (st["borderWidth"] !== undefined) {
        void needUint("borderWidth", st["borderWidth"]);
    }
    if (st["borderRadius"] !== undefined) {
        void needUint("borderRadius", st["borderRadius"]);
    }
    if (st["padding"] !== undefined) {
        const pd = st["padding"];
        if (typeof pd === "number") {
            if (!Number.isInteger(pd) || pd < 0) {
                throw new EmbfParseError(`${path}.styles.padding integer must be >= 0`);
            }
        } else if (Array.isArray(pd)) {
            const arr = pd as unknown[];
            if (arr.length < 2 || arr.length > 4) {
                throw new EmbfParseError(
                    `${path}.styles.padding array must have 2, 3, or 4 elements`
                );
            }
            for (let i = 0; i < arr.length; i++) {
                if (!Number.isInteger(arr[i]) || (arr[i] as number) < 0) {
                    throw new EmbfParseError(
                        `${path}.styles.padding[${i}] must be a non-negative integer`
                    );
                }
            }
        } else {
            throw new EmbfParseError(
                `${path}.styles.padding must be a non-negative integer or integer array`
            );
        }
    }
    if (st["fontSize"] !== undefined) {
        const fs = needUint("fontSize", st["fontSize"]);
        if (fs < 4) {
            throw new EmbfParseError(`${path}.styles.fontSize must be >= 4`);
        }
    }
    if (st["fontFamily"] !== undefined) {
        void needStr("fontFamily", st["fontFamily"]);
    }
    if (st["align"] !== undefined) {
        const al = st["align"];
        if (typeof al !== "string" || !ALIGN_VALUES.has(al)) {
            throw new EmbfParseError(`${path}.styles.align must be left, center, or right`);
        }
    }
}

function validatePagesDeep(pages: unknown[]): void {
    pages.forEach((page, pi) => {
        const path = `pages[${pi}]`;
        if (typeof page !== "object" || page === null) {
            throw new EmbfParseError(`${path} must be an object`);
        }
        const p = page as Record<string, unknown>;
        if (typeof p["id"] !== "string" || !p["id"].trim()) {
            throw new EmbfParseError(`${path}.id must be a non-empty string`);
        }
        if (typeof p["name"] !== "string" || !p["name"].trim()) {
            throw new EmbfParseError(`${path}.name must be a non-empty string`);
        }
        if (p["backgroundColor"] !== undefined && typeof p["backgroundColor"] !== "string") {
            throw new EmbfParseError(`${path}.backgroundColor must be a string when set`);
        }
        if (!Array.isArray(p["components"])) {
            throw new EmbfParseError(`${path}.components must be an array`);
        }
        (p["components"] as unknown[]).forEach((c, ci) => {
            validateComponentDeep(c, `${path}.components[${ci}]`);
        });
    });
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

/**
 * Logical framebuffer size for preview (and any tooling that needs physical aspect).
 * - **Landscape** modes: wider than tall — swap JSON width/height when height > width.
 * - **Portrait** modes: taller than wide — swap when width > height.
 * JSON may still list the panel’s row/column resolution in either order.
 */
export function getEffectiveDisplaySize(
    project: EmbfProject
): { width: number; height: number } {
    const { width: w, height: h, orientation } = project.display;
    const landscape = orientation === "landscape" || orientation === "landscape_flipped";
    const portrait = orientation === "portrait" || orientation === "portrait_flipped";
    if (landscape && h > w) {
        return { width: h, height: w };
    }
    if (portrait && w > h) {
        return { width: h, height: w };
    }
    return { width: w, height: h };
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
