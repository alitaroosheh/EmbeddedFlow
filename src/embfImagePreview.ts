import * as fs from "fs";
import * as path from "path";
import { resolveCodegenOutputDir } from "./codeGen/outputDir";
import { resolveImagesToConvert } from "./resources/collectImages";
import { isSupportedImagePath, supportedImageExtensions } from "./resources/bitmapReader";
import type { EmbfProject } from "./types/embf";

export interface ImagePreviewAsset {
    id: string;
    /** Webview-safe URI for the image file (use in `<img src>`). */
    uri: string;
    path: string;
}

function normalizeRelPath(p: string): string {
    return p.replace(/\\/g, "/");
}

function uniqueRoots(roots: string[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const r of roots) {
        const n = path.normalize(r);
        if (!seen.has(n)) {
            seen.add(n);
            out.push(n);
        }
    }
    return out;
}

/** Try `relPath` under each root; also basename and id+extension fallbacks. */
export function resolveImageFileOnDisk(relPath: string, searchRoots: string[]): string | undefined {
    const norm = normalizeRelPath(relPath.trim());
    if (!norm) {
        return undefined;
    }

    const candidates: string[] = [];
    if (path.isAbsolute(norm)) {
        candidates.push(norm);
    } else {
        for (const root of searchRoots) {
            candidates.push(path.join(root, norm));
        }
    }

    const base = path.basename(norm);
    if (base !== norm) {
        for (const root of searchRoots) {
            candidates.push(path.join(root, base));
        }
    }

    if (!path.extname(norm)) {
        for (const ext of supportedImageExtensions()) {
            for (const root of searchRoots) {
                candidates.push(path.join(root, norm + ext));
                candidates.push(path.join(root, base + ext));
            }
        }
    }

    for (const abs of candidates) {
        if (fs.existsSync(abs) && isSupportedImagePath(abs)) {
            return abs;
        }
    }
    return undefined;
}

/**
 * Resolve images for preview overlays (no C codegen required).
 * Uses `project.images[]`, widget `src` references, and the same path inference as the converter.
 */
export interface BuildImagePreviewAssetsOptions {
    workspaceOutputDirectory?: string;
    /** Extra folders to search (e.g. workspace roots). */
    extraSearchRoots?: string[];
    /** Convert absolute path to a webview-loadable URI. */
    toWebviewUri: (absPath: string) => string;
}

export function buildImagePreviewAssets(
    project: EmbfProject,
    embfPath: string,
    options: BuildImagePreviewAssetsOptions
): ImagePreviewAsset[] {
    const embfDir = path.dirname(embfPath);
    const searchRoots = uniqueRoots([
        embfDir,
        resolveCodegenOutputDir(project, embfPath, options.workspaceOutputDirectory),
        ...(options.extraSearchRoots ?? [])
    ]);

    const { entries } = resolveImagesToConvert(project, embfDir);
    const out: ImagePreviewAsset[] = [];
    const seen = new Set<string>();

    for (const entry of entries) {
        if (seen.has(entry.id)) {
            continue;
        }
        const abs = resolveImageFileOnDisk(entry.path, searchRoots);
        if (!abs) {
            continue;
        }
        seen.add(entry.id);
        out.push({
            id: entry.id,
            path: entry.path,
            uri: options.toWebviewUri(abs)
        });
    }

    return out;
}
