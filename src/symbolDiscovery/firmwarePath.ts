import * as fs from "fs";
import * as path from "path";
import type { EmbfProject } from "../types/embf";
import type { FirmwareLink, FirmwareLinkResult } from "./types";

/** POSIX absolute paths and Windows drive/UNC paths. */
function isAbsolutePath(p: string): boolean {
    if (path.isAbsolute(p)) {
        return true;
    }
    const s = p.replace(/\\/g, "/");
    return /^[A-Za-z]:\//.test(s) || /^[A-Za-z]:$/.test(s) || s.startsWith("//");
}

/** Store a picked firmware folder in .embf relative to the project file when possible. */
export function formatFirmwarePathForStorage(embfPath: string, chosenDir: string): string {
    const embfDir = path.dirname(embfPath);
    const rel = path.relative(embfDir, chosenDir);
    if (rel && !rel.startsWith("..") && !path.isAbsolute(rel)) {
        return rel.split(path.sep).join("/");
    }
    return chosenDir;
}

/** Resolve `project.firmwarePath` to an absolute directory. */
export function resolveFirmwareRootFromProject(project: EmbfProject, embfPath: string): string | undefined {
    const raw = project.project.firmwarePath?.trim();
    if (!raw) {
        return undefined;
    }
    const resolved = isAbsolutePath(raw)
        ? path.normalize(raw)
        : path.normalize(path.join(path.dirname(embfPath), raw));
    return resolved;
}

/** Resolve absolute firmware root for display in the preview inspector. */
export function resolveFirmwareRootDisplay(project: EmbfProject, embfPath: string): string {
    return resolveFirmwareRootFromProject(project, embfPath) ?? "";
}

const COMPILE_COMMANDS = "compile_commands.json";

/**
 * Locate `compile_commands.json` for a firmware tree.
 * ESP-IDF / CMake: prefer `<root>/build/compile_commands.json`, then `<root>/compile_commands.json`.
 */
export function resolveCompileCommands(firmwareRoot: string): FirmwareLink {
    const root = path.normalize(firmwareRoot);
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
        return {
            ok: false,
            code: "invalid_path",
            message: `Firmware path is not a directory: ${root}`
        };
    }

    const candidates = [
        path.join(root, "build", COMPILE_COMMANDS),
        path.join(root, COMPILE_COMMANDS)
    ];
    for (const compileCommandsPath of candidates) {
        if (fs.existsSync(compileCommandsPath) && fs.statSync(compileCommandsPath).isFile()) {
            const link: FirmwareLinkResult = {
                ok: true,
                firmwareRoot: root,
                compileCommandsPath,
                compileCommandsDir: path.dirname(compileCommandsPath)
            };
            return link;
        }
    }

    return {
        ok: false,
        code: "missing_compile_commands",
        message:
            `No compile_commands.json under "${root}". ` +
            `Build the firmware project first (e.g. idf.py build) so ` +
            `build/compile_commands.json exists.`
    };
}

/** FR-LINK-02: quick scan — workspace roots, parent dirs, and .embf folder (no deep tree walk). */
export function findFirmwareRootFromWorkspace(
    workspaceFolders: string[],
    extraDirs: string[] = []
): string | undefined {
    const seen = new Set<string>();
    const dirs: string[] = [];

    for (const folder of workspaceFolders) {
        const root = path.normalize(folder);
        dirs.push(root, path.dirname(root));
    }
    for (const extra of extraDirs) {
        if (extra) {
            dirs.push(path.normalize(extra));
        }
    }

    let best: { root: string; depth: number } | undefined;

    for (const dir of dirs) {
        if (!dir || seen.has(dir)) {
            continue;
        }
        seen.add(dir);

        let stat: fs.Stats;
        try {
            stat = fs.statSync(dir);
        } catch {
            continue;
        }
        if (!stat.isDirectory()) {
            continue;
        }

        const ccBuild = path.join(dir, "build", COMPILE_COMMANDS);
        if (fs.existsSync(ccBuild)) {
            const depth = dir.split(path.sep).length;
            if (!best || depth > best.depth) {
                best = { root: dir, depth };
            }
            continue;
        }

        const ccRoot = path.join(dir, COMPILE_COMMANDS);
        if (fs.existsSync(ccRoot) && path.basename(dir) !== "build") {
            const depth = dir.split(path.sep).length;
            if (!best || depth > best.depth) {
                best = { root: dir, depth };
            }
        }
    }

    return best?.root;
}

export function linkFirmwareProject(
    project: EmbfProject,
    embfPath: string,
    workspaceFolders: string[] = []
): FirmwareLink {
    const fromEmbf = resolveFirmwareRootFromProject(project, embfPath);
    if (fromEmbf) {
        return resolveCompileCommands(fromEmbf);
    }

    const fromWs = findFirmwareRootFromWorkspace(workspaceFolders, [path.dirname(embfPath)]);
    if (fromWs) {
        return resolveCompileCommands(fromWs);
    }

    return {
        ok: false,
        code: "missing_firmware",
        message:
            "Firmware path is not set. Set project.firmwarePath in the page inspector " +
            "or open a workspace folder that contains compile_commands.json."
    };
}

export function compileCommandsMtime(compileCommandsPath: string): number {
    try {
        return fs.statSync(compileCommandsPath).mtimeMs;
    } catch {
        return 0;
    }
}
