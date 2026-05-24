import * as path from "path";
import type { EmbfProject } from "../types/embf";

/** POSIX absolute paths and Windows drive/UNC paths (e.g. from .embf on Windows, tested on Linux CI). */
function isAbsoluteOutputPath(p: string): boolean {
    if (path.isAbsolute(p)) {
        return true;
    }
    const s = p.replace(/\\/g, "/");
    return /^[A-Za-z]:\//.test(s) || /^[A-Za-z]:$/.test(s) || s.startsWith("//");
}

/** Store a picked folder in .embf relative to the project file when possible. */
export function formatOutputPathForStorage(embfPath: string, chosenDir: string): string {
    const embfDir = path.dirname(embfPath);
    const rel = path.relative(embfDir, chosenDir);
    if (rel && !rel.startsWith("..") && !path.isAbsolute(rel)) {
        return rel.split(path.sep).join("/");
    }
    return chosenDir;
}

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
        return isAbsoluteOutputPath(fromJson)
            ? path.normalize(fromJson)
            : path.normalize(path.join(path.dirname(embfPath), fromJson));
    }

    const fromSettings = (workspaceOutputDirectory ?? "").trim();
    if (fromSettings) {
        return isAbsoluteOutputPath(fromSettings)
            ? path.normalize(fromSettings)
            : path.normalize(path.join(path.dirname(embfPath), fromSettings));
    }

    return path.join(path.dirname(embfPath), "ui_output");
}
