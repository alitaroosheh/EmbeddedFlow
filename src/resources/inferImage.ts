import * as fs from "fs";
import * as path from "path";
import type { ImageDef } from "../types/embf";
import { isSupportedImagePath, supportedImageExtensions } from "./imageFormats";

function normalizeRelPath(p: string): string {
    return p.replace(/\\/g, "/");
}

function resolveOnDisk(embfDir: string, relPath: string): string | null {
    const norm = normalizeRelPath(relPath);
    const abs = path.isAbsolute(norm) ? norm : path.join(embfDir, norm);
    return fs.existsSync(abs) ? norm : null;
}

/**
 * When an image widget `src` is not listed in `project.images[]`, try to resolve it as a file path
 * next to the `.embf` (e.g. `assets/wifi.png` or `wifi` → `wifi.png`).
 */
export function inferImageDefFromSrc(embfDir: string, src: string): ImageDef | null {
    const id = src.trim();
    if (!id) {
        return null;
    }
    const norm = normalizeRelPath(id);

    if (isSupportedImagePath(norm)) {
        const found = resolveOnDisk(embfDir, norm);
        if (found) {
            return { id, path: found };
        }
    }

    for (const ext of supportedImageExtensions()) {
        const found = resolveOnDisk(embfDir, norm + ext);
        if (found) {
            return { id, path: found };
        }
    }

    const base = path.basename(norm);
    if (base !== norm) {
        for (const ext of supportedImageExtensions()) {
            const found = resolveOnDisk(embfDir, base + ext);
            if (found) {
                return { id, path: found };
            }
        }
    }

    return null;
}
