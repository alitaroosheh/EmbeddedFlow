import * as fs from "fs";
import { StringsResParseError } from "./stringsResErrors";

export interface StringsResFile {
    defaultLocale: string;
    locales: Record<string, Record<string, string>>;
    /** Optional per-locale text direction (RTL1). */
    localeMeta?: Record<string, { direction?: "ltr" | "rtl" }>;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
    return typeof v === "object" && v !== null && !Array.isArray(v);
}

function validateLocaleId(id: string, path: string): void {
    if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(id)) {
        throw new StringsResParseError(`${path}: invalid locale id "${id}"`);
    }
}

function validateStringKey(key: string, path: string): void {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
        throw new StringsResParseError(`${path}: invalid string key "${key}"`);
    }
}

/** Parse and validate a `.res` string resource document (JSON body). */
export function parseStringsResSource(text: string, fileLabel = ".res"): StringsResFile {
    let root: unknown;
    try {
        root = JSON.parse(text);
    } catch {
        throw new StringsResParseError(`${fileLabel}: invalid JSON`);
    }

    if (!isPlainObject(root)) {
        throw new StringsResParseError(`${fileLabel}: root must be an object`);
    }

    const defaultLocale = root["defaultLocale"];
    if (typeof defaultLocale !== "string" || !defaultLocale.trim()) {
        throw new StringsResParseError(`${fileLabel}: defaultLocale must be a non-empty string`);
    }
    validateLocaleId(defaultLocale.trim(), fileLabel);

    const localesRaw = root["locales"];
    if (!isPlainObject(localesRaw)) {
        throw new StringsResParseError(`${fileLabel}: locales must be an object`);
    }

    const localeIds = Object.keys(localesRaw);
    if (!localeIds.length) {
        throw new StringsResParseError(`${fileLabel}: locales must contain at least one locale`);
    }

    if (!Object.prototype.hasOwnProperty.call(localesRaw, defaultLocale.trim())) {
        throw new StringsResParseError(
            `${fileLabel}: defaultLocale "${defaultLocale.trim()}" is missing from locales`
        );
    }

    const locales: Record<string, Record<string, string>> = {};
    for (const localeId of localeIds) {
        validateLocaleId(localeId, `${fileLabel}.locales.${localeId}`);
        const entries = localesRaw[localeId];
        if (!isPlainObject(entries)) {
            throw new StringsResParseError(`${fileLabel}.locales.${localeId} must be an object`);
        }
        const table: Record<string, string> = {};
        for (const [key, value] of Object.entries(entries)) {
            validateStringKey(key, `${fileLabel}.locales.${localeId}.${key}`);
            if (typeof value !== "string") {
                throw new StringsResParseError(
                    `${fileLabel}.locales.${localeId}.${key} must be a string`
                );
            }
            table[key] = value;
        }
        locales[localeId] = table;
    }

    let localeMeta: StringsResFile["localeMeta"];
    const metaRaw = root["localeMeta"];
    if (metaRaw !== undefined) {
        if (!isPlainObject(metaRaw)) {
            throw new StringsResParseError(`${fileLabel}: localeMeta must be an object`);
        }
        localeMeta = {};
        for (const [localeId, entry] of Object.entries(metaRaw)) {
            validateLocaleId(localeId, `${fileLabel}.localeMeta.${localeId}`);
            if (!isPlainObject(entry)) {
                throw new StringsResParseError(`${fileLabel}.localeMeta.${localeId} must be an object`);
            }
            const dir = entry["direction"];
            if (dir !== undefined && dir !== "ltr" && dir !== "rtl") {
                throw new StringsResParseError(
                    `${fileLabel}.localeMeta.${localeId}.direction must be "ltr" or "rtl"`
                );
            }
            localeMeta[localeId] = { direction: dir as "ltr" | "rtl" | undefined };
        }
    }

    return { defaultLocale: defaultLocale.trim(), locales, localeMeta };
}

/** Read a `.res` file from disk. */
export function readStringsResFile(absPath: string): StringsResFile {
    let text: string;
    try {
        text = fs.readFileSync(absPath, "utf8");
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new StringsResParseError(`Cannot read ${absPath}: ${msg}`);
    }
    return parseStringsResSource(text, absPath);
}
