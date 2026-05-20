import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import jpeg from "jpeg-js";
import { PNG } from "pngjs";
import {
    convertImageAsset,
    convertProjectImages,
    inferImageDefFromSrc,
    readImageFile
} from "../src/resources";
import { generateCode, writeGeneratedFiles } from "../src/codeGen/index";
import { minimalProject } from "./fixtures";

function writeTestPng(filePath: string, width: number, height: number): void {
    const data = Buffer.alloc(width * height * 4);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const i = (y * width + x) * 4;
            data[i] = 0x11 * (x + 1);
            data[i + 1] = 0x22 * (y + 1);
            data[i + 2] = 0x33;
            data[i + 3] = x === 0 ? 0 : 255;
        }
    }
    const png = new PNG({ width, height });
    data.copy(png.data);
    fs.writeFileSync(filePath, PNG.sync.write(png));
}

function writeTestJpeg(filePath: string, width: number, height: number): void {
    const data = Buffer.alloc(width * height * 4);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const i = (y * width + x) * 4;
            data[i] = 40;
            data[i + 1] = 80;
            data[i + 2] = 120;
            data[i + 3] = 255;
        }
    }
    const enc = jpeg.encode({ data, width, height }, 90);
    fs.writeFileSync(filePath, Buffer.from(enc.data));
}

/** Minimal 24-bit uncompressed BMP (BI_RGB, bottom-up). */
function writeTestBmp24(filePath: string, width: number, height: number): void {
    const rowBytes = Math.floor((24 * width + 31) / 32) * 4;
    const pixelBytes = rowBytes * height;
    const fileSize = 54 + pixelBytes;
    const buf = Buffer.alloc(fileSize, 0);
    buf.write("BM", 0);
    buf.writeUInt32LE(fileSize, 2);
    buf.writeUInt32LE(54, 10);
    buf.writeUInt32LE(40, 14);
    buf.writeInt32LE(width, 18);
    buf.writeInt32LE(height, 22);
    buf.writeUInt16LE(1, 26);
    buf.writeUInt16LE(24, 28);
    buf.writeUInt32LE(0, 30);
    for (let y = 0; y < height; y++) {
        const srcRow = height - 1 - y;
        const rowOff = 54 + srcRow * rowBytes;
        for (let x = 0; x < width; x++) {
            const o = rowOff + x * 3;
            buf[o] = 200;
            buf[o + 1] = 100;
            buf[o + 2] = 50;
        }
    }
    fs.writeFileSync(filePath, buf);
}

describe("image converter", () => {
    let tmpDir: string;

    beforeAll(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "embf-img-"));
    });

    it("converts a PNG to lv_image_dsc_t C source (LVGL 9)", () => {
        const pngPath = path.join(tmpDir, "icon.png");
        writeTestPng(pngPath, 4, 2);

        const asset = convertImageAsset(
            { id: "wifi_0", path: "icon.png" },
            {
                embfDir: tmpDir,
                displayColorFormat: "RGB565",
                lvglV9: true
            }
        );

        expect(asset.symbolName).toBe("ui_img_wifi_0");
        expect(asset.width).toBe(4);
        expect(asset.height).toBe(2);
        expect(asset.colorFormat).toBe("LV_COLOR_FORMAT_RGB565A8");
        expect(asset.cSource).toContain("lv_image_dsc_t ui_img_wifi_0");
        expect(asset.cSource).toContain("LV_COLOR_FORMAT_RGB565A8");
        expect(asset.cSource).toContain("ui_img_wifi_0_map[]");
    });

    it("reads JPEG and BMP into RGBA", () => {
        const jpg = path.join(tmpDir, "photo.jpg");
        const bmp = path.join(tmpDir, "icon.bmp");
        writeTestJpeg(jpg, 3, 2);
        writeTestBmp24(bmp, 4, 4);
        expect(readImageFile(jpg).width).toBe(3);
        expect(readImageFile(bmp).height).toBe(4);
    });

    it("converts JPEG and BMP assets for codegen", () => {
        const dir = path.join(tmpDir, "multi");
        fs.mkdirSync(dir, { recursive: true });
        writeTestJpeg(path.join(dir, "a.jpg"), 2, 2);
        writeTestBmp24(path.join(dir, "b.bmp"), 2, 2);

        const j = convertImageAsset(
            { id: "photo", path: "a.jpg" },
            { embfDir: dir, displayColorFormat: "ARGB8888", lvglV9: true }
        );
        const b = convertImageAsset(
            { id: "bmp_icon", path: "b.bmp" },
            { embfDir: dir, displayColorFormat: "ARGB8888", lvglV9: true }
        );
        expect(j.cSource).toContain("ui_img_photo");
        expect(b.cSource).toContain("ui_img_bmp_icon");
        expect(j.colorFormat).toBe("LV_COLOR_FORMAT_ARGB8888");
    });

    it("convertProjectImages emits per-image .c files in the output folder", () => {
        const embfDir = path.join(tmpDir, "proj");
        fs.mkdirSync(embfDir, { recursive: true });
        writeTestPng(path.join(embfDir, "a.png"), 2, 2);

        const project = minimalProject({
            display: {
                width: 320,
                height: 240,
                bitDepth: 16,
                colorFormat: "RGB565",
                orientation: "portrait",
                direction: "ltr"
            }
        });
        project.images = [{ id: "icon_a", path: "a.png" }];

        const embfPath = path.join(embfDir, "test.embf");
        const result = convertProjectImages(project, embfPath, path.join(embfDir, "out"));

        expect(result.errors).toHaveLength(0);
        expect(result.assets).toHaveLength(1);
        expect(result.files.has("ui_img_icon_a.c")).toBe(true);
        expect(result.files.has("ui_images.h")).toBe(false);
    });

    it("generateCode includes ui_img_*.c and image externs in ui.h", () => {
        const embfDir = path.join(tmpDir, "codegen");
        fs.mkdirSync(embfDir, { recursive: true });
        writeTestPng(path.join(embfDir, "logo.png"), 3, 3);

        const project = minimalProject({
            display: {
                width: 320,
                height: 240,
                bitDepth: 16,
                colorFormat: "RGB565",
                orientation: "portrait",
                direction: "ltr"
            }
        });
        project.images = [{ id: "logo", path: "logo.png" }];
        project.pages[0].components.push({
            id: "img_1",
            type: "image",
            x: 0,
            y: 0,
            width: 32,
            height: 32,
            src: "logo"
        });

        const embfPath = path.join(embfDir, "ui.embf");
        const outDir = path.join(embfDir, "ui_output");
        const gen = generateCode(project, embfPath, outDir);

        expect(gen.files.has(path.join(outDir, "ui_images.h"))).toBe(false);
        expect(gen.files.has(path.join(outDir, "ui_img_logo.c"))).toBe(true);
        expect(gen.files.get(path.join(outDir, "ui.h"))).toMatch(
            /extern const lv_(img|image)_dsc_t ui_img_logo/
        );
        expect(gen.files.get(path.join(outDir, "ui.h"))).not.toContain('#include "ui_images.h"');
        expect(gen.files.get(path.join(outDir, "ui_page_main.c"))).toContain("&ui_img_logo");
    });

    it("infers image from widget src path when project.images is empty", () => {
        const embfDir = path.join(tmpDir, "infer");
        fs.mkdirSync(path.join(embfDir, "icons"), { recursive: true });
        writeTestPng(path.join(embfDir, "icons", "signal.png"), 4, 4);

        const def = inferImageDefFromSrc(embfDir, "icons/signal.png");
        expect(def).toEqual({ id: "icons/signal.png", path: "icons/signal.png" });

        const project = minimalProject({
            display: {
                width: 320,
                height: 240,
                bitDepth: 16,
                colorFormat: "RGB565",
                orientation: "portrait",
                direction: "ltr"
            }
        });
        project.pages[0].components.push({
            id: "img_sig",
            type: "image",
            x: 0,
            y: 0,
            width: 16,
            height: 16,
            src: "icons/signal.png"
        });

        const embfPath = path.join(embfDir, "ui.embf");
        const outDir = path.join(embfDir, "ui_output");
        const gen = generateCode(project, embfPath, outDir);
        expect(gen.files.get(path.join(outDir, "ui.h"))).toContain("ui_img_icons_signal_png");
        expect(gen.files.has(path.join(outDir, "ui_img_icons_signal_png.c"))).toBe(true);
    });

    it("writeGeneratedFiles writes image .c next to ui.h", () => {
        const embfDir = path.join(tmpDir, "write-sub");
        fs.mkdirSync(embfDir, { recursive: true });
        writeTestPng(path.join(embfDir, "x.png"), 2, 2);
        const project = minimalProject({
            display: {
                width: 320,
                height: 240,
                bitDepth: 16,
                colorFormat: "RGB565",
                orientation: "portrait",
                direction: "ltr"
            }
        });
        project.images = [{ id: "x", path: "x.png" }];
        const outDir = path.join(embfDir, "out");
        const gen = generateCode(project, path.join(embfDir, "t.embf"), outDir);
        const written = writeGeneratedFiles(gen);
        expect(fs.existsSync(path.join(outDir, "ui_img_x.c"))).toBe(true);
        expect(written.some(p => p.endsWith("ui_img_x.c"))).toBe(true);
    });

    it("generateCode omits image externs when image file is missing", () => {
        const embfDir = path.join(tmpDir, "missing-img");
        fs.mkdirSync(embfDir, { recursive: true });
        const project = minimalProject({
            display: {
                width: 320,
                height: 240,
                bitDepth: 16,
                colorFormat: "RGB565",
                orientation: "portrait",
                direction: "ltr"
            }
        });
        project.images = [{ id: "ghost", path: "not_on_disk.png" }];
        const embfPath = path.join(embfDir, "ui.embf");
        const outDir = path.join(embfDir, "ui_output");
        const gen = generateCode(project, embfPath, outDir);
        expect(gen.files.has(path.join(outDir, "ui_img_ghost.c"))).toBe(false);
        expect(gen.files.get(path.join(outDir, "ui.h"))).not.toContain("ui_img_ghost");
        expect(gen.imageWarnings.length).toBeGreaterThan(0);
    });
});
