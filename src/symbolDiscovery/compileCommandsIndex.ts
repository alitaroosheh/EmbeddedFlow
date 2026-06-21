import * as fs from "fs";
import * as path from "path";

const SOURCE_EXT = new Set([".c", ".cpp", ".cc", ".cxx"]);

interface CompileCommandEntry {
    file?: string;
}

/**
 * List source files from compile_commands.json for symbol indexing.
 * Prefers files under `<firmwareRoot>/main/` then other project sources; skips IDF tree paths when possible.
 */
export function listIndexSourceFiles(
    compileCommandsPath: string,
    firmwareRoot: string,
    opts?: { maxFiles?: number }
): string[] {
    const maxFiles = opts?.maxFiles ?? 64;
    const root = path.normalize(firmwareRoot);
    let entries: CompileCommandEntry[];
    try {
        entries = JSON.parse(fs.readFileSync(compileCommandsPath, "utf8")) as CompileCommandEntry[];
    } catch {
        return [];
    }
    if (!Array.isArray(entries)) {
        return [];
    }

    const mainDir = path.join(root, "main") + path.sep;
    const mainFiles: string[] = [];
    const projectFiles: string[] = [];
    const seen = new Set<string>();

    for (const entry of entries) {
        const raw = entry.file;
        if (typeof raw !== "string" || !raw.trim()) {
            continue;
        }
        const filePath = path.normalize(raw);
        if (seen.has(filePath)) {
            continue;
        }
        if (!fs.existsSync(filePath)) {
            continue;
        }
        const ext = path.extname(filePath).toLowerCase();
        if (!SOURCE_EXT.has(ext)) {
            continue;
        }
        if (!filePath.startsWith(root)) {
            continue;
        }
        seen.add(filePath);
        if (filePath.startsWith(mainDir)) {
            mainFiles.push(filePath);
        } else {
            projectFiles.push(filePath);
        }
    }

    mainFiles.sort();
    projectFiles.sort();
    return [...mainFiles, ...projectFiles].slice(0, maxFiles);
}
