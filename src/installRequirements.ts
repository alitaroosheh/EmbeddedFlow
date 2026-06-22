import * as vscode from "vscode";
import { embeddedFlowLog } from "./outputLog";
import { PINNED_CLANGD_VERSION } from "./symbolDiscovery/clangdInstall";
import { ensureManagedClangd, isManagedClangdInstalled, resolveClangdPath } from "./symbolDiscovery/clangdBootstrap";
import { readManagedClangdMarker } from "./symbolDiscovery/clangdInstall";
import { symbolDiscovery } from "./symbolDiscovery";

const CONSENT_KEY = "requirements.clangdConsent";

export async function runInstallRequirementsWizard(context: vscode.ExtensionContext): Promise<boolean> {
    const globalStoragePath = context.globalStorageUri.fsPath;
    const cfg = vscode.workspace.getConfiguration("embeddedflow");
    const alreadyInstalled = isManagedClangdInstalled(globalStoragePath);

    if (!alreadyInstalled) {
        const consent = context.globalState.get<string>(CONSENT_KEY);
        if (consent !== "granted") {
            const choice = await vscode.window.showInformationMessage(
                `EmbeddedFlow can download **clangd ${PINNED_CLANGD_VERSION}** (~30–115 MB, one time) from the official LLVM/clangd project (Apache-2.0). ` +
                    `This enables firmware symbol discovery for binding UI to C code. Preview and codegen work without it.`,
                { modal: true },
                "Download clangd",
                "Use my own clangd",
                "Not now"
            );
            if (choice === "Not now" || choice === undefined) {
                return false;
            }
            if (choice === "Use my own clangd") {
                const picked = await vscode.window.showOpenDialog({
                    canSelectFiles: true,
                    canSelectFolders: false,
                    canSelectMany: false,
                    filters: process.platform === "win32" ? { Executable: ["exe"] } : undefined,
                    title: "Select clangd executable"
                });
                if (!picked?.length) {
                    return false;
                }
                await cfg.update("clangdPath", picked[0].fsPath, vscode.ConfigurationTarget.Global);
                symbolDiscovery.setClangdPath(picked[0].fsPath);
                void vscode.window.showInformationMessage(`EmbeddedFlow will use: ${picked[0].fsPath}`);
                return true;
            }
            await context.globalState.update(CONSENT_KEY, "granted");
        }
    }

    if (alreadyInstalled) {
        const exe = readManagedClangdMarker(globalStoragePath)!;
        symbolDiscovery.setGlobalStoragePath(globalStoragePath);
        symbolDiscovery.setClangdPath(exe);
        void vscode.window.showInformationMessage(`EmbeddedFlow: clangd already installed (${exe}).`);
        return true;
    }

    try {
        const exe = await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: "EmbeddedFlow: installing requirements…",
                cancellable: false
            },
            async progress => {
                return ensureManagedClangd(globalStoragePath, {
                    onProgress: msg => progress.report({ message: msg })
                });
            }
        );
        symbolDiscovery.setGlobalStoragePath(globalStoragePath);
        symbolDiscovery.setClangdPath(exe);
        embeddedFlowLog("requirements", "info", `clangd installed: ${exe}`);
        void vscode.window.showInformationMessage(`EmbeddedFlow: clangd ${PINNED_CLANGD_VERSION} is ready.`);
        return true;
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        embeddedFlowLog("requirements", "error", msg);
        void vscode.window.showErrorMessage(`EmbeddedFlow: install failed — ${msg}`);
        return false;
    }
}

/** If clangd missing, offer wizard once (non-blocking). */
export async function offerRequirementsWizardIfNeeded(context: vscode.ExtensionContext): Promise<void> {
    const globalStoragePath = context.globalStorageUri.fsPath;
    symbolDiscovery.setGlobalStoragePath(globalStoragePath);
    const path = resolveClangdPath({ globalStoragePath });
    if (path) {
        symbolDiscovery.setClangdPath(path);
        return;
    }
    const choice = await vscode.window.showInformationMessage(
        "EmbeddedFlow needs clangd for symbol discovery. Run Install requirements?",
        "Install requirements",
        "Later"
    );
    if (choice === "Install requirements") {
        await runInstallRequirementsWizard(context);
    }
}
