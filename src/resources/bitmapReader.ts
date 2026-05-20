import * as fs from "fs";
import * as path from "path";
import jpeg from "jpeg-js";
import { readBmpFile } from "./bmpReader";
import { readPngFile, type RgbaBitmap } from "./pngReader";

export type { RgbaBitmap } from "./pngReader";
export { bitmapHasAlpha } from "./pngReader";

const SUPPORTED = new Set([".png", ".jpg", ".jpeg", ".bmp"]);

export function isSupportedImagePath(filePath: string): boolean {
    return SUPPORTED.has(path.extname(filePath).toLowerCase());
}

export function supportedImageExtensions(): string[] {
    return [".png", ".jpg", ".jpeg", ".bmp"];
}

function readJpegFile(filePath: string): RgbaBitmap {
    const raw = fs.readFileSync(filePath);
    const decoded = jpeg.decode(raw, { useTArray: true });
    if (!decoded.width || !decoded.height) {
        throw new Error("JPEG has zero width or height");
    }
    return {
        width: decoded.width,
        height: decoded.height,
        data: Buffer.from(decoded.data)
    };
}

/**
 * Load PNG, JPEG, or BMP into a tightly packed RGBA8888 bitmap.
 */
export function readImageFile(filePath: string): RgbaBitmap {
    const ext = path.extname(filePath).toLowerCase();
    switch (ext) {
        case ".png":
            return readPngFile(filePath);
        case ".jpg":
        case ".jpeg":
            return readJpegFile(filePath);
        case ".bmp":
            return readBmpFile(filePath);
        default:
            throw new Error(
                `Unsupported image format "${ext}" (supported: ${supportedImageExtensions().join(", ")})`
            );
    }
}
