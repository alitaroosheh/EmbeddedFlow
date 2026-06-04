import * as fs from "fs";
import * as path from "path";
import { normalizeScreenLoadAnim } from "./codeGen/screenLoadAnim";
import { validateModelPropertyDeep } from "./embfModel";
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
    "knob",
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

/** Module-scoped context filled by {@link validateEmbf} and read by deep validators. */
const componentContext: {
    styleIds: Set<string>;
    fieldIds: Set<string>;
} = {
    styleIds: new Set(),
    fieldIds: new Set()
};

function resetComponentContext(): void {
    componentContext.styleIds = new Set();
    componentContext.fieldIds = new Set();
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
    resetComponentContext();
    if (typeof data !== "object" || data === null) {
        throw new EmbfParseError("Root must be a JSON object");
    }

    const obj = data as Record<string, unknown>;

    if (obj["version"] === undefined || obj["version"] === null) {
        obj["version"] = "1.0";
    } else if (obj["version"] !== "1.0") {
        throw new EmbfParseError(
            `Unsupported version "${obj["version"]}". Expected "1.0". Open the file in a text editor and set "version": "1.0", or wait for a future migration.`
        );
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
    if (projectObj["lvglInclude"] !== undefined) {
        const inc = projectObj["lvglInclude"];
        if (inc !== "lvgl.h" && inc !== "lvgl/lvgl.h") {
            throw new EmbfParseError('project.lvglInclude must be "lvgl.h" or "lvgl/lvgl.h" when set');
        }
    }
    if (projectObj["stringsPath"] !== undefined) {
        const sp = projectObj["stringsPath"];
        if (typeof sp !== "string" || !sp.trim()) {
            throw new EmbfParseError("project.stringsPath must be a non-empty string when set");
        }
        if (!/\.res$/i.test(sp.trim())) {
            throw new EmbfParseError("project.stringsPath must use the .res extension");
        }
    }
    if (projectObj["firmwarePath"] !== undefined) {
        const fp = projectObj["firmwarePath"];
        if (typeof fp !== "string" || !fp.trim()) {
            throw new EmbfParseError("project.firmwarePath must be a non-empty string when set");
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

    const images = obj["images"];
    if (images !== undefined) {
        if (!Array.isArray(images)) {
            throw new EmbfParseError("'images' must be an array when present");
        }
        images.forEach((entry, i) => validateImageDefDeep(entry, `images[${i}]`));
    }

    const fonts = obj["fonts"];
    if (fonts !== undefined) {
        if (!Array.isArray(fonts)) {
            throw new EmbfParseError("'fonts' must be an array when present");
        }
        const ids = new Set<string>();
        fonts.forEach((entry, i) => {
            const p = `fonts[${i}]`;
            validateFontDefDeep(entry, p);
            const id = (entry as Record<string, unknown>)["id"] as string;
            if (ids.has(id)) {
                throw new EmbfParseError(`${p}.id "${id}" duplicates an earlier font entry`);
            }
            ids.add(id);
        });
    }

    const styles = obj["styles"];
    const styleIds = new Set<string>();
    if (styles !== undefined) {
        if (!Array.isArray(styles)) {
            throw new EmbfParseError("'styles' must be an array when present");
        }
        styles.forEach((entry, i) => {
            const p = `styles[${i}]`;
            validateStyleDefDeep(entry, p);
            const id = (entry as Record<string, unknown>)["id"] as string;
            if (styleIds.has(id)) {
                throw new EmbfParseError(`${p}.id "${id}" duplicates an earlier style entry`);
            }
            styleIds.add(id);
        });
    }
    componentContext.styleIds = styleIds;

    const fieldIds = new Set<string>();

    const dataModel = obj["dataModel"];
    if (dataModel !== undefined) {
        if (typeof dataModel !== "object" || dataModel === null || Array.isArray(dataModel)) {
            throw new EmbfParseError("'dataModel' must be an object when present");
        }
        const dm = dataModel as Record<string, unknown>;
        if (!Array.isArray(dm["fields"])) {
            throw new EmbfParseError("dataModel.fields must be an array");
        }
        (dm["fields"] as unknown[]).forEach((entry, i) => {
            const p = `dataModel.fields[${i}]`;
            validateDataFieldDeep(entry, p);
            const id = (entry as Record<string, unknown>)["id"] as string;
            if (fieldIds.has(id)) {
                throw new EmbfParseError(`${p}.id "${id}" duplicates an earlier property id`);
            }
            fieldIds.add(id);
        });
    }

    const model = obj["model"];
    if (model !== undefined) {
        if (typeof model !== "object" || model === null || Array.isArray(model)) {
            throw new EmbfParseError("'model' must be an object when present");
        }
        const m = model as Record<string, unknown>;
        const props = m["properties"];
        if (props !== undefined) {
            if (!Array.isArray(props)) {
                throw new EmbfParseError("model.properties must be an array");
            }
            (props as unknown[]).forEach((entry, i) => {
                const p = `model.properties[${i}]`;
                try {
                    validateModelPropertyDeep(entry, p);
                } catch (e) {
                    throw new EmbfParseError(e instanceof Error ? e.message : String(e));
                }
                const id = (entry as Record<string, unknown>)["id"] as string;
                if (fieldIds.has(id)) {
                    throw new EmbfParseError(`${p}.id "${id}" duplicates an earlier property id`);
                }
                fieldIds.add(id);
            });
        }
        const derived = m["derived"];
        if (derived !== undefined && !Array.isArray(derived)) {
            throw new EmbfParseError("model.derived must be an array when present");
        }
    }

    componentContext.fieldIds = fieldIds;

    validatePagesDeep(obj["pages"] as unknown[]);

    const lib = obj["componentLibrary"];
    if (lib !== undefined) {
        if (!Array.isArray(lib)) {
            throw new EmbfParseError("'componentLibrary' must be an array when present");
        }
        lib.forEach((entry, i) => validateLibraryEntryDeep(entry, `componentLibrary[${i}]`));
    }

    return data as EmbfProject;
}

function validateImageDefDeep(entry: unknown, path: string): void {
    if (typeof entry !== "object" || entry === null) {
        throw new EmbfParseError(`${path} must be an object`);
    }
    const o = entry as Record<string, unknown>;
    if (typeof o["id"] !== "string" || !o["id"].trim()) {
        throw new EmbfParseError(`${path}.id must be a non-empty string`);
    }
    if (typeof o["path"] !== "string" || !o["path"].trim()) {
        throw new EmbfParseError(`${path}.path must be a non-empty string`);
    }
}

function validateStyleDefDeep(entry: unknown, path: string): void {
    if (typeof entry !== "object" || entry === null) {
        throw new EmbfParseError(`${path} must be an object`);
    }
    const o = entry as Record<string, unknown>;
    if (typeof o["id"] !== "string" || !(o["id"] as string).trim()) {
        throw new EmbfParseError(`${path}.id must be a non-empty string`);
    }
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(o["id"] as string)) {
        throw new EmbfParseError(`${path}.id must be a valid C identifier`);
    }
    if (o["name"] !== undefined && (typeof o["name"] !== "string" || !(o["name"] as string).trim())) {
        throw new EmbfParseError(`${path}.name must be a non-empty string when set`);
    }
    if (typeof o["props"] !== "object" || o["props"] === null || Array.isArray(o["props"])) {
        throw new EmbfParseError(`${path}.props must be an object`);
    }
    validateStylePropsObject(o["props"], `${path}.props`);
}

const DATA_FIELD_TYPES = new Set<string>(["string", "int", "float", "bool"]);

function validateDataFieldDeep(entry: unknown, path: string): void {
    if (typeof entry !== "object" || entry === null) {
        throw new EmbfParseError(`${path} must be an object`);
    }
    const o = entry as Record<string, unknown>;
    if (typeof o["id"] !== "string" || !(o["id"] as string).trim()) {
        throw new EmbfParseError(`${path}.id must be a non-empty string`);
    }
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(o["id"] as string)) {
        throw new EmbfParseError(`${path}.id must be a valid C identifier`);
    }
    const ty = o["type"];
    if (typeof ty !== "string" || !DATA_FIELD_TYPES.has(ty)) {
        throw new EmbfParseError(
            `${path}.type must be one of: ${[...DATA_FIELD_TYPES].join(", ")}`
        );
    }
    if (o["default"] !== undefined) {
        const def = o["default"];
        switch (ty) {
            case "string":
                if (typeof def !== "string") {
                    throw new EmbfParseError(`${path}.default must be a string`);
                }
                break;
            case "int":
                if (!Number.isFinite(def) || !Number.isInteger(def as number)) {
                    throw new EmbfParseError(`${path}.default must be an integer`);
                }
                break;
            case "float":
                if (!Number.isFinite(def)) {
                    throw new EmbfParseError(`${path}.default must be a finite number`);
                }
                break;
            case "bool":
                if (typeof def !== "boolean") {
                    throw new EmbfParseError(`${path}.default must be a boolean`);
                }
                break;
        }
    }
}

function validateFontDefDeep(entry: unknown, path: string): void {
    if (typeof entry !== "object" || entry === null) {
        throw new EmbfParseError(`${path} must be an object`);
    }
    const o = entry as Record<string, unknown>;
    if (typeof o["id"] !== "string" || !(o["id"] as string).trim()) {
        throw new EmbfParseError(`${path}.id must be a non-empty string`);
    }
    if (typeof o["name"] !== "string" || !(o["name"] as string).trim()) {
        throw new EmbfParseError(`${path}.name must be a non-empty C identifier (e.g. lv_font_montserrat_24)`);
    }
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(o["name"] as string)) {
        throw new EmbfParseError(
            `${path}.name "${o["name"]}" is not a valid C identifier`
        );
    }
    if (typeof o["size"] !== "number" || !Number.isFinite(o["size"] as number) || (o["size"] as number) < 1) {
        throw new EmbfParseError(`${path}.size must be a positive number`);
    }
    if (o["source"] !== undefined && (typeof o["source"] !== "string" || !(o["source"] as string).trim())) {
        throw new EmbfParseError(`${path}.source must be a non-empty string when set`);
    }
}

function validateLibraryEntryDeep(entry: unknown, path: string): void {
    if (typeof entry !== "object" || entry === null) {
        throw new EmbfParseError(`${path} must be an object`);
    }
    const o = entry as Record<string, unknown>;
    if (typeof o["id"] !== "string" || !o["id"].trim()) {
        throw new EmbfParseError(`${path}.id must be a non-empty string`);
    }
    if (typeof o["name"] !== "string" || !o["name"].trim()) {
        throw new EmbfParseError(`${path}.name must be a non-empty string`);
    }
    for (const key of ["width", "height"] as const) {
        if (!isFiniteNumber(o[key]) || o[key] < 1) {
            throw new EmbfParseError(`${path}.${key} must be a positive number`);
        }
    }
    const root = o["root"];
    if (typeof root !== "object" || root === null) {
        throw new EmbfParseError(`${path}.root must be an object`);
    }
    const rt = (root as Record<string, unknown>)["type"];
    if (rt !== "container" && rt !== "panel") {
        throw new EmbfParseError(`${path}.root.type must be container or panel`);
    }
    validateComponentDeep(root, `${path}.root`);
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

    const needRoute = (label: string) => {
        const v = action["route"];
        if (typeof v !== "string" || !v.trim()) {
            throw new EmbfParseError(`${ap}: ${label} requires non-empty string "route"`);
        }
    };

    const validateNavTransitionFields = () => {
        if (action["anim"] !== undefined && !normalizeScreenLoadAnim(action["anim"])) {
            throw new EmbfParseError(`${ap}: "anim" must be a known screen load animation id`);
        }
        if (action["time"] !== undefined && !isFiniteNumber(action["time"])) {
            throw new EmbfParseError(`${ap}: "time" must be a finite number (ms)`);
        }
        if (action["delay"] !== undefined && !isFiniteNumber(action["delay"])) {
            throw new EmbfParseError(`${ap}: "delay" must be a finite number (ms)`);
        }
        if (action["autoDel"] !== undefined && typeof action["autoDel"] !== "boolean") {
            throw new EmbfParseError(`${ap}: "autoDel" must be a boolean`);
        }
    };

    switch (ty) {
        case "navigate":
            needTarget("navigate");
            validateNavTransitionFields();
            break;
        case "nav_push":
            needRoute("nav_push");
            validateNavTransitionFields();
            break;
        case "nav_pop":
            validateNavTransitionFields();
            break;
        case "nav_replace":
        case "nav_reset":
            needRoute(ty);
            validateNavTransitionFields();
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
    validateOptionalStyleRefs(o, path);
    validateOptionalAnimations(o, path);
    validateOptionalBindings(o, path);
    validateOptionalScroll(o, path);

    const t = o["type"] as string;
    switch (t) {
        case "label": {
            if (typeof o["text"] !== "string") {
                throw new EmbfParseError(`${path}.text must be a string`);
            }
            validateBindingTemplates(o["text"] as string, `${path}.text`);
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
        case "arc":
        case "knob": {
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
            if (t === "knob") {
                if (o["startAngle"] !== undefined && !isFiniteNumber(o["startAngle"])) {
                    throw new EmbfParseError(`${path}.startAngle must be a finite number`);
                }
                if (o["endAngle"] !== undefined && !isFiniteNumber(o["endAngle"])) {
                    throw new EmbfParseError(`${path}.endAngle must be a finite number`);
                }
                if (o["indicatorColor"] !== undefined && typeof o["indicatorColor"] !== "string") {
                    throw new EmbfParseError(`${path}.indicatorColor must be a string when set`);
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

const ANIMATION_PROPERTIES = new Set<string>(["x", "y", "width", "height", "opacity"]);
const ANIMATION_EASINGS = new Set<string>([
    "linear",
    "ease_in",
    "ease_out",
    "ease_in_out",
    "overshoot",
    "bounce",
    "step"
]);

function validateOptionalStyleRefs(o: Record<string, unknown>, path: string): void {
    if (o["styleRefs"] === undefined) {
        return;
    }
    const raw = o["styleRefs"];
    if (!Array.isArray(raw)) {
        throw new EmbfParseError(`${path}.styleRefs must be an array of style ids`);
    }
    for (let i = 0; i < raw.length; i++) {
        const v = raw[i];
        if (typeof v !== "string" || !v.trim()) {
            throw new EmbfParseError(`${path}.styleRefs[${i}] must be a non-empty string`);
        }
        if (componentContext.styleIds.size > 0 && !componentContext.styleIds.has(v)) {
            throw new EmbfParseError(
                `${path}.styleRefs[${i}] "${v}" is not defined in project.styles[]`
            );
        }
    }
}

function validateOptionalAnimations(o: Record<string, unknown>, path: string): void {
    if (o["animations"] === undefined) {
        return;
    }
    const raw = o["animations"];
    if (!Array.isArray(raw)) {
        throw new EmbfParseError(`${path}.animations must be an array`);
    }
    for (let i = 0; i < raw.length; i++) {
        const ap = `${path}.animations[${i}]`;
        const a = raw[i];
        if (typeof a !== "object" || a === null) {
            throw new EmbfParseError(`${ap} must be an object`);
        }
        const ao = a as Record<string, unknown>;
        if (typeof ao["property"] !== "string" || !ANIMATION_PROPERTIES.has(ao["property"])) {
            throw new EmbfParseError(
                `${ap}.property must be one of: ${[...ANIMATION_PROPERTIES].join(", ")}`
            );
        }
        for (const k of ["from", "to"] as const) {
            if (!isFiniteNumber(ao[k])) {
                throw new EmbfParseError(`${ap}.${k} must be a finite number`);
            }
        }
        if (ao["duration"] !== undefined && (!isFiniteNumber(ao["duration"]) || (ao["duration"] as number) < 0)) {
            throw new EmbfParseError(`${ap}.duration must be a non-negative number when set`);
        }
        if (ao["delay"] !== undefined && (!isFiniteNumber(ao["delay"]) || (ao["delay"] as number) < 0)) {
            throw new EmbfParseError(`${ap}.delay must be a non-negative number when set`);
        }
        if (ao["easing"] !== undefined && (typeof ao["easing"] !== "string" || !ANIMATION_EASINGS.has(ao["easing"]))) {
            throw new EmbfParseError(
                `${ap}.easing must be one of: ${[...ANIMATION_EASINGS].join(", ")}`
            );
        }
        if (ao["repeat"] !== undefined && !isFiniteNumber(ao["repeat"])) {
            throw new EmbfParseError(`${ap}.repeat must be a finite number when set`);
        }
        if (ao["playback"] !== undefined && typeof ao["playback"] !== "boolean") {
            throw new EmbfParseError(`${ap}.playback must be a boolean when set`);
        }
        if (ao["id"] !== undefined && (typeof ao["id"] !== "string" || !(ao["id"] as string).trim())) {
            throw new EmbfParseError(`${ap}.id must be a non-empty string when set`);
        }
    }
}

const BINDING_TEMPLATE = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;

/** Widget property → required dataField type for numeric bindings. */
const NUMERIC_BINDING_PROPS: Record<string, Set<string>> = {
    slider: new Set(["value"]),
    bar:    new Set(["value"]),
    arc:    new Set(["value"]),
    knob:   new Set(["value"])
};

function validateOptionalBindings(o: Record<string, unknown>, path: string): void {
    if (o["bindings"] === undefined) {
        return;
    }
    const raw = o["bindings"];
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
        throw new EmbfParseError(`${path}.bindings must be an object`);
    }
    const widgetType = o["type"] as string;
    const allowedProps = NUMERIC_BINDING_PROPS[widgetType] ?? new Set<string>();
    const fields = componentContext.fieldIds;
    for (const [prop, value] of Object.entries(raw as Record<string, unknown>)) {
        if (!allowedProps.has(prop)) {
            throw new EmbfParseError(
                `${path}.bindings.${prop} is not a bindable property on widget type "${widgetType}" (supported: ${[...allowedProps].join(", ") || "<none>"})`
            );
        }
        if (typeof value !== "string" || !value.trim()) {
            throw new EmbfParseError(`${path}.bindings.${prop} must be a non-empty field id`);
        }
        if (fields.size === 0) {
            throw new EmbfParseError(
                `${path}.bindings.${prop} references "${value}" but model.properties / dataModel.fields is empty`
            );
        }
        if (!fields.has(value)) {
            throw new EmbfParseError(
                `${path}.bindings.${prop} references unknown field "${value}" (defined: ${[...fields].join(", ")})`
            );
        }
    }
}

function validateOptionalScroll(o: Record<string, unknown>, path: string): void {
    for (const k of ["scrollX", "scrollY"] as const) {
        if (o[k] === undefined) continue;
        if (typeof o[k] !== "boolean") {
            throw new EmbfParseError(`${path}.${k} must be a boolean when set`);
        }
    }
}

function validateBindingTemplates(value: string, path: string): void {
    const ids = componentContext.fieldIds;
    let m: RegExpExecArray | null;
    const re = new RegExp(BINDING_TEMPLATE.source, "g");
    while ((m = re.exec(value)) !== null) {
        const fid = m[1];
        if (ids.size === 0) {
            throw new EmbfParseError(
                `${path} references binding "{{${fid}}}" but model.properties / dataModel.fields is empty`
            );
        }
        if (!ids.has(fid)) {
            throw new EmbfParseError(
                `${path} references unknown binding field "${fid}" (defined: ${[...ids].join(", ") || "<none>"})`
            );
        }
    }
}

function validateOptionalStyles(o: Record<string, unknown>, path: string): void {
    if (o["styles"] === undefined) {
        return;
    }
    validateStylePropsObject(o["styles"], `${path}.styles`);
}

function validateStylePropsObject(raw: unknown, path: string): void {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
        throw new EmbfParseError(`${path} must be an object`);
    }
    const st = raw as Record<string, unknown>;

    function needStr(prop: string, v: unknown): string {
        if (typeof v !== "string") {
            throw new EmbfParseError(`${path}.${prop} must be a string`);
        }
        return v;
    }

    function needFinNum(prop: string, v: unknown): number {
        if (!isFiniteNumber(v)) {
            throw new EmbfParseError(`${path}.${prop} must be a finite number`);
        }
        return v as number;
    }

    function needUint(prop: string, v: unknown): number {
        const n = needFinNum(prop, v);
        if (n < 0 || Math.floor(n) !== n) {
            throw new EmbfParseError(`${path}.${prop} must be a non-negative integer`);
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
                `${path} has unknown property "${key}" (allowed: ${[...allowedKeys].join(", ")})`
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
            throw new EmbfParseError(`${path}.align must be left, center, or right`);
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
        for (const k of ["scrollX", "scrollY"] as const) {
            if (p[k] !== undefined && typeof p[k] !== "boolean") {
                throw new EmbfParseError(`${path}.${k} must be a boolean when set`);
            }
        }
        for (const k of ["flowX", "flowY"] as const) {
            if (p[k] !== undefined && typeof p[k] !== "number") {
                throw new EmbfParseError(`${path}.${k} must be a number when set`);
            }
        }
        if (!Array.isArray(p["components"])) {
            throw new EmbfParseError(`${path}.components must be an array`);
        }
        if (p["swipes"] !== undefined) {
            validatePageSwipes(p["swipes"], `${path}.swipes`);
        }
        (p["components"] as unknown[]).forEach((c, ci) => {
            validateComponentDeep(c, `${path}.components[${ci}]`);
        });
    });
}

const SWIPE_DIRECTIONS = new Set<string>(["left", "right", "top", "bottom"]);

function validatePageSwipes(swipes: unknown, path: string): void {
    if (!Array.isArray(swipes)) {
        throw new EmbfParseError(`${path} must be an array`);
    }
    const seen = new Set<string>();
    for (let i = 0; i < swipes.length; i++) {
        const sp = `${path}[${i}]`;
        const s = swipes[i];
        if (typeof s !== "object" || s === null) {
            throw new EmbfParseError(`${sp} must be an object`);
        }
        const so = s as Record<string, unknown>;
        const dir = so["direction"];
        if (typeof dir !== "string" || !SWIPE_DIRECTIONS.has(dir)) {
            throw new EmbfParseError(`${sp}.direction must be one of: left, right, top, bottom`);
        }
        if (seen.has(dir)) {
            throw new EmbfParseError(`${path}: duplicate swipe direction "${dir}"`);
        }
        seen.add(dir);
        if (typeof so["target"] !== "string" || !so["target"].trim()) {
            throw new EmbfParseError(`${sp}: swipe requires non-empty string "target"`);
        }
        if (so["anim"] !== undefined) {
            if (!normalizeScreenLoadAnim(so["anim"])) {
                throw new EmbfParseError(`${sp}: swipe "anim" must be a known screen load animation id`);
            }
        }
        if (so["time"] !== undefined && !isFiniteNumber(so["time"])) {
            throw new EmbfParseError(`${sp}: swipe "time" must be a finite number (ms)`);
        }
        if (so["delay"] !== undefined && !isFiniteNumber(so["delay"])) {
            throw new EmbfParseError(`${sp}: swipe "delay" must be a finite number (ms)`);
        }
        if (so["autoDel"] !== undefined && typeof so["autoDel"] !== "boolean") {
            throw new EmbfParseError(`${sp}: swipe "autoDel" must be a boolean`);
        }
    }
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
    onChange: (project: EmbfProject | EmbfParseError) => void,
    /** Defaults to disk; pass `readEmbfText` from the extension for live editor buffers. */
    readContent: () => string = () => fs.readFileSync(filePath, "utf-8")
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
                    onChange(parseEmbfSource(readContent()));
                } catch (e) {
                    onChange(e instanceof EmbfParseError ? e : new EmbfParseError(String(e)));
                }
            }, 150);
        }
    );

    return watcher;
}
