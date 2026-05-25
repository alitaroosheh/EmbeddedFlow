import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { execFile, spawnSync } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);
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
        }),
        vscode.commands.registerCommand("embeddedflow.addFont", async (uri?: vscode.Uri) => {
            const filePath = await resolveCodegenEmbfPath(uri);
            if (!filePath) {
                vscode.window.showErrorMessage(
                    "EmbeddedFlow: Open a .embf file or UI preview, then run Add Font to Project."
                );
                return;
            }
            await runAddFontCommand(filePath);
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

/**
 * Interactive flow to register a new font in `project.fonts[]` without manual JSON editing.
 * Asks for id, C symbol, size and an optional source path (relative to the .embf when inside
 * the workspace). Validates the entry against the parser before persisting.
 */
async function runAddFontCommand(filePath: string): Promise<void> {
    let project: EmbfProject;
    let rawText: string;
    try {
        rawText = fs.readFileSync(filePath, "utf-8");
        project = parseEmbfSource(rawText);
    } catch (e: any) {
        vscode.window.showErrorMessage(`EmbeddedFlow: cannot read project — ${e.message ?? e}`);
        return;
    }

    const existingIds = new Set((project.fonts ?? []).map(f => f.id));
    const id = await vscode.window.showInputBox({
        title: "Add Font — id",
        prompt: "Unique font id used by widget styles.fontFamily (e.g. \"title\", \"body_small\")",
        validateInput: v => {
            if (!v?.trim()) return "id is required";
            if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(v.trim())) return "id must be a C identifier";
            if (existingIds.has(v.trim())) return `id "${v.trim()}" already exists`;
            return null;
        }
    });
    if (!id) return;

    const name = await vscode.window.showInputBox({
        title: "Add Font — C symbol",
        prompt: "C symbol of the lv_font_t (e.g. \"lv_font_montserrat_24\" for built-in, or \"my_font_24\" for a custom .c)",
        value: `lv_font_montserrat_14`,
        validateInput: v => {
            if (!v?.trim()) return "name is required";
            if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(v.trim())) return "name must be a C identifier";
            return null;
        }
    });
    if (!name) return;

    const sizeStr = await vscode.window.showInputBox({
        title: "Add Font — size",
        prompt: "Glyph size in pixels (positive integer)",
        value: "14",
        validateInput: v => {
            const n = Number(v);
            if (!Number.isFinite(n) || n < 1 || Math.floor(n) !== n) return "size must be a positive integer";
            return null;
        }
    });
    if (!sizeStr) return;
    const size = Math.round(Number(sizeStr));

    let source: string | undefined;
    if (!name.trim().startsWith("lv_font_montserrat_")) {
        const fontConvAvailable = await isLvFontConvAvailable();
        const sourceOptions: { label: string; value: "pick" | "convert" | "skip"; description?: string }[] = [
            { label: "Pick existing .c file…", value: "pick" }
        ];
        if (fontConvAvailable) {
            sourceOptions.push({
                label: "Convert TTF/OTF with lv_font_conv…",
                value: "convert",
                description: "Found on PATH"
            });
        } else {
            sourceOptions.push({
                label: "Convert TTF/OTF with lv_font_conv (not installed)",
                value: "convert",
                description: "Install: npm i -g lv_font_conv"
            });
        }
        sourceOptions.push({ label: "Skip (built-in or externally declared)", value: "skip" });

        const pickSource = await vscode.window.showQuickPick(sourceOptions, {
            title: "Add Font — source .c",
            placeHolder: "Choose how to attach the .c source"
        });
        if (!pickSource) return;

        if (pickSource.value === "pick") {
            const picked = await vscode.window.showOpenDialog({
                canSelectFiles: true,
                canSelectFolders: false,
                canSelectMany: false,
                openLabel: "Use Font .c File",
                filters: { "Font C": ["c"], "All": ["*"] }
            });
            if (!picked?.length) return;
            source = relativeToProject(filePath, picked[0].fsPath);
        } else if (pickSource.value === "convert") {
            if (!fontConvAvailable) {
                vscode.window.showErrorMessage(
                    "EmbeddedFlow: lv_font_conv not found on PATH. Install with `npm install -g lv_font_conv`."
                );
                return;
            }
            const converted = await runLvFontConv(filePath, name.trim(), size);
            if (!converted) return;
            source = relativeToProject(filePath, converted);
        }
    }

    const newFont = { id: id.trim(), name: name.trim(), size, ...(source ? { source } : {}) };
    const nextProject = { ...project, fonts: [...(project.fonts ?? []), newFont] };

    try {
        parseEmbfSource(JSON.stringify(nextProject));
    } catch (e: any) {
        vscode.window.showErrorMessage(`EmbeddedFlow: font entry rejected — ${e.message ?? e}`);
        return;
    }

    try {
        const indent = detectJsonIndent(rawText);
        fs.writeFileSync(filePath, JSON.stringify(nextProject, null, indent), "utf-8");
    } catch (e: any) {
        vscode.window.showErrorMessage(`EmbeddedFlow: failed to save — ${e.message ?? e}`);
        return;
    }
    embeddedFlowLog("addFont", "info", `added font "${newFont.id}" → ${newFont.name} (size ${size})${source ? ` source=${source}` : ""}`);
    vscode.window.showInformationMessage(
        `EmbeddedFlow: font "${newFont.id}" added. Reference it as styles.fontFamily: "${newFont.id}".`
    );
}

/** Detect indent (2 vs 4 spaces vs tab) from existing JSON; defaults to 2. */
function detectJsonIndent(text: string): number | string {
    const m = text.match(/\n([\t ]+)"/);
    if (!m) return 2;
    const ws = m[1];
    if (ws.startsWith("\t")) return "\t";
    return ws.length;
}

/** Express `abs` relative to the directory holding the `.embf` (POSIX separators); falls back to absolute. */
function relativeToProject(embfPath: string, abs: string): string {
    const projDir = path.dirname(embfPath);
    const rel = path.relative(projDir, abs);
    return rel.startsWith("..") ? abs : rel.split(path.sep).join("/");
}

/** `true` when `lv_font_conv` (or the `npx`-shimmed variant) responds to `--version`. */
async function isLvFontConvAvailable(): Promise<boolean> {
    try {
        await execFileAsync("lv_font_conv", ["--version"], { timeout: 4000, windowsHide: true });
        return true;
    } catch {
        // Some Windows installs land as `lv_font_conv.cmd`; spawnSync resolves PATHEXT.
        const r = spawnSync("lv_font_conv", ["--version"], { shell: true, timeout: 4000, windowsHide: true });
        return r.status === 0;
    }
}

/**
 * Pick a TTF/OTF and a glyph range, invoke `lv_font_conv` to emit a .c, save next to the .embf
 * in `fonts/<symbol>.c`. Returns the absolute output path on success, undefined on cancel/failure.
 */
async function runLvFontConv(embfPath: string, symbol: string, size: number): Promise<string | undefined> {
    const picked = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: false,
        openLabel: "Convert Font File",
        filters: { "Font": ["ttf", "otf", "woff"], "All": ["*"] }
    });
    if (!picked?.length) return undefined;

    const range = await vscode.window.showInputBox({
        title: "lv_font_conv — Unicode range",
        prompt: "Glyph range(s) to include (lv_font_conv --range syntax)",
        value: "0x20-0x7F",
        validateInput: v => (!v?.trim() ? "range is required" : null)
    });
    if (!range) return undefined;

    const bpp = await vscode.window.showQuickPick(
        [
            { label: "4 bpp (recommended)", value: "4" as const },
            { label: "2 bpp (smaller, jaggies)", value: "2" as const },
            { label: "8 bpp (best, larger)",  value: "8" as const },
            { label: "1 bpp (bitmap)",        value: "1" as const }
        ],
        { title: "lv_font_conv — bits per pixel", placeHolder: "Subpixel depth" }
    );
    if (!bpp) return undefined;

    const projDir = path.dirname(embfPath);
    const outDir = path.join(projDir, "fonts");
    try {
        fs.mkdirSync(outDir, { recursive: true });
    } catch (e: any) {
        vscode.window.showErrorMessage(`EmbeddedFlow: cannot create fonts/ — ${e.message ?? e}`);
        return undefined;
    }
    const outPath = path.join(outDir, `${symbol}.c`);

    const args = [
        "--font", picked[0].fsPath,
        "--size", String(size),
        "--bpp", bpp.value,
        "--range", range.trim(),
        "--format", "lvgl",
        "--no-compress",
        "-o", outPath
    ];

    try {
        await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: `Running lv_font_conv → ${symbol}.c`, cancellable: false },
            async () => {
                await execFileAsync("lv_font_conv", args, { timeout: 90000, windowsHide: true, shell: process.platform === "win32" });
            }
        );
    } catch (e: any) {
        const stderr = (e as { stderr?: string }).stderr ?? "";
        vscode.window.showErrorMessage(
            `EmbeddedFlow: lv_font_conv failed — ${e.message ?? e}${stderr ? `\n${stderr.slice(0, 400)}` : ""}`
        );
        return undefined;
    }
    if (!fs.existsSync(outPath)) {
        vscode.window.showErrorMessage(`EmbeddedFlow: lv_font_conv reported success but ${outPath} is missing.`);
        return undefined;
    }
    embeddedFlowLog("addFont", "info", `lv_font_conv emitted ${outPath}`);
    return outPath;
}

