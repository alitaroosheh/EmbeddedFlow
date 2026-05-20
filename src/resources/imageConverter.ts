import * as fs from "fs";
import * as path from "path";
import type { ImageDef } from "../types/embf";
import { toIdentifier } from "../codeGen/naming";
import { resolveLvglIncludePath } from "../codeGen/lvglInclude";
import type { EmbfProject } from "../types/embf";
import { bitmapHasAlpha, readImageFile, isSupportedImagePath, supportedImageExtensions } from "./bitmapReader";
import { defaultLvglImageFormat } from "./lvglFormats";
import { rgbaToLvglBitmap } from "./pixelConvert";
import { generateLvgl8ImageSource, generateLvgl9ImageSource } from "./imageCodegen";
import { resolveImagesToConvert } from "./collectImages";
import type {
    ConvertedImageAsset,
    ImageConvertOptions,
    ProjectImagesConvertResult
} from "./types";
import { ImageConvertError } from "./types";
import { isLvglV9 } from "../codeGen/pageGen";

function imageSymbolName(id: string): string {
    return `ui_img_${toIdentifier(id)}`;
}

function resolveImagePath(embfDir: string, imagePath: string): string {
    if (path.isAbsolute(imagePath)) {
        return imagePath;
    }
    return path.join(embfDir, imagePath);
}

/**
 * Convert one image asset (PNG / JPEG / BMP) to LVGL C source (map + descriptor).
 */
export function convertImageAsset(
    entry: ImageDef,
    options: ImageConvertOptions
): ConvertedImageAsset {
    const filePath = resolveImagePath(options.embfDir, entry.path);
    if (!fs.existsSync(filePath)) {
        throw new ImageConvertError(`Image file not found: ${filePath}`, entry.id);
    }
    if (!isSupportedImagePath(filePath)) {
        throw new ImageConvertError(
            `Unsupported image format "${path.extname(filePath)}" (supported: ${supportedImageExtensions().join(", ")}).`,
            entry.id
        );
    }

    const bitmap = readImageFile(filePath);
    const hasAlpha = bitmapHasAlpha(bitmap);
    const cf = defaultLvglImageFormat(options.displayColorFormat, hasAlpha);
    const { data, stride } = rgbaToLvglBitmap(bitmap, cf);
    const symbolName = imageSymbolName(entry.id);
    const lvglInclude = options.lvglInclude;

    const cSource = options.lvglV9
        ? generateLvgl9ImageSource(
              symbolName,
              bitmap.width,
              bitmap.height,
              stride,
              cf,
              data,
              lvglInclude
          )
        : generateLvgl8ImageSource(
              symbolName,
              bitmap.width,
              bitmap.height,
              cf,
              data,
              lvglInclude
          );

    // Emit next to ui.h (not ui_images/) so ESP-IDF `file(GLOB ui/*.c)` picks them up.
    const cRelativePath = `${symbolName}.c`;

    return {
        id: entry.id,
        symbolName,
        width: bitmap.width,
        height: bitmap.height,
        colorFormat: cf,
        cRelativePath,
        cSource
    };
}

/**
 * Convert all images in a project for codegen export.
 */
export function convertProjectImages(
    project: EmbfProject,
    embfPath: string,
    _outputDir: string
): ProjectImagesConvertResult {
    const embfDir = path.dirname(embfPath);
    const lvglV9 = isLvglV9(project);
    const lvglInclude = resolveLvglIncludePath(project);
    const { entries, missingDefs, inferred } = resolveImagesToConvert(project, embfDir);

    const errors: string[] = missingDefs.map(
        id =>
            `Image widget references "${id}": add it to project.images[] with a valid path, or place the file ` +
            `(e.g. ${id}.png) next to the .embf file`
    );

    const assets: ConvertedImageAsset[] = [];
    const files = new Map<string, string>();

    const options: ImageConvertOptions = {
        embfDir,
        displayColorFormat: project.display.colorFormat,
        lvglV9,
        lvglInclude
    };

    for (const entry of entries) {
        try {
            const asset = convertImageAsset(entry, options);
            assets.push(asset);
            files.set(asset.cRelativePath, asset.cSource);
        } catch (e) {
            const msg =
                e instanceof ImageConvertError
                    ? e.message
                    : e instanceof Error
                      ? e.message
                      : String(e);
            errors.push(`images[${entry.id}]: ${msg}`);
        }
    }

    return { files, assets, errors, inferred };
}
