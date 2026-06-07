import * as path from "path";
import type { EmbfProject } from "../types/embf";

/** Default relative path from the `.embf` file to application string resources. */
export const DEFAULT_STRINGS_RES_REL_PATH = "strings.res";

/** True when `p` ends with `.res` (case-insensitive). */
export function isStringsResPath(p: string): boolean {
    return /\.res$/i.test(p.trim());
}

/**
 * Relative path stored in IR, or default when omitted.
 */
export function getStringsResRelPath(project: EmbfProject): string {
    const rel = project.project.stringsPath?.trim();
    return rel && rel.length > 0 ? rel : DEFAULT_STRINGS_RES_REL_PATH;
}

/**
 * Absolute path to the linked `.res` file for a project on disk.
 */
export function resolveStringsResPath(project: EmbfProject, embfFilePath: string): string {
    const rel = getStringsResRelPath(project);
    if (path.isAbsolute(rel)) {
        return path.normalize(rel);
    }
    return path.normalize(path.join(path.dirname(embfFilePath), rel));
}
