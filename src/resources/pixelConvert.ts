import type { LvglImageColorFormat } from "./types";
import { imageDataSize, rowStride } from "./lvglFormats";
import type { RgbaBitmap } from "./pngReader";

function rgbaToRgb565(r: number, g: number, b: number): number {
    return ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3);
}

function writeRgb565Row(
    out: Buffer,
    outOffset: number,
    bitmap: RgbaBitmap,
    y: number,
    stride: number
): number {
    const { width, data } = bitmap;
    for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const v = rgbaToRgb565(data[i], data[i + 1], data[i + 2]);
        const o = outOffset + x * 2;
        out[o] = v & 0xff;
        out[o + 1] = (v >> 8) & 0xff;
    }
    return outOffset + stride;
}

function writeRgb565A8(
    out: Buffer,
    bitmap: RgbaBitmap,
    rgbStride: number
): void {
    const { width, height, data } = bitmap;
    const colorBytes = rgbStride * height;
    let rowOff = 0;
    let alphaOff = colorBytes;
    for (let y = 0; y < height; y++) {
        rowOff = writeRgb565Row(out, rowOff, bitmap, y, rgbStride);
        for (let x = 0; x < width; x++) {
            out[alphaOff++] = data[(y * width + x) * 4 + 3];
        }
    }
}

function writeRgb888Row(
    out: Buffer,
    outOffset: number,
    bitmap: RgbaBitmap,
    y: number,
    stride: number
): number {
    const { width, data } = bitmap;
    for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const o = outOffset + x * 3;
        out[o] = data[i + 2];
        out[o + 1] = data[i + 1];
        out[o + 2] = data[i];
    }
    return outOffset + stride;
}

function writeArgb8888Row(
    out: Buffer,
    outOffset: number,
    bitmap: RgbaBitmap,
    y: number,
    stride: number
): number {
    const { width, data } = bitmap;
    for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const o = outOffset + x * 4;
        out[o] = data[i + 2];
        out[o + 1] = data[i + 1];
        out[o + 2] = data[i];
        out[o + 3] = data[i + 3];
    }
    return outOffset + stride;
}

function writeL8Row(
    out: Buffer,
    outOffset: number,
    bitmap: RgbaBitmap,
    y: number,
    stride: number
): number {
    const { width, data } = bitmap;
    for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const l = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
        out[outOffset + x] = l;
    }
    return outOffset + stride;
}

function writeAl88Row(
    out: Buffer,
    outOffset: number,
    bitmap: RgbaBitmap,
    y: number,
    stride: number
): number {
    const { width, data } = bitmap;
    for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const l = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
        const o = outOffset + x * 2;
        out[o] = l;
        out[o + 1] = data[i + 3];
    }
    return outOffset + stride;
}

/** Pack RGBA bitmap into an LVGL-native image buffer. */
export function rgbaToLvglBitmap(
    bitmap: RgbaBitmap,
    cf: LvglImageColorFormat
): { data: Buffer; stride: number } {
    const { width, height } = bitmap;
    const stride = rowStride(width, cf);
    const size = imageDataSize(width, height, cf);
    const out = Buffer.alloc(size, 0);

    if (cf === "LV_COLOR_FORMAT_RGB565A8") {
        writeRgb565A8(out, bitmap, stride);
        return { data: out, stride };
    }

    let off = 0;
    for (let y = 0; y < height; y++) {
        switch (cf) {
            case "LV_COLOR_FORMAT_RGB565":
                off = writeRgb565Row(out, off, bitmap, y, stride);
                break;
            case "LV_COLOR_FORMAT_RGB888":
                off = writeRgb888Row(out, off, bitmap, y, stride);
                break;
            case "LV_COLOR_FORMAT_ARGB8888":
                off = writeArgb8888Row(out, off, bitmap, y, stride);
                break;
            case "LV_COLOR_FORMAT_L8":
                off = writeL8Row(out, off, bitmap, y, stride);
                break;
            case "LV_COLOR_FORMAT_AL88":
                off = writeAl88Row(out, off, bitmap, y, stride);
                break;
            default:
                off = writeArgb8888Row(out, off, bitmap, y, stride);
        }
    }
    return { data: out, stride };
}
