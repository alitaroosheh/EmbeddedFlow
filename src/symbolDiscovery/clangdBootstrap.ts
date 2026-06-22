import * as path from "path";
import * as vscode from "vscode";
import { resolveClangdExecutable } from "./clangdSession";
import { installManagedClangd, readManagedClangdMarker } from "./clangdInstall";

function userConfiguredClangdPath(cfg: vscode.WorkspaceConfiguration): string | undefined {
    const inspect = cfg.inspect<string>("clangdPath");
    if (inspect?.globalValue !== undefined || inspect?.workspaceValue !== undefined) {
        return (cfg.get<string>("clangdPath") ?? "clangd").trim();
    }
    return undefined;
}

export interface ClangdResolveOptions {
    globalStoragePath?: string;
    configuredPath?: string;
    allowSystemFallback?: boolean;
    preferManaged?: boolean;
}

/**
 * Resolve clangd executable path.
 * Priority: user setting → managed install → system PATH (optional).
 */
export function resolveClangdPath(opts: ClangdResolveOptions = {}): string | undefined {
    const cfg = vscode.workspace.getConfiguration("embeddedflow");
    const userPath = opts.configuredPath ?? userConfiguredClangdPath(cfg);
    const allowSystem = opts.allowSystemFallback ?? cfg.get<boolean>("clangd.useSystem", false);
    const preferManaged = opts.preferManaged ?? cfg.get<boolean>("clangd.preferManaged", true);

    if (userPath) {
        const explicit = resolveClangdExecutable(userPath);
        if (explicit) {
            return explicit;
        }
    }

    if (preferManaged && opts.globalStoragePath) {
        const managed = readManagedClangdMarker(opts.globalStoragePath);
        if (managed) {
            return managed;
        }
    }

    if (allowSystem || !preferManaged) {
        return resolveClangdExecutable("clangd");
    }

    return undefined;
}

export async function ensureManagedClangd(
    globalStoragePath: string,
    opts?: { force?: boolean; onProgress?: (msg: string) => void }
): Promise<string> {
    const existing = readManagedClangdMarker(globalStoragePath);
    if (existing && !opts?.force) {
        return existing;
    }
    return installManagedClangd({
        globalStoragePath,
        force: opts?.force,
        onProgress: opts?.onProgress
    });
}

export function isManagedClangdInstalled(globalStoragePath: string): boolean {
    return readManagedClangdMarker(globalStoragePath) !== undefined;
}
