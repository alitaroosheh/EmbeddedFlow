import * as path from "path";

const SUPPORTED = new Set([".png", ".jpg", ".jpeg", ".bmp"]);

export function isSupportedImagePath(filePath: string): boolean {
    return SUPPORTED.has(path.extname(filePath).toLowerCase());
}

export function supportedImageExtensions(): string[] {
    return [".png", ".jpg", ".jpeg", ".bmp"];
}
