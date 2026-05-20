import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { PNG } from "pngjs";
import { resolveImageFileOnDisk } from "../src/embfImagePreview";
import { minimalProject } from "./fixtures";

function writeTestPng(filePath: string): void {
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
    const png = new PNG({ width: 2, height: 2 });
    fs.writeFileSync(filePath, PNG.sync.write(png));
}

describe("embf image preview", () => {
    let tmpDir: string;

    beforeAll(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "embf-prev-"));
    });

    it("resolveImageFileOnDisk finds files under multiple search roots", () => {
        const embfDir = path.join(tmpDir, "proj");
        const assetsDir = path.join(tmpDir, "out", "assets");
        writeTestPng(path.join(assetsDir, "logo.png"));

        const found = resolveImageFileOnDisk("assets/logo.png", [embfDir, path.join(tmpDir, "out")]);
        expect(found).toBe(path.join(assetsDir, "logo.png"));
    });

    it("resolveImageFileOnDisk tries id without extension", () => {
        const root = path.join(tmpDir, "ext");
        writeTestPng(path.join(root, "wifi.png"));
        expect(resolveImageFileOnDisk("wifi", [root])).toBe(path.join(root, "wifi.png"));
    });
});
