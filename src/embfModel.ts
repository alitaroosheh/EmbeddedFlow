import type { DataField, DataFieldType, EmbfProject, ModelProperty, PropertyDirection } from "./types/embf";

const PROPERTY_DIRECTIONS = new Set<PropertyDirection>(["push", "pull", "unknown"]);
const FIELD_TYPES = new Set<DataFieldType>(["string", "int", "float", "bool"]);

/**
 * Preview-time properties: `model.properties` when declared, else legacy `dataModel.fields`.
 */
export function getPreviewProperties(project: EmbfProject): ModelProperty[] {
    if (project.model?.properties !== undefined) {
        return project.model.properties;
    }
    const legacy = project.dataModel?.fields;
    if (!legacy?.length) {
        return [];
    }
    return legacy.map(f => ({ id: f.id, type: f.type, default: f.default }));
}

/** All property ids from `model.properties` and `dataModel.fields` (must be unique across both). */
export function collectPropertyIds(project: EmbfProject): Set<string> {
    const ids = new Set<string>();
    for (const p of project.model?.properties ?? []) {
        ids.add(p.id);
    }
    for (const f of project.dataModel?.fields ?? []) {
        ids.add(f.id);
    }
    return ids;
}

/** True when Phase 1 model properties exist (codegen must not use them for ui_bindings). */
export function usesModelPropertiesOnly(project: EmbfProject): boolean {
    return (project.model?.properties?.length ?? 0) > 0;
}

export function validateModelPropertyDeep(entry: unknown, path: string): void {
    if (typeof entry !== "object" || entry === null) {
        throw new Error(`${path} must be an object`);
    }
    const o = entry as Record<string, unknown>;
    if (typeof o["id"] !== "string" || !(o["id"] as string).trim()) {
        throw new Error(`${path}.id must be a non-empty string`);
    }
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(o["id"] as string)) {
        throw new Error(`${path}.id must be a valid C identifier`);
    }
    const ty = o["type"];
    if (typeof ty !== "string" || !FIELD_TYPES.has(ty as DataFieldType)) {
        throw new Error(`${path}.type must be one of: string, int, float, bool`);
    }
    validateDefaultForType(o["default"], ty as DataFieldType, `${path}.default`);
    if (o["min"] !== undefined) {
        if (!Number.isFinite(o["min"])) {
            throw new Error(`${path}.min must be a finite number`);
        }
        if (ty !== "int" && ty !== "float") {
            throw new Error(`${path}.min is only valid for int/float properties`);
        }
    }
    if (o["max"] !== undefined) {
        if (!Number.isFinite(o["max"])) {
            throw new Error(`${path}.max must be a finite number`);
        }
        if (ty !== "int" && ty !== "float") {
            throw new Error(`${path}.max is only valid for int/float properties`);
        }
    }
    if (o["min"] !== undefined && o["max"] !== undefined && (o["min"] as number) > (o["max"] as number)) {
        throw new Error(`${path}.min must be <= max`);
    }
    const dir = o["direction"];
    if (dir !== undefined) {
        if (typeof dir !== "string" || !PROPERTY_DIRECTIONS.has(dir as PropertyDirection)) {
            throw new Error(`${path}.direction must be push, pull, or unknown`);
        }
    }
}

function validateDefaultForType(def: unknown, ty: DataFieldType, path: string): void {
    if (def === undefined) {
        return;
    }
    switch (ty) {
        case "string":
            if (typeof def !== "string") {
                throw new Error(`${path} must be a string`);
            }
            break;
        case "int":
            if (!Number.isFinite(def) || !Number.isInteger(def as number)) {
                throw new Error(`${path} must be an integer`);
            }
            break;
        case "float":
            if (!Number.isFinite(def)) {
                throw new Error(`${path} must be a finite number`);
            }
            break;
        case "bool":
            if (typeof def !== "boolean") {
                throw new Error(`${path} must be a boolean`);
            }
            break;
    }
}

/** Coerce a property default for preview display (same rules as legacy data fields). */
export function formatPropertyDefault(prop: DataField | ModelProperty): string {
    if (prop.default === undefined || prop.default === null) {
        switch (prop.type) {
            case "int":
            case "float":
                return "0";
            case "bool":
                return "false";
            default:
                return "";
        }
    }
    if (typeof prop.default === "boolean") {
        return prop.default ? "true" : "false";
    }
    return String(prop.default);
}
