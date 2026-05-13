import * as fs from "fs";
import * as path from "path";
import type { EmbfProject } from "../types/embf";
import {
    generatePageHeader,
    generatePageSource,
    generateRootHeader,
    generateRootSource,
    generateLvConf
} from "./pageGen";

export interface CodeGenResult {
    /** Files written: path → content */
    files: Map<string, string>;
    outputDir: string;
}

/**
 * Generate the complete C project from an .embf project.
 *
 * @param project   Parsed EmbfProject
 * @param embfPath  Absolute path to the .embf file (output dir is relative to it)
 * @param outputDir Override output directory (default: <embf-dir>/ui_output)
 */
export function generateCode(
    project: EmbfProject,
    embfPath: string,
    outputDir?: string
): CodeGenResult {
    const dir = outputDir ?? path.join(path.dirname(embfPath), "ui_output");
    const files = new Map<string, string>();

    // Per-page files
    for (const page of project.pages) {
        files.set(
            path.join(dir, `ui_${page.id}.h`),
            generatePageHeader(project, page)
        );
        files.set(
            path.join(dir, `ui_${page.id}.c`),
            generatePageSource(project, page)
        );
    }

    // Root files
    files.set(path.join(dir, "ui.h"),      generateRootHeader(project));
    files.set(path.join(dir, "ui.c"),      generateRootSource(project));
    files.set(path.join(dir, "lv_conf.h"), generateLvConf(project));

    return { files, outputDir: dir };
}

/**
 * Write all generated files to disk.
 * Creates the output directory if it doesn't exist.
 * Returns the list of file paths that were written.
 */
export function writeGeneratedFiles(result: CodeGenResult): string[] {
    fs.mkdirSync(result.outputDir, { recursive: true });

    const written: string[] = [];
    for (const [filePath, content] of result.files) {
        fs.writeFileSync(filePath, content, "utf-8");
        written.push(filePath);
    }
    return written;
}
