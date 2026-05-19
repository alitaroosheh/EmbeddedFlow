import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { collectEmbfInRoots, listEmbfInDirectory } from "../src/embfDiscovery";

describe("embf discovery", () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "embf-disc-"));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it("lists only .embf files in a directory (not subfolders)", () => {
        fs.writeFileSync(path.join(tmpDir, "a.embf"), "{}");
        fs.writeFileSync(path.join(tmpDir, "b.txt"), "");
        fs.mkdirSync(path.join(tmpDir, "nested"));
        fs.writeFileSync(path.join(tmpDir, "nested", "c.embf"), "{}");

        const found = listEmbfInDirectory(tmpDir);
        expect(found).toHaveLength(1);
        expect(path.basename(found[0])).toBe("a.embf");
    });

    it("collects from multiple roots without duplicates", () => {
        const other = fs.mkdtempSync(path.join(os.tmpdir(), "embf-disc2-"));
        try {
            fs.writeFileSync(path.join(tmpDir, "one.embf"), "{}");
            fs.writeFileSync(path.join(other, "two.embf"), "{}");
            const all = collectEmbfInRoots([tmpDir, other]);
            expect(all).toHaveLength(2);
        } finally {
            fs.rmSync(other, { recursive: true, force: true });
        }
    });
});
