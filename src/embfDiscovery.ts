import * as fs from "fs";
import * as path from "path";

/** List `.embf` files directly in `dir` (not recursive). */
export function listEmbfInDirectory(dir: string): string[] {
    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return [];
    }
    return entries
        .filter(e => e.isFile() && e.name.toLowerCase().endsWith(".embf"))
        .map(e => path.normalize(path.join(dir, e.name)))
        .sort((a, b) => a.localeCompare(b));
}

/** Collect unique `.embf` paths from one or more directory roots (non-recursive). */
export function collectEmbfInRoots(roots: string[]): string[] {
    const seen = new Set<string>();
    for (const root of roots) {
        for (const fp of listEmbfInDirectory(root)) {
            seen.add(fp);
        }
    }
    return [...seen].sort((a, b) => a.localeCompare(b));
}

export function isEmbfFilePath(filePath: string): boolean {
    return filePath.toLowerCase().endsWith(".embf");
}
