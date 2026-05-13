import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { EmbfPreviewPanel } from "./previewPanel";
import { EmbfParseError, parseEmbf, parseEmbfSource, watchEmbf } from "./embfParser";
import { lintEmbfProject } from "./embfSemanticLint";
import { EmbfProject } from "./types/embf";
import { generateCode, writeGeneratedFiles } from "./codeGen/index";

// Map from .embf file path → file watcher
const watchers = new Map<string, fs.FSWatcher>();

const embfDiagnostics = vscode.languages.createDiagnosticCollection("embeddedflow");
const embfLintDebounceMs = 400;
const embfLintTimers = new Map<string, ReturnType<typeof setTimeout>>();

export function activate(context: vscode.ExtensionContext): void {
    context.subscriptions.push(embfDiagnostics);

    // ── Command: Open Preview ─────────────────────────────────────────────────
    context.subscriptions.push(
        vscode.commands.registerCommand("embeddedflow.openPreview", (uri?: vscode.Uri) => {
            const filePath = resolveFilePath(uri);
            if (!filePath) {
                vscode.window.showErrorMessage(
                    "EmbeddedFlow: No .embf file is active. Open a .embf file first."
                );
                return;
            }
            openPreview(filePath, context.extensionUri);
        })
    );

    // ── Command: New Project ──────────────────────────────────────────────────
    context.subscriptions.push(
        vscode.commands.registerCommand("embeddedflow.newProject", async () => {
            await createNewProject(context.extensionUri);
        })
    );

    // ── Command: Generate C Code ──────────────────────────────────────────────
    context.subscriptions.push(
        vscode.commands.registerCommand("embeddedflow.generateCode", async (uri?: vscode.Uri) => {
            const filePath = resolveFilePath(uri);
            if (!filePath) {
                vscode.window.showErrorMessage("EmbeddedFlow: No .embf file is active.");
                return;
            }
            await runCodeGen(filePath);
        })
    );

    // ── Auto-open preview + diagnostics when a .embf document is opened ─────
    context.subscriptions.push(
        vscode.workspace.onDidOpenTextDocument(doc => {
            if (doc.fileName.endsWith(".embf")) {
                openPreview(doc.fileName, context.extensionUri);
            }
            if (isEmbfDocument(doc)) {
                updateEmbfDiagnostics(doc);
            }
        })
    );

    // ── If a .embf is already active on startup, open its preview ────────────
    const activeDoc = vscode.window.activeTextEditor?.document;
    if (activeDoc?.fileName.endsWith(".embf")) {
        openPreview(activeDoc.fileName, context.extensionUri);
    }

    // ── Problems panel: semantic validation beyond JSON schema ──────────────
    for (const doc of vscode.workspace.textDocuments) {
        if (isEmbfDocument(doc)) {
            updateEmbfDiagnostics(doc);
        }
    }
    context.subscriptions.push(
        vscode.workspace.onDidSaveTextDocument(doc => {
            if (isEmbfDocument(doc)) {
                updateEmbfDiagnostics(doc);
            }
        })
    );
    context.subscriptions.push(
        vscode.workspace.onDidCloseTextDocument(doc => {
            if (isEmbfDocument(doc)) {
                embfDiagnostics.delete(doc.uri);
                const key = doc.uri.toString();
                const t = embfLintTimers.get(key);
                if (t) {
                    clearTimeout(t);
                    embfLintTimers.delete(key);
                }
            }
        })
    );
    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument(ev => {
            const doc = ev.document;
            if (!isEmbfDocument(doc)) {
                return;
            }
            const key = doc.uri.toString();
            const prev = embfLintTimers.get(key);
            if (prev) {
                clearTimeout(prev);
            }
            embfLintTimers.set(
                key,
                setTimeout(() => {
                    embfLintTimers.delete(key);
                    updateEmbfDiagnostics(doc);
                }, embfLintDebounceMs)
            );
        })
    );
}

function isEmbfDocument(doc: vscode.TextDocument): boolean {
    return doc.languageId === "embf" || doc.fileName.toLowerCase().endsWith(".embf");
}

function embfFallbackRange(doc: vscode.TextDocument): vscode.Range {
    const lastLine = Math.max(0, doc.lineCount - 1);
    const endChar = doc.lineAt(lastLine).text.length;
    return new vscode.Range(0, 0, lastLine, endChar);
}

function updateEmbfDiagnostics(doc: vscode.TextDocument): void {
    if (!isEmbfDocument(doc)) {
        return;
    }
    const text = doc.getText();
    try {
        const project = parseEmbfSource(text);
        const semantic = lintEmbfProject(text, project);
        if (semantic.length === 0) {
            embfDiagnostics.delete(doc.uri);
            return;
        }
        const diags = semantic.map(issue => {
            const range = issue.range
                ? new vscode.Range(
                      doc.positionAt(issue.range.start),
                      doc.positionAt(issue.range.end)
                  )
                : embfFallbackRange(doc);
            const d = new vscode.Diagnostic(range, issue.message, vscode.DiagnosticSeverity.Error);
            d.source = "embeddedflow";
            return d;
        });
        embfDiagnostics.set(doc.uri, diags);
    } catch (e) {
        const msg = e instanceof EmbfParseError ? e.message : String(e);
        const d = new vscode.Diagnostic(embfFallbackRange(doc), msg, vscode.DiagnosticSeverity.Error);
        d.source = "embeddedflow";
        embfDiagnostics.set(doc.uri, [d]);
    }
}

export function deactivate(): void {
    for (const watcher of watchers.values()) {
        watcher.close();
    }
    watchers.clear();
}

// ─────────────────────────────────────────────────────────────────────────────

function resolveFilePath(uri?: vscode.Uri): string | undefined {
    if (uri) {
        return uri.fsPath;
    }
    const doc = vscode.window.activeTextEditor?.document;
    if (doc?.fileName.endsWith(".embf")) {
        return doc.fileName;
    }
    return undefined;
}

function openPreview(filePath: string, extensionUri: vscode.Uri): void {
    // Parse immediately so the panel can show the current state
    let project: EmbfProject | EmbfParseError;
    try {
        project = parseEmbf(filePath);
    } catch (e) {
        project = e instanceof EmbfParseError ? e : new EmbfParseError(String(e));
    }

    const panel = EmbfPreviewPanel.createOrShow(filePath, extensionUri);

    if (project instanceof EmbfParseError) {
        panel.sendError(project.message);
    } else {
        panel.sendProject(project);
    }

    // Set up file watcher if not already watching
    if (!watchers.has(filePath)) {
        const watcher = watchEmbf(filePath, result => {
            const p = EmbfPreviewPanel.getPanel(filePath);
            if (!p) {
                // Panel was closed — stop watching
                watcher.close();
                watchers.delete(filePath);
                return;
            }
            if (result instanceof EmbfParseError) {
                p.sendError(result.message);
            } else {
                p.sendProject(result);
            }
        });
        watchers.set(filePath, watcher);
    }
}

async function runCodeGen(filePath: string): Promise<void> {
    let project: EmbfProject;
    try {
        project = parseEmbf(filePath);
    } catch (e: any) {
        vscode.window.showErrorMessage(`EmbeddedFlow: ${e.message}`);
        return;
    }

    const result = generateCode(project, filePath);
    const outputDir = result.outputDir;

    // Confirm if output directory already exists and has files
    if (fs.existsSync(outputDir) && fs.readdirSync(outputDir).some(f => f.endsWith(".c") || f.endsWith(".h"))) {
        const choice = await vscode.window.showWarningMessage(
            `Output folder already exists:\n${outputDir}\n\nOverwrite generated files?`,
            { modal: true },
            "Overwrite",
            "Cancel"
        );
        if (choice !== "Overwrite") return;
    }

    let written: string[];
    try {
        written = writeGeneratedFiles(result);
    } catch (e: any) {
        vscode.window.showErrorMessage(`EmbeddedFlow: Failed to write files: ${e.message}`);
        return;
    }

    // Show success notification with a button to open the output folder
    const rel = path.relative(path.dirname(filePath), outputDir);
    const action = await vscode.window.showInformationMessage(
        `Generated ${written.length} files → ${rel}/`,
        "Open Folder",
        "Show ui.c"
    );

    if (action === "Open Folder") {
        await vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(outputDir));
    } else if (action === "Show ui.c") {
        const uiC = path.join(outputDir, "ui.c");
        const doc = await vscode.workspace.openTextDocument(uiC);
        await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
    }
}

async function createNewProject(extensionUri: vscode.Uri): Promise<void> {
    const folderUri = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        openLabel: "Select project folder"
    });
    if (!folderUri || folderUri.length === 0) {
        return;
    }

    const name = await vscode.window.showInputBox({
        prompt: "Project name",
        value: "MyDisplay",
        validateInput: v => (v.trim() ? null : "Name cannot be empty")
    });
    if (!name) {
        return;
    }

    const lvglVersion = await vscode.window.showQuickPick(
        ["9.5.0", "9.4.0", "9.3.0", "9.2.2", "8.4.0"],
        { placeHolder: "Select LVGL version" }
    );
    if (!lvglVersion) {
        return;
    }

    const filePath = path.join(folderUri[0].fsPath, `${name}.embf`);

    const template: EmbfProject = {
        version: "1.0",
        project: {
            name,
            lvglVersion: lvglVersion as EmbfProject["project"]["lvglVersion"],
            description: ""
        },
        display: {
            width: 320,
            height: 240,
            bitDepth: 16,
            colorFormat: "RGB565",
            orientation: "landscape",
            direction: "ltr",
            dpi: 100
        },
        theme: {
            dark: false
        },
        pages: [
            {
                id: "page_main",
                name: "Main",
                backgroundColor: "#ffffff",
                components: [
                    {
                        id: "lbl_hello",
                        type: "label",
                        x: 10,
                        y: 10,
                        width: 200,
                        height: 30,
                        text: "Hello, EmbeddedFlow!",
                        styles: {
                            fontSize: 16,
                            textColor: "#000000"
                        }
                    }
                ]
            }
        ]
    };

    try {
        fs.writeFileSync(filePath, JSON.stringify(template, null, 2), "utf-8");
    } catch (e: any) {
        vscode.window.showErrorMessage(`Failed to create project: ${e.message}`);
        return;
    }

    const doc = await vscode.workspace.openTextDocument(filePath);
    await vscode.window.showTextDocument(doc);
}
