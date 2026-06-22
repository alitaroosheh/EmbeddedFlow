import * as fs from "fs";
import * as path from "path";
import { spawnSync } from "child_process";
import { embeddedFlowLog } from "../outputLog";

/** Pinned clangd version tested with EmbeddedFlow symbol discovery. */
export const PINNED_CLANGD_VERSION = "22.1.6";

const RELEASE_BASE = `https://github.com/clangd/clangd/releases/download/${PINNED_CLANGD_VERSION}`;

export type ClangdPlatform = "windows" | "linux" | "mac";

export function detectClangdPlatform(): ClangdPlatform | undefined {
    switch (process.platform) {
        case "win32":
            return "windows";
        case "linux":
            return "linux";
        case "darwin":
            return "mac";
        default:
            return undefined;
    }
}

export function clangdReleaseZipName(platform: ClangdPlatform): string {
    return `clangd-${platform}-${PINNED_CLANGD_VERSION}.zip`;
}

export function clangdDownloadUrl(platform: ClangdPlatform): string {
    return `${RELEASE_BASE}/${clangdReleaseZipName(platform)}`;
}

/** Directory where managed clangd for a version is installed. */
export function managedClangdRoot(globalStoragePath: string, version = PINNED_CLANGD_VERSION): string {
    return path.join(globalStoragePath, "clangd", version);
}

/** Marker file written after successful install. */
export function managedClangdMarkerPath(globalStoragePath: string, version = PINNED_CLANGD_VERSION): string {
    return path.join(managedClangdRoot(globalStoragePath, version), ".installed");
}

export function readManagedClangdMarker(globalStoragePath: string, version = PINNED_CLANGD_VERSION): string | undefined {
    const marker = managedClangdMarkerPath(globalStoragePath, version);
    try {
        const exe = fs.readFileSync(marker, "utf8").trim();
        if (exe && fs.existsSync(exe)) {
            return exe;
        }
    } catch {
        /* not installed */
    }
    return undefined;
}

function findClangdBinary(dir: string): string | undefined {
    const stack = [dir];
    while (stack.length) {
        const current = stack.pop()!;
        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(current, { withFileTypes: true });
        } catch {
            continue;
        }
        for (const ent of entries) {
            const full = path.join(current, ent.name);
            if (ent.isDirectory()) {
                stack.push(full);
            } else if (ent.isFile()) {
                const base = ent.name.toLowerCase();
                if (base === "clangd" || base === "clangd.exe") {
                    return full;
                }
            }
        }
    }
    return undefined;
}

function verifyClangdExecutable(exePath: string): boolean {
    const probe = spawnSync(exePath, ["--version"], {
        encoding: "utf8",
        timeout: 10_000,
        windowsHide: true
    });
    return probe.status === 0;
}

async function extractZip(zipPath: string, destDir: string): Promise<void> {
    fs.mkdirSync(destDir, { recursive: true });

    const tar = spawnSync("tar", ["-xf", zipPath, "-C", destDir], {
        encoding: "utf8",
        timeout: 120_000,
        windowsHide: true
    });
    if (tar.status === 0) {
        return;
    }

    if (process.platform === "win32") {
        const ps =
            `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' ` +
            `-DestinationPath '${destDir.replace(/'/g, "''")}' -Force`;
        const r = spawnSync(
            "powershell",
            ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps],
            { encoding: "utf8", timeout: 120_000, windowsHide: true }
        );
        if (r.status === 0) {
            return;
        }
        throw new Error(r.stderr?.trim() || r.stdout?.trim() || "Expand-Archive failed");
    }

    const r = spawnSync("unzip", ["-o", zipPath, "-d", destDir], {
        encoding: "utf8",
        timeout: 120_000
    });
    if (r.status !== 0) {
        throw new Error(r.stderr?.trim() || tar.stderr?.trim() || "Failed to extract zip");
    }
}

export interface InstallClangdOptions {
    globalStoragePath: string;
    version?: string;
    force?: boolean;
    onProgress?: (message: string) => void;
}

/** Download and install managed clangd into extension global storage. */
export async function installManagedClangd(opts: InstallClangdOptions): Promise<string> {
    const version = opts.version ?? PINNED_CLANGD_VERSION;
    const platform = detectClangdPlatform();
    if (!platform) {
        throw new Error(`Unsupported platform for managed clangd: ${process.platform}`);
    }

    const existing = readManagedClangdMarker(opts.globalStoragePath, version);
    if (!opts.force && existing) {
        return existing;
    }

    const root = managedClangdRoot(opts.globalStoragePath, version);
    const zipPath = path.join(root, clangdReleaseZipName(platform));
    const extractDir = path.join(root, "extract");
    const url = clangdDownloadUrl(platform);

    opts.onProgress?.(`Downloading clangd ${version} (${platform})…`);
    embeddedFlowLog("clangd", "info", `Downloading ${url}`);

    fs.mkdirSync(root, { recursive: true });
    const res = await fetch(url);
    if (!res.ok) {
        throw new Error(`Download failed (${res.status}): ${url}`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(zipPath, buf);

    opts.onProgress?.("Extracting clangd…");
    if (fs.existsSync(extractDir)) {
        fs.rmSync(extractDir, { recursive: true, force: true });
    }
    await extractZip(zipPath, extractDir);

    const exe = findClangdBinary(extractDir);
    if (!exe) {
        throw new Error("clangd binary not found after extract");
    }
    if (!verifyClangdExecutable(exe)) {
        throw new Error(`Installed binary failed verification: ${exe}`);
    }

    fs.writeFileSync(managedClangdMarkerPath(opts.globalStoragePath, version), exe, "utf8");
    try {
        fs.unlinkSync(zipPath);
    } catch {
        /* optional cleanup */
    }

    embeddedFlowLog("clangd", "info", `Managed clangd ready: ${exe}`);
    opts.onProgress?.(`clangd ${version} installed.`);
    return exe;
}
