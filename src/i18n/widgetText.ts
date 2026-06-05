import { EmbfParseError } from "../embfParser";
import type { Component, EmbfProject, WidgetTextValue } from "../types/embf";
import type { StringsResFile } from "./stringsResParser";

export interface StringResourceRef {
    ref: string;
}

export const STRING_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function isStringResourceRef(value: unknown): value is StringResourceRef {
    return (
        typeof value === "object" &&
        value !== null &&
        !Array.isArray(value) &&
        typeof (value as StringResourceRef).ref === "string"
    );
}

export function patchWidgetTextField(comp: Record<string, unknown>, key: string, value: unknown): void {
    if (value === null || value === undefined) {
        delete comp[key];
        return;
    }
    if (typeof value === "string") {
        comp[key] = value;
        return;
    }
    if (isStringResourceRef(value)) {
        const ref = value.ref.trim();
        if (ref && STRING_KEY_PATTERN.test(ref)) {
            comp[key] = { ref };
        } else {
            delete comp[key];
        }
    }
}

export function validateWidgetTextField(value: unknown, path: string): void {
    if (typeof value === "string") {
        return;
    }
    if (isStringResourceRef(value)) {
        const ref = value.ref.trim();
        if (!ref) {
            throw new EmbfParseError(`${path} resource ref must be a non-empty string`);
        }
        if (!STRING_KEY_PATTERN.test(ref)) {
            throw new EmbfParseError(`${path}.ref "${ref}" is not a valid string resource key`);
        }
        return;
    }
    throw new EmbfParseError(
        `${path} must be a string literal or an object { "ref": "key" }`
    );
}

export function getWidgetTextRef(value: WidgetTextValue | undefined): string | undefined {
    if (isStringResourceRef(value)) {
        return value.ref;
    }
    return undefined;
}

/** Resolve display text for preview (I18n7): locale → defaultLocale → key id. */
export function resolveWidgetText(
    value: WidgetTextValue | undefined,
    strings: StringsResFile | null,
    locale?: string
): string {
    if (value === undefined || value === null) {
        return "";
    }
    if (typeof value === "string") {
        return value;
    }
    const key = value.ref;
    if (!strings) {
        return key;
    }
    const tryLocale = (loc: string): string | undefined => {
        const table = strings.locales[loc];
        if (table && Object.prototype.hasOwnProperty.call(table, key)) {
            return table[key];
        }
        return undefined;
    };
    if (locale) {
        const v = tryLocale(locale);
        if (v !== undefined) {
            return v;
        }
    }
    const fromDefault = tryLocale(strings.defaultLocale);
    if (fromDefault !== undefined) {
        return fromDefault;
    }
    for (const loc of Object.keys(strings.locales)) {
        const v = tryLocale(loc);
        if (v !== undefined) {
            return v;
        }
    }
    return key;
}

function walkComponents(components: Component[], fn: (c: Component) => void): void {
    for (const c of components) {
        fn(c);
        if ("children" in c && Array.isArray((c as { children?: Component[] }).children)) {
            walkComponents((c as { children: Component[] }).children, fn);
        }
    }
}

/** Collect all string resource keys referenced by widgets. */
export function collectStringRefsInProject(project: EmbfProject): Array<{ key: string; path: string }> {
    const out: Array<{ key: string; path: string }> = [];
    for (const page of project.pages) {
        walkComponents(page.components, c => {
            const base = `pages[${page.id}].${c.id}`;
            if (c.type === "label") {
                const ref = getWidgetTextRef(c.text);
                if (ref) {
                    out.push({ key: ref, path: `${base}.text` });
                }
            } else if (c.type === "button" && c.label !== undefined) {
                const ref = getWidgetTextRef(c.label);
                if (ref) {
                    out.push({ key: ref, path: `${base}.label` });
                }
            } else if (c.type === "checkbox" && c.text !== undefined) {
                const ref = getWidgetTextRef(c.text);
                if (ref) {
                    out.push({ key: ref, path: `${base}.text` });
                }
            }
        });
    }
    return out;
}

export function listAllStringKeys(strings: StringsResFile): string[] {
    const keys = new Set<string>();
    for (const table of Object.values(strings.locales)) {
        for (const k of Object.keys(table)) {
            keys.add(k);
        }
    }
    return [...keys].sort();
}
