import * as path from "path";
import { describe, expect, it } from "vitest";
import {
    PINNED_CLANGD_VERSION,
    clangdDownloadUrl,
    clangdReleaseZipName,
    detectClangdPlatform,
    managedClangdRoot
} from "../src/symbolDiscovery/clangdInstall";

describe("clangdInstall", () => {
    it("detectClangdPlatform maps win32/linux/darwin", () => {
        expect(["windows", "linux", "mac"]).toContain(detectClangdPlatform());
    });

    it("clangdReleaseZipName follows official release naming", () => {
        expect(clangdReleaseZipName("windows")).toBe(`clangd-windows-${PINNED_CLANGD_VERSION}.zip`);
        expect(clangdReleaseZipName("linux")).toBe(`clangd-linux-${PINNED_CLANGD_VERSION}.zip`);
        expect(clangdReleaseZipName("mac")).toBe(`clangd-mac-${PINNED_CLANGD_VERSION}.zip`);
    });

    it("clangdDownloadUrl points at GitHub releases", () => {
        expect(clangdDownloadUrl("windows")).toBe(
            `https://github.com/clangd/clangd/releases/download/${PINNED_CLANGD_VERSION}/clangd-windows-${PINNED_CLANGD_VERSION}.zip`
        );
    });

    it("managedClangdRoot nests under global storage", () => {
        expect(managedClangdRoot("/data/ext")).toBe(
            path.normalize(path.join("/data/ext", "clangd", PINNED_CLANGD_VERSION))
        );
    });
});
