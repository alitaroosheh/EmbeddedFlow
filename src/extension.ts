import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { EmbfPreviewPanel } from "./previewPanel";
import { EmbfParseError, parseEmbf, parseEmbfSource, watchEmbf } from "./embfParser";
import { lintEmbfProject } from "./embfSemanticLint";
import { EmbfProject } from "./types/embf";
import { generateCode, resolveCodegenOutputDir, writeGeneratedFiles, type CodeGenResult } from "./codeGen/index";
import { ensureCodegenOutputPath } from "./embfCodegenSetup";
import { registerEmbeddedFlowOutput, embeddedFlowLog } from "./outputLog";
import { resolveEmbfForPreview } from "./embfPreviewResolve";
import { readEmbfText } from "./embfHistory";
import { runCreateNewProjectFlow } from "./embfNewProject";

// Map from .embf file path → file watcher
const watchers = new Map<string, fs.FSWatcher>();

const embfDiagnostics = vscode.languages.createDiagnosticCollection("embeddedflow");
const embfLintDebounceMs = 400;
const embfLintTimers = new Map<string, ReturnType<typeof setTimeout>>();
const liveGenDebounceMs = 600;
const liveGenTimers = new Map<string, ReturnType<typeof setTimeout>>();
const previewRefreshDebounceMs = 280;
const previewRefreshTimers = new Map<string, ReturnType<typeof setTimeout>>();

export function activate(context: vscode.ExtensionContext): void {
    const embfOutput = vscode.window.createOutputChannel("embeddedflow");
    context.subscriptions.push(embfOutput);
    registerEmbeddedFlowOutput(embfOutput);

    context.subscriptions.push(embfDiagnostics);

    // Register commands first — if later setup throws, palette commands still work.
    const runNewProjectCmd = async () => {
        await runCreateNewProjectFlow(filePath => {
            if (shouldAutoOpenPreview()) {
                openPreview(filePath, context.extensionUri);
            }
        });
    };
    context.subscriptions.push(
        vscode.commands.registerCommand("embeddedflow.openPreview", async (uri?: vscode.Uri) => {
            await openPreviewResolved(context.extensionUri, uri);
        }),
        vscode.commands.registerCommand("embeddedflow.newProject", runNewProjectCmd),
        vscode.commands.registerCommand("embeddedflow.newproject", runNewProjectCmd),
        vscode.commands.registerCommand("embeddedflow.generateCode", async (uri?: vscode.Uri) => {
            const filePath = await resolveCodegenEmbfPath(uri);
            if (!filePath) {
                vscode.window.showErrorMessage(
                    "EmbeddedFlow: Open a .embf file or UI preview, then run Generate C Code."
                );
                return;
            }
            await runCodeGen(filePath);
        }),
        vscode.commands.registerCommand("embeddedflow.showOutput", () => {
            embfOutput.show(true);
        })
    );

    // ── Auto-open preview (optional) + diagnostics when a .embf document opens ─
    context.subscriptions.push(
        vscode.workspace.onDidOpenTextDocument(doc => {
            if (doc.fileName.endsWith(".embf") && shouldAutoOpenPreview()) {
                openPreview(doc.fileName, context.extensionUri);
            }
            if (isEmbfDocument(doc)) {
                updateEmbfDiagnostics(doc);
            }
        })
    );

    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(ev => {
            if (!ev.affectsConfiguration("embeddedflow.autoOpenPreview")) {
                return;
            }
            if (!shouldAutoOpenPreview()) {
                return;
            }
            void openPreviewResolved(context.extensionUri);
        })
    );

    // ── Auto-open preview from workspace folder .embf (no editor tab required) ─
    if (shouldAutoOpenPreview()) {
        void openPreviewResolved(context.extensionUri);
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
            scheduleLiveGenerateOnSave(doc);
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
                const liveT = liveGenTimers.get(doc.uri.fsPath);
                if (liveT) {
                    clearTimeout(liveT);
                    liveGenTimers.delete(doc.uri.fsPath);
                }
                const prevT = previewRefreshTimers.get(doc.uri.fsPath);
                if (prevT) {
                    clearTimeout(prevT);
                    previewRefreshTimers.delete(doc.uri.fsPath);
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

            schedulePreviewRefreshFromEditor(doc);
        })
    );
}

function schedulePreviewRefreshFromEditor(doc: vscode.TextDocument): void {
    if (doc.uri.scheme !== "file" || !doc.fileName.toLowerCase().endsWith(".embf")) {
        return;
    }
    const fp = doc.uri.fsPath;
    if (!EmbfPreviewPanel.getPanel(fp)) {
        return;
    }
    const prev = previewRefreshTimers.get(fp);
    if (prev) {
        clearTimeout(prev);
    }
    previewRefreshTimers.set(
        fp,
        setTimeout(() => {
            previewRefreshTimers.delete(fp);
            EmbfPreviewPanel.getPanel(fp)?.refreshFromEmbfSource();
        }, previewRefreshDebounceMs)
    );
}

function shouldAutoOpenPreview(): boolean {
    return vscode.workspace.getConfiguration("embeddedflow").get<boolean>("autoOpenPreview", true);
}

function workspaceCodegenOutputSetting(): string {
    return vscode.workspace.getConfiguration("embeddedflow").get<string>("outputDirectory") ?? "";
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
    for (const t of embfLintTimers.values()) {
        clearTimeout(t);
    }
    embfLintTimers.clear();
    for (const t of liveGenTimers.values()) {
        clearTimeout(t);
    }
    liveGenTimers.clear();
    for (const t of previewRefreshTimers.values()) {
        clearTimeout(t);
    }
    previewRefreshTimers.clear();
}

// ─────────────────────────────────────────────────────────────────────────────

function resolveFilePath(uri?: vscode.Uri): string | undefined {
    if (uri?.fsPath.toLowerCase().endsWith(".embf")) {
        return path.normalize(uri.fsPath);
    }
    const doc = vscode.window.activeTextEditor?.document;
    if (doc?.fileName.toLowerCase().endsWith(".embf")) {
        return path.normalize(doc.fileName);
    }
    return undefined;
}

/** `.embf` path for codegen: explicit URI, active editor tab, or open UI preview. */
async function resolveCodegenEmbfPath(uri?: vscode.Uri): Promise<string | undefined> {
    const fromUriOrEditor = resolveFilePath(uri);
    if (fromUriOrEditor) {
        return fromUriOrEditor;
    }
    return EmbfPreviewPanel.resolveEmbfPathForCodegen();
}

async function openPreviewResolved(extensionUri: vscode.Uri, uri?: vscode.Uri): Promise<void> {
    const filePath = await resolveEmbfForPreview(uri);
    if (!filePath) {
        return;
    }
    openPreview(filePath, extensionUri);
}

function openPreview(filePath: string, extensionUri: vscode.Uri): void {
    let panel: EmbfPreviewPanel;
    try {
        panel = EmbfPreviewPanel.createOrShow(filePath, extensionUri);
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        embeddedFlowLog("preview", "error", `failed to open preview panel: ${msg}`);
        void vscode.window.showErrorMessage(`EmbeddedFlow: could not open preview — ${msg}`);
        return;
    }

    // Parse immediately so the panel can show the current state
    let project: EmbfProject | EmbfParseError;
    try {
        project = parseEmbfSource(readEmbfText(filePath));
    } catch (e) {
        project = e instanceof EmbfParseError ? e : new EmbfParseError(String(e));
    }

    if (project instanceof EmbfParseError) {
        embeddedFlowLog("preview", "error", `${path.basename(filePath)}: ${project.message}`);
        panel.sendError(project.message);
    } else {
        embeddedFlowLog(
            "preview",
            "info",
            `loaded ${path.basename(filePath)} (${project.pages.length} page(s), LVGL ${project.project.lvglVersion})`
        );
        panel.sendProject(project);
    }

    // Set up file watcher if not already watching
    if (!watchers.has(filePath)) {
        const watcher = watchEmbf(
            filePath,
            result => {
            const p = EmbfPreviewPanel.getPanel(filePath);
            if (!p) {
                // Panel was closed — stop watching
                watcher.close();
                watchers.delete(filePath);
                return;
            }
            if (result instanceof EmbfParseError) {
                embeddedFlowLog("preview", "error", `${path.basename(filePath)}: ${result.message}`);
                p.sendError(result.message);
            } else {
                p.sendProject(result);
            }
        },
            () => readEmbfText(filePath)
        );
        watchers.set(filePath, watcher);
    }
}

function shouldLiveGenerateOnSave(): boolean {
    return vscode.workspace.getConfiguration("embeddedflow").get<boolean>("liveGenerateOnSave", false);
}

function scheduleLiveGenerateOnSave(doc: vscode.TextDocument): void {
    if (!shouldLiveGenerateOnSave()) {
        return;
    }
    if (doc.uri.scheme !== "file" || !doc.fileName.toLowerCase().endsWith(".embf")) {
        return;
    }
    const fp = doc.uri.fsPath;
    const prev = liveGenTimers.get(fp);
    if (prev) {
        clearTimeout(prev);
    }
    liveGenTimers.set(
        fp,
        setTimeout(() => {
            liveGenTimers.delete(fp);
            void runLiveCodeGen(fp);
        }, liveGenDebounceMs)
    );
}

/**
 * Regenerate C output after save. No overwrite prompt; skips on parse/semantic errors.
 */
async function runLiveCodeGen(filePath: string): Promise<void> {
    let raw: string;
    try {
        raw = fs.readFileSync(filePath, "utf-8");
    } catch {
        return;
    }
    let project: EmbfProject;
    try {
        project = parseEmbfSource(raw);
    } catch {
        return;
    }
    const semantic = lintEmbfProject(raw, project);
    if (semantic.length > 0) {
        embeddedFlowLog(
            "live",
            "warn",
            `skipped ${path.basename(filePath)}: ${semantic.length} semantic issue(s)`
        );
        vscode.window.setStatusBarMessage(
            `EmbeddedFlow: live codegen skipped (${semantic.length} semantic issue(s))`,
            5000
        );
        return;
    }

    const outDir = resolveCodegenOutputDir(project, filePath, workspaceCodegenOutputSetting());
    const result = generateCode(project, filePath, outDir);
    logCodegenImageWarnings(result, project);
    try {
        const written = writeGeneratedFiles(result);
        const rel = path.relative(path.dirname(filePath), result.outputDir);
        embeddedFlowLog(
            "live",
            "info",
            `wrote ${written.length} file(s) → ${rel}/ (${result.outputDir})`
        );
        vscode.window.setStatusBarMessage(
            `EmbeddedFlow: wrote ${written.length} file(s) → ${rel}/`,
            5000
        );
    } catch (e: any) {
        embeddedFlowLog("live", "error", e.message ?? String(e));
        vscode.window.showErrorMessage(`EmbeddedFlow (live generate): ${e.message}`);
    }
}

function logCodegenImageWarnings(result: CodeGenResult, project?: import("./types/embf").EmbfProject): void {
    for (const w of result.imageWarnings) {
        embeddedFlowLog("codegen", "warn", `image: ${w}`);
    }
    const wroteImageSources = [...result.files.keys()].some(k => /[/\\]ui_img_.*\.c$/i.test(k));
    if (!wroteImageSources && (project?.images?.length ?? 0) > 0) {
        embeddedFlowLog(
            "codegen",
            "warn",
            "project.images[] is set but no ui_img_*.c was generated (check file paths next to the .embf)"
        );
        void vscode.window.showWarningMessage(
            "EmbeddedFlow: image conversion produced no ui_img_*.c files — missing or unreadable sources. See Output → EmbeddedFlow."
        );
    }
    if (result.imageWarnings.length > 0) {
        void vscode.window.showWarningMessage(
            `EmbeddedFlow: ${result.imageWarnings.length} image(s) could not be converted. See Output → EmbeddedFlow.`
        );
    }
}

async function runCodeGen(filePath: string): Promise<void> {
    let project: EmbfProject;
    try {
        project = parseEmbf(filePath);
    } catch (e: any) {
        embeddedFlowLog("codegen", "error", e.message ?? String(e));
        vscode.window.showErrorMessage(`EmbeddedFlow: ${e.message}`);
        return;
    }

    const setup = await ensureCodegenOutputPath(
        filePath,
        project,
        workspaceCodegenOutputSetting()
    );
    if (!setup) {
        return;
    }
    project = setup.project;
    const outputDir = setup.outputDir;
    const result = generateCode(project, filePath, outputDir);
    logCodegenImageWarnings(result, project);

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
        embeddedFlowLog("codegen", "error", e.message ?? String(e));
        vscode.window.showErrorMessage(`EmbeddedFlow: Failed to write files: ${e.message}`);
        return;
    }

    embeddedFlowLog("codegen", "info", `wrote ${written.length} file(s) → ${outputDir}`);

    // Show success notification with a button to open the output folder
    const rel = path.relative(path.dirname(filePath), outputDir);
    const action = await vscode.window.showInformationMessage(
        `Generated ${written.length} files → ${rel}/`,
        "Open Folder",
        "Reveal in Explorer",
        "Show ui.c",
        "Show ui_display.h"
    );

    if (action === "Open Folder") {
        await vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(outputDir));
    } else if (action === "Reveal in Explorer") {
        const revealUri = vscode.Uri.file(path.join(outputDir, "ui.c"));
        await vscode.commands.executeCommand("revealInExplorer", revealUri);
    } else if (action === "Show ui.c") {
        const uiC = path.join(outputDir, "ui.c");
        const doc = await vscode.workspace.openTextDocument(uiC);
        await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
    } else if (action === "Show ui_display.h") {
        const uiDisp = path.join(outputDir, "ui_display.h");
        const doc = await vscode.workspace.openTextDocument(uiDisp);
        await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
    }
}

