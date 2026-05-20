import type { Component, EmbfProject, ImageDef } from "../types/embf";
import { inferImageDefFromSrc } from "./inferImage";

function walkComponents(components: Component[], imageSrc: Set<string>): void {
    for (const c of components) {
        if (c.type === "image" && typeof (c as { src?: string }).src === "string") {
            const s = (c as { src: string }).src.trim();
            if (s) {
                imageSrc.add(s);
            }
        }
        if ("children" in c && Array.isArray((c as { children?: Component[] }).children)) {
            walkComponents((c as { children: Component[] }).children, imageSrc);
        }
    }
}

/** Image asset ids referenced by `image` widgets on any page. */
export function collectReferencedImageIds(project: EmbfProject): Set<string> {
    const ids = new Set<string>();
    for (const page of project.pages) {
        walkComponents(page.components, ids);
    }
    return ids;
}

/** Merge `project.images` with ids used on pages (keeps library order, adds missing defs as warnings). */
export function resolveImagesToConvert(
    project: EmbfProject,
    embfDir?: string
): {
    entries: ImageDef[];
    missingDefs: string[];
    inferred: ImageDef[];
} {
    const lib = project.images ?? [];
    const byId = new Map(lib.map(e => [e.id, e]));
    const referenced = collectReferencedImageIds(project);
    const missingDefs: string[] = [];
    const inferred: ImageDef[] = [];
    const toConvert = new Map<string, ImageDef>();
    for (const e of lib) {
        toConvert.set(e.id, e);
    }
    for (const id of referenced) {
        const fromLib = byId.get(id);
        if (fromLib) {
            toConvert.set(id, fromLib);
            continue;
        }
        if (embfDir) {
            const guess = inferImageDefFromSrc(embfDir, id);
            if (guess) {
                toConvert.set(guess.id, guess);
                inferred.push(guess);
                continue;
            }
        }
        missingDefs.push(id);
    }
    return {
        entries: [...toConvert.values()],
        missingDefs,
        inferred
    };
}
