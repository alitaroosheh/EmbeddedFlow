import type { ColorFormat } from "../types/embf";
import type { LvglImageColorFormat } from "./types";

/** Map project display color format to default LVGL image storage format. */
export function defaultLvglImageFormat(display: ColorFormat, hasAlpha: boolean): LvglImageColorFormat {
    switch (display) {
        case "RGB565":
            return hasAlpha ? "LV_COLOR_FORMAT_RGB565A8" : "LV_COLOR_FORMAT_RGB565";
        case "RGB888":
            return "LV_COLOR_FORMAT_RGB888";
        case "ARGB8888":
            return "LV_COLOR_FORMAT_ARGB8888";
        case "L8":
            return "LV_COLOR_FORMAT_L8";
        case "AL88":
            return "LV_COLOR_FORMAT_AL88";
        default:
            return hasAlpha ? "LV_COLOR_FORMAT_ARGB8888" : "LV_COLOR_FORMAT_RGB565";
    }
}

/** Bytes per pixel for packed image map (excluding RGB565A8 alpha plane). */
export function bytesPerPixel(cf: LvglImageColorFormat): number {
    switch (cf) {
        case "LV_COLOR_FORMAT_RGB565":
            return 2;
        case "LV_COLOR_FORMAT_RGB888":
            return 3;
        case "LV_COLOR_FORMAT_ARGB8888":
            return 4;
        case "LV_COLOR_FORMAT_L8":
            return 1;
        case "LV_COLOR_FORMAT_AL88":
            return 2;
        case "LV_COLOR_FORMAT_RGB565A8":
            return 2;
        default:
            return 4;
    }
}

/** Row stride in bytes (LVGL aligns rows to 4 bytes). */
export function rowStride(width: number, cf: LvglImageColorFormat): number {
    const bpp = bytesPerPixel(cf);
    const rowBytes = width * bpp;
    return (rowBytes + 3) & ~3;
}

/** Total `.data` payload size for the image map. */
export function imageDataSize(width: number, height: number, cf: LvglImageColorFormat): number {
    const stride = rowStride(width, cf);
    if (cf === "LV_COLOR_FORMAT_RGB565A8") {
        return stride * height + width * height;
    }
    return stride * height;
}
