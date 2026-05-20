import * as fs from "fs";
import { PNG } from "pngjs";

export interface RgbaBitmap {
    width: number;
    height: number;
    /** RGBA8888, length = width * height * 4 */
    data: Buffer;
}

/** Load a PNG file into a tightly packed RGBA buffer (no row padding). */
export function readPngFile(filePath: string): RgbaBitmap {
    const raw = fs.readFileSync(filePath);
    const png = PNG.sync.read(raw);
    const { width, height, data } = png;
    if (!width || !height) {
        throw new Error("PNG has zero width or height");
    }
    return { width, height, data: Buffer.from(data) };
}

export function bitmapHasAlpha(bitmap: RgbaBitmap, threshold = 250): boolean {
    const { data } = bitmap;
    for (let i = 3; i < data.length; i += 4) {
        if (data[i] < threshold) {
            return true;
        }
    }
    return false;
}
