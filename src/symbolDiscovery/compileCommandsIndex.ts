import * as fs from "fs";
import * as path from "path";

const SOURCE_EXT = new Set([".c", ".cpp", ".cc", ".cxx"]);

interface CompileCommandEntry {
    file?: string;
}

/** True when `filePath` is under `root` (case-insensitive on Windows — ESP-IDF paths often differ in drive letter casing). */
function isPathWithinRoot(filePath: string, root: string): boolean {
    const f = path.normalize(filePath);
    const r = path.normalize(root);
    if (!r) {
        return false;
    }
    const rootPrefix = r.endsWith(path.sep) ? r : r + path.sep;
    const winLike = process.platform === "win32" || /^[A-Za-z]:[\\/]/.test(f);
    if (winLike) {
        const fl = f.toLowerCase();
        const rl = r.toLowerCase();
        return fl === rl || fl.startsWith(rootPrefix.toLowerCase());
    }
    return f === r || f.startsWith(rootPrefix);
}

/**
 * List source files from compile_commands.json for symbol indexing.
 * Prefers files under `<firmwareRoot>/main/` then other project sources.
 */
export function listIndexSourceFiles(
    compileCommandsPath: string,
    firmwareRoot: string,
    opts?: { maxFiles?: number; mainOnly?: boolean }
): string[] {
    const maxFiles = opts?.maxFiles ?? 64;
    const mainOnly = opts?.mainOnly ?? false;
    const { mainFiles, projectFiles } = collectIndexSourceFiles(compileCommandsPath, firmwareRoot);
    const pool = mainOnly ? mainFiles : [...mainFiles, ...projectFiles];
    if (maxFiles <= 0) {
        return pool;
    }
    return pool.slice(0, maxFiles);
}

/** Count indexable sources under firmware root (before maxFiles cap). */
export function countIndexableSourceFiles(
    compileCommandsPath: string,
    firmwareRoot: string,
    opts?: { mainOnly?: boolean }
): { main: number; project: number; total: number } {
    const { mainFiles, projectFiles } = collectIndexSourceFiles(compileCommandsPath, firmwareRoot);
    const mainOnly = opts?.mainOnly ?? false;
    const total = mainOnly ? mainFiles.length : mainFiles.length + projectFiles.length;
    return { main: mainFiles.length, project: projectFiles.length, total };
}

function collectIndexSourceFiles(
    compileCommandsPath: string,
    firmwareRoot: string
): { mainFiles: string[]; projectFiles: string[] } {
    const root = path.normalize(firmwareRoot);
    let entries: CompileCommandEntry[];
    try {
        entries = JSON.parse(fs.readFileSync(compileCommandsPath, "utf8")) as CompileCommandEntry[];
    } catch {
        return { mainFiles: [], projectFiles: [] };
    }
    if (!Array.isArray(entries)) {
        return { mainFiles: [], projectFiles: [] };
    }

    const mainDir = path.join(root, "main");
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
        const ext = path.extname(filePath).toLowerCase();
        if (!SOURCE_EXT.has(ext)) {
            continue;
        }
        if (!isPathWithinRoot(filePath, root)) {
            continue;
        }
        seen.add(filePath);
        if (isPathWithinRoot(filePath, mainDir)) {
            mainFiles.push(filePath);
        } else {
            projectFiles.push(filePath);
        }
    }

    mainFiles.sort();
    projectFiles.sort();
    return { mainFiles, projectFiles };
}
