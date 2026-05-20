import * as fs from "fs";
import type { RgbaBitmap } from "./pngReader";

function readUInt16LE(buf: Buffer, o: number): number {
    return buf.readUInt16LE(o);
}

function readUInt32LE(buf: Buffer, o: number): number {
    return buf.readUInt32LE(o);
}

function readInt32LE(buf: Buffer, o: number): number {
    return buf.readInt32LE(o);
}

/** Uncompressed 24/32-bit BMP (BI_RGB) → RGBA8888. */
export function readBmpFile(filePath: string): RgbaBitmap {
    const buf = fs.readFileSync(filePath);
    if (buf.length < 54 || buf[0] !== 0x42 || buf[1] !== 0x4d) {
        throw new Error("Not a BMP file (missing BM signature)");
    }

    const pixelOffset = readUInt32LE(buf, 10);
    const dibSize = readUInt32LE(buf, 14);
    if (dibSize < 40) {
        throw new Error(`Unsupported BMP DIB header size ${dibSize}`);
    }

    const width = readInt32LE(buf, 18);
    const heightRaw = readInt32LE(buf, 22);
    const planes = readUInt16LE(buf, 26);
    const bpp = readUInt16LE(buf, 28);
    const compression = readUInt32LE(buf, 30);

    if (planes !== 1) {
        throw new Error(`BMP planes must be 1 (got ${planes})`);
    }
    if (compression !== 0) {
        throw new Error("Compressed BMP is not supported (BI_RGB only)");
    }
    if (bpp !== 24 && bpp !== 32) {
        throw new Error(`BMP bit depth ${bpp} not supported (use 24 or 32)`);
    }
    if (width <= 0) {
        throw new Error("BMP width must be positive");
    }

    const topDown = heightRaw < 0;
    const height = Math.abs(heightRaw);
    if (height <= 0) {
        throw new Error("BMP height must be non-zero");
    }

    const rowBytes = Math.floor((bpp * width + 31) / 32) * 4;
    const out = Buffer.alloc(width * height * 4);

    for (let row = 0; row < height; row++) {
        const srcRow = topDown ? row : height - 1 - row;
        const rowOff = pixelOffset + srcRow * rowBytes;
        for (let x = 0; x < width; x++) {
            const di = (row * width + x) * 4;
            if (bpp === 32) {
                const o = rowOff + x * 4;
                out[di] = buf[o + 2]!;
                out[di + 1] = buf[o + 1]!;
                out[di + 2] = buf[o]!;
                out[di + 3] = buf[o + 3]!;
            } else {
                const o = rowOff + x * 3;
                out[di] = buf[o + 2]!;
                out[di + 1] = buf[o + 1]!;
                out[di + 2] = buf[o]!;
                out[di + 3] = 255;
            }
        }
    }

    return { width, height, data: out };
}
