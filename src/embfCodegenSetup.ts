import * as path from "path";
import * as vscode from "vscode";
import type { EmbfProject } from "./types/embf";
import { formatOutputPathForStorage, resolveCodegenOutputDir } from "./codeGen/outputDir";
import { readEmbfProject } from "./embfProjectWrite";
import { updatePageInEmbfFile } from "./embfComponentEdit";

/**
 * Prompt for an output folder when `project.outputPath` is unset, persist to `.embf`, return resolved dir.
 */
export async function ensureCodegenOutputPath(
    filePath: string,
    project: EmbfProject,
    workspaceOutputDirectory: string
): Promise<{ project: EmbfProject; outputDir: string } | undefined> {
    if (project.project.outputPath?.trim()) {
        return {
            project,
            outputDir: resolveCodegenOutputDir(project, filePath, workspaceOutputDirectory)
        };
    }

    const defaultUri = vscode.Uri.file(path.join(path.dirname(filePath), "ui_output"));
    const picked = await vscode.window.showOpenDialog({
        canSelectFolders: true,
        canSelectFiles: false,
        canSelectMany: false,
        defaultUri,
        title: "Select folder for generated C UI files",
        openLabel: "Select folder"
    });
    if (!picked?.length) {
        return undefined;
    }

    const stored = formatOutputPathForStorage(filePath, picked[0].fsPath);
    const ok = await updatePageInEmbfFile(filePath, 0, { projOutputPath: stored });
    if (!ok) {
        vscode.window.showErrorMessage("embeddedflow: could not save output folder to the .embf file.");
        return undefined;
    }

    const next = readEmbfProject(filePath);
    return {
        project: next,
        outputDir: resolveCodegenOutputDir(next, filePath, workspaceOutputDirectory)
    };
}
