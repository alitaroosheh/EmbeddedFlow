import * as fs from "fs";
import * as path from "path";
import type { EmbfProject } from "../types/embf";
import {
    generatePageHeader,
    generatePageSource,
    generateRootHeader,
    generateRootSource,
    generateLvConf,
    generateDisplayHeader,
    isLvglV9
} from "./pageGen";
import { generateFontsHeader, generateFontsSource } from "./fontsGen";
import { convertProjectImages } from "../resources";

export { resolveCodegenOutputDir } from "./outputDir";
export {
    DEFAULT_LVGL_INCLUDE,
    lvglIncludeDirective,
    normalizeLvglIncludePath,
    resolveLvglIncludePath
} from "./lvglInclude";

export interface CodeGenResult {
    /** Files written: path → content */
    files: Map<string, string>;
    outputDir: string;
    /** Non-fatal image conversion issues (missing files, unsupported format, etc.). */
    imageWarnings: string[];
}

/**
 * Generate the complete C project from an .embf project.
 *
 * @param project   Parsed EmbfProject
 * @param embfPath  Absolute path to the .embf file (output dir is relative to it)
 * @param outputDir Resolved output directory (use {@link resolveCodegenOutputDir})
 */
export function generateCode(
    project: EmbfProject,
    embfPath: string,
    outputDir: string
): CodeGenResult {
    const dir = outputDir;
    const files = new Map<string, string>();

    // Auto-convert project.images[] → ui_img_*.c in the output folder (same as ui.h)
    const imageResult = convertProjectImages(project, embfPath, dir);
    const lvglV9 = isLvglV9(project);

    files.set(path.join(dir, "ui_display.h"), generateDisplayHeader(project));

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

    const imageSymbols = imageResult.assets.map(a => ({
        symbolName: a.symbolName,
        lvglV9
    }));

    const fontsHeader = generateFontsHeader(project);
    const fontsSource = generateFontsSource(project);
    if (fontsHeader && fontsSource) {
        files.set(path.join(dir, "ui_fonts.h"), fontsHeader);
        files.set(path.join(dir, "ui_fonts.c"), fontsSource);
    }

    files.set(
        path.join(dir, "ui.h"),
        generateRootHeader(project, {
            imageSymbols: imageSymbols.length > 0 ? imageSymbols : undefined,
            includeFonts: fontsHeader !== null
        })
    );
    files.set(path.join(dir, "ui.c"), generateRootSource(project));
    files.set(path.join(dir, "lv_conf.h"), generateLvConf(project));

    for (const [relPath, content] of imageResult.files) {
        files.set(path.join(dir, relPath), content);
    }

    const imageWarnings = [...imageResult.errors];
    for (const g of imageResult.inferred) {
        imageWarnings.push(
            `images[${g.id}]: converted from widget src "${g.path}" — add to project.images[] in .embf to persist`
        );
    }
    return { files, outputDir: dir, imageWarnings };
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
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, content, "utf-8");
        written.push(filePath);
    }
    return written;
}
