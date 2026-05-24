import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { LvglVersion } from "./types/embf";
import { buildNewProjectTemplate, sanitizeProjectFileName } from "./embfProjectTemplate";

const LVGL_VERSIONS: LvglVersion[] = ["9.5.0", "9.4.0", "9.3.0", "9.2.2", "8.4.0"];

export function getDefaultLvglVersion(): LvglVersion {
    const cfg = vscode.workspace.getConfiguration("embeddedflow").get<string>("defaultLvglVersion");
    return LVGL_VERSIONS.includes(cfg as LvglVersion) ? (cfg as LvglVersion) : "9.5.0";
}

async function pickProjectFolder(): Promise<string | undefined> {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders?.length) {
        const picked = await vscode.window.showOpenDialog({
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
            openLabel: "Select project folder"
        });
        return picked?.[0]?.fsPath;
    }

    type FolderPick = { label: string; description?: string; folderPath: string };
    const options: FolderPick[] = folders.map(f => ({
        label: `$(folder) ${f.name}`,
        description: f.uri.fsPath,
        folderPath: f.uri.fsPath
    }));
    options.push({
        label: "$(folder-opened) Choose another folder…",
        description: "Browse for a location outside the workspace",
        folderPath: "__browse__"
    });

    const choice = await vscode.window.showQuickPick(options, {
        placeHolder: "Where should the new .embf file be created?",
        title: "New EmbeddedFlow project"
    });
    if (!choice) {
        return undefined;
    }
    if (choice.folderPath === "__browse__") {
        const picked = await vscode.window.showOpenDialog({
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
            openLabel: "Select project folder"
        });
        return picked?.[0]?.fsPath;
    }
    return choice.folderPath;
}

/**
 * Wizard: pick folder, name, LVGL version; write starter `.embf`.
 * @returns Absolute path to the new file, or undefined if cancelled.
 */
export async function runNewProjectWizard(): Promise<string | undefined> {
    const folderPath = await pickProjectFolder();
    if (!folderPath) {
        return undefined;
    }

    const defaultName =
        vscode.workspace.workspaceFolders?.find(f => f.uri.fsPath === folderPath)?.name ?? "MyDisplay";

    const name = await vscode.window.showInputBox({
        title: "New EmbeddedFlow project",
        prompt: "Project name (used for the .embf filename and project metadata)",
        value: defaultName,
        validateInput: v => (v.trim() ? null : "Name cannot be empty")
    });
    if (!name) {
        return undefined;
    }

    const defaultLvgl = getDefaultLvglVersion();
    const lvglVersion = await vscode.window.showQuickPick(LVGL_VERSIONS, {
        placeHolder: "LVGL version for generated C code",
        title: "New EmbeddedFlow project",
        canPickMany: false
    });
    if (!lvglVersion) {
        return undefined;
    }

    const fileBase = sanitizeProjectFileName(name);
    const filePath = path.join(folderPath, `${fileBase}.embf`);

    if (fs.existsSync(filePath)) {
        const overwrite = await vscode.window.showWarningMessage(
            `"${path.basename(filePath)}" already exists in this folder.`,
            { modal: true },
            "Overwrite"
        );
        if (overwrite !== "Overwrite") {
            return undefined;
        }
    }

    const template = buildNewProjectTemplate(name, lvglVersion as LvglVersion);
    try {
        fs.writeFileSync(filePath, JSON.stringify(template, null, 2), "utf-8");
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        vscode.window.showErrorMessage(`embeddedflow: failed to create project: ${msg}`);
        return undefined;
    }

    return filePath;
}

/**
 * Run the wizard, open the new `.embf` in an editor, then optional hook (e.g. open preview).
 */
export async function runCreateNewProjectFlow(
    onCreated?: (filePath: string) => void | Promise<void>
): Promise<void> {
    const filePath = await runNewProjectWizard();
    if (!filePath) {
        return;
    }

    const doc = await vscode.workspace.openTextDocument(filePath);
    await vscode.window.showTextDocument(doc);
    if (onCreated) {
        await onCreated(filePath);
    }
    vscode.window.showInformationMessage(
        `embeddedflow: created ${path.basename(filePath)}`
    );
}
