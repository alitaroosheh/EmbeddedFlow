import type { ColorFormat } from "../types/embf";

/** LVGL v9 color format used in generated `lv_image_dsc_t`. */
export type LvglImageColorFormat =
    | "LV_COLOR_FORMAT_RGB565"
    | "LV_COLOR_FORMAT_RGB565A8"
    | "LV_COLOR_FORMAT_RGB888"
    | "LV_COLOR_FORMAT_ARGB8888"
    | "LV_COLOR_FORMAT_L8"
    | "LV_COLOR_FORMAT_AL88";

export interface ImageConvertOptions {
    /** Resolve `ImageDef.path` relative to the `.embf` file directory. */
    embfDir: string;
    /** Default when an image has no per-entry override. */
    displayColorFormat: ColorFormat;
    /** Target LVGL major API (v8 vs v9 descriptor layout). */
    lvglV9: boolean;
    /** Optional LVGL include path for generated `.c` files. */
    lvglInclude?: string;
}

export interface ConvertedImageAsset {
    id: string;
    /** C symbol base, e.g. `ui_img_wifi_0` */
    symbolName: string;
    width: number;
    height: number;
    colorFormat: LvglImageColorFormat;
    /** Relative path under output dir, e.g. `ui_img_wifi_0.c` */
    cRelativePath: string;
    cSource: string;
}

export interface ProjectImagesConvertResult {
    /** Image `.c` sources and descriptors — same folder as `ui.h` (no subfolder). */
    files: Map<string, string>;
    assets: ConvertedImageAsset[];
    errors: string[];
    /** Resolved from widget `src` when not listed in project.images[] */
    inferred: import("../types/embf").ImageDef[];
}

export class ImageConvertError extends Error {
    constructor(
        message: string,
        public readonly imageId?: string
    ) {
        super(message);
        this.name = "ImageConvertError";
    }
}
