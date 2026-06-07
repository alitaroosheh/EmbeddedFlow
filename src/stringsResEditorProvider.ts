import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { parseEmbfSource } from "./embfParser";
import type { EmbfProject } from "./types/embf";
import { resolveStringsResPath } from "./i18n/stringsResPath";
import { parseStringsResSource } from "./i18n/stringsResParser";
import type { StringsResFile } from "./i18n/stringsResParser";
import { defaultStringsResFile, serializeStringsRes, writeStringsResFileAtomic } from "./i18n/stringsResWrite";

export class StringsResEditorProvider implements vscode.CustomTextEditorProvider {
    public static readonly viewType = "embeddedflow.stringsRes";

    constructor(private readonly context: vscode.ExtensionContext) {}

    public static register(context: vscode.ExtensionContext): vscode.Disposable {
        const provider = new StringsResEditorProvider(context);
        return vscode.window.registerCustomEditorProvider(
            StringsResEditorProvider.viewType,
            provider,
            {
                webviewOptions: { retainContextWhenHidden: true },
                supportsMultipleEditorsPerDocument: true
            }
        );
    }

    async resolveCustomTextEditor(
        document: vscode.TextDocument,
        webviewPanel: vscode.WebviewPanel,
        _token: vscode.CancellationToken
    ): Promise<void> {
        webviewPanel.webview.options = {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, "media")]
        };

        const scriptUri = webviewPanel.webview.asWebviewUri(
            vscode.Uri.joinPath(this.context.extensionUri, "media", "stringsResEditor.js")
        );
        const styleUri = webviewPanel.webview.asWebviewUri(
            vscode.Uri.joinPath(this.context.extensionUri, "media", "stringsResEditor.css")
        );

        webviewPanel.webview.html = this.getHtml(webviewPanel.webview, scriptUri, styleUri);

        const postUpdate = (): void => {
            try {
                const data = parseStringsResSource(document.getText(), document.fileName);
                void webviewPanel.webview.postMessage({ type: "update", data });
            } catch (e) {
                const message = e instanceof Error ? e.message : String(e);
                void webviewPanel.webview.postMessage({ type: "error", message });
            }
        };

        postUpdate();

        const changeSub = vscode.workspace.onDidChangeTextDocument(e => {
            if (e.document.uri.toString() === document.uri.toString()) {
                postUpdate();
            }
        });

        const messageSub = webviewPanel.webview.onDidReceiveMessage(async (msg: { type?: string; data?: StringsResFile }) => {
            if (msg.type === "ready") {
                postUpdate();
                return;
            }
            if (msg.type === "save" && msg.data) {
                await this.applySave(document, msg.data);
                postUpdate();
            }
        });

        webviewPanel.onDidDispose(() => {
            changeSub.dispose();
            messageSub.dispose();
        });
    }

    private getHtml(webview: vscode.Webview, scriptUri: vscode.Uri, styleUri: vscode.Uri): string {
        const csp = [
            "default-src 'none'",
            `style-src ${webview.cspSource} 'unsafe-inline'`,
            `script-src ${webview.cspSource}`
        ].join("; ");
        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<link rel="stylesheet" href="${styleUri}" />
<title>String resources</title>
</head>
<body>
<div id="toolbar">
  <button type="button" id="btn-add-key">+ Key</button>
  <button type="button" id="btn-add-locale">+ Locale</button>
  <button type="button" id="btn-remove-key" disabled>− Key</button>
  <button type="button" id="btn-remove-locale" disabled>− Locale</button>
  <label id="default-locale-wrap">Default locale
    <select id="default-locale"></select>
  </label>
  <button type="button" id="btn-save" class="primary">Save</button>
  <span id="status"></span>
</div>
<div id="error" hidden></div>
<div id="table-wrap"><table id="grid"><thead></thead><tbody></tbody></table></div>
<script src="${scriptUri}"></script>
</body>
</html>`;
    }

    private async applySave(document: vscode.TextDocument, data: StringsResFile): Promise<void> {
        parseStringsResSource(serializeStringsRes(data), document.fileName);
        const text = serializeStringsRes(data);
        const fullRange = new vscode.Range(0, 0, document.lineCount, 0);
        const edit = new vscode.WorkspaceEdit();
        edit.replace(document.uri, fullRange, text);
        const ok = await vscode.workspace.applyEdit(edit);
        if (!ok) {
            throw new Error("Failed to apply edit");
        }
        writeStringsResFileAtomic(document.uri.fsPath, data);
        await document.save();
    }
}

/** Open the linked `.res` for an `.embf` path, creating a default file when missing. */
export async function openStringsResForEmbf(embfPath: string, project: EmbfProject): Promise<void> {
    const abs = resolveStringsResPath(project, embfPath);
    if (!fs.existsSync(abs)) {
        writeStringsResFileAtomic(abs, defaultStringsResFile());
    }
    await vscode.commands.executeCommand(
        "vscode.openWith",
        vscode.Uri.file(abs),
        StringsResEditorProvider.viewType
    );
}

/** `.embf` paths whose linked strings file matches `resAbsPath`. */
export function embfPathsLinkedToStringsRes(resAbsPath: string): string[] {
    const normalized = path.normalize(resAbsPath);
    const out: string[] = [];
    for (const doc of vscode.workspace.textDocuments) {
        if (!doc.fileName.toLowerCase().endsWith(".embf")) {
            continue;
        }
        try {
            const project = parseEmbfSource(doc.getText());
            const linked = resolveStringsResPath(project, doc.uri.fsPath);
            if (path.normalize(linked) === normalized) {
                out.push(doc.uri.fsPath);
            }
        } catch {
            /* ignore parse errors */
        }
    }
    return out;
}
