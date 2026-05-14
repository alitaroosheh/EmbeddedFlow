import * as vscode from "vscode";

let channel: vscode.OutputChannel | undefined;

export function registerEmbeddedFlowOutput(out: vscode.OutputChannel): void {
    channel = out;
}

/**
 * Append to the EmbeddedFlow output channel (if registered) and mirror to the console.
 */
export function embeddedFlowLog(source: string, level: "info" | "warn" | "error", message: string): void {
    const line = `[${source}] [${level}] ${message}`;
    channel?.appendLine(line);
    if (level === "error") {
        console.error(line);
    } else if (level === "warn") {
        console.warn(line);
    } else {
        console.log(line);
    }
}
