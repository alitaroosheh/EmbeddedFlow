import * as path from "path";
import type { EmbfProject } from "../types/embf";

/**
 * Resolve where generated C files are written.
 * Priority: `project.outputPath` in .embf → workspace `embeddedflow.outputDirectory` → `<embf-dir>/ui_output`.
 */
export function resolveCodegenOutputDir(
    project: EmbfProject,
    embfPath: string,
    workspaceOutputDirectory?: string
): string {
    const fromJson = project.project.outputPath?.trim();
    if (fromJson) {
        return path.isAbsolute(fromJson)
            ? path.normalize(fromJson)
            : path.normalize(path.join(path.dirname(embfPath), fromJson));
    }

    const fromSettings = (workspaceOutputDirectory ?? "").trim();
    if (fromSettings) {
        return path.isAbsolute(fromSettings)
            ? path.normalize(fromSettings)
            : path.normalize(path.join(path.dirname(embfPath), fromSettings));
    }

    return path.join(path.dirname(embfPath), "ui_output");
}
