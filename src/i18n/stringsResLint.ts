import type { EmbfProject } from "../types/embf";
import type { EmbfSemanticIssue } from "../embfSemanticLint";
import { collectStringRefsInProject, listAllStringKeys } from "./widgetText";
import type { StringsResFile } from "./stringsResParser";

export function lintStringResourceRefs(
    project: EmbfProject,
    strings: StringsResFile | null
): EmbfSemanticIssue[] {
    const issues: EmbfSemanticIssue[] = [];
    const refs = collectStringRefsInProject(project);
    if (!refs.length) {
        return issues;
    }
    if (!strings) {
        for (const r of refs) {
            issues.push({
                message: `String resource "${r.key}" at ${r.path}: strings file not found or invalid`
            });
        }
        return issues;
    }
    const known = new Set(listAllStringKeys(strings));
    for (const r of refs) {
        if (!known.has(r.key)) {
            issues.push({
                message: `String resource key "${r.key}" at ${r.path} is not defined in strings.res (locales: ${Object.keys(strings.locales).join(", ")})`
            });
        }
    }
    return issues;
}
