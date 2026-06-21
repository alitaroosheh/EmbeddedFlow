import { ChildProcessWithoutNullStreams } from "child_process";
import { embeddedFlowLog } from "../outputLog";

interface PendingRequest {
    resolve: (value: unknown) => void;
    reject: (err: Error) => void;
    method: string;
}

/** Minimal LSP client over stdio (JSON-RPC 2.0 with Content-Length framing). */
export class LspClient {
    private nextId = 1;
    private readonly pending = new Map<number, PendingRequest>();
    private buffer = Buffer.alloc(0);
    private disposed = false;

    constructor(private readonly proc: ChildProcessWithoutNullStreams) {
        proc.stdout.on("data", chunk => this.onStdout(chunk as Buffer));
        proc.stderr.on("data", chunk => {
            const text = (chunk as Buffer).toString("utf8").trim();
            if (text) {
                embeddedFlowLog("clangd", "info", text);
            }
        });
        proc.on("exit", (code, signal) => {
            const err = new Error(`clangd exited (code=${code ?? "null"}, signal=${signal ?? "null"})`);
            for (const [, p] of this.pending) {
                p.reject(err);
            }
            this.pending.clear();
        });
    }

    notify(method: string, params: unknown): void {
        this.write({ jsonrpc: "2.0", method, params });
    }

    async request<T>(method: string, params: unknown, timeoutMs = 120_000): Promise<T> {
        if (this.disposed) {
            throw new Error("LSP client disposed");
        }
        const id = this.nextId++;
        const payload = { jsonrpc: "2.0", id, method, params };
        return new Promise<T>((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`LSP request timed out: ${method}`));
            }, timeoutMs);
            this.pending.set(id, {
                method,
                resolve: v => {
                    clearTimeout(timer);
                    resolve(v as T);
                },
                reject: e => {
                    clearTimeout(timer);
                    reject(e);
                }
            });
            this.write(payload);
        });
    }

    dispose(): void {
        if (this.disposed) {
            return;
        }
        this.disposed = true;
        for (const [, p] of this.pending) {
            p.reject(new Error("LSP client disposed"));
        }
        this.pending.clear();
        try {
            this.proc.stdin.end();
        } catch {
            /* ignore */
        }
        try {
            this.proc.kill();
        } catch {
            /* ignore */
        }
    }

    private write(msg: unknown): void {
        const body = JSON.stringify(msg);
        const header = `Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n`;
        this.proc.stdin.write(header + body, "utf8");
    }

    private onStdout(chunk: Buffer): void {
        this.buffer = Buffer.concat([this.buffer, chunk]);
        while (true) {
            const headerEnd = this.buffer.indexOf("\r\n\r\n");
            if (headerEnd < 0) {
                return;
            }
            const headerText = this.buffer.subarray(0, headerEnd).toString("utf8");
            const match = /Content-Length:\s*(\d+)/i.exec(headerText);
            if (!match) {
                this.buffer = this.buffer.subarray(headerEnd + 4);
                continue;
            }
            const length = Number(match[1]);
            const bodyStart = headerEnd + 4;
            if (this.buffer.length < bodyStart + length) {
                return;
            }
            const body = this.buffer.subarray(bodyStart, bodyStart + length).toString("utf8");
            this.buffer = this.buffer.subarray(bodyStart + length);
            try {
                this.dispatch(JSON.parse(body) as Record<string, unknown>);
            } catch (e) {
                embeddedFlowLog("clangd", "warn", `Invalid LSP JSON: ${String(e)}`);
            }
        }
    }

    private dispatch(msg: Record<string, unknown>): void {
        if (msg.method !== undefined) {
            return;
        }
        const id = msg.id as number | undefined;
        if (id === undefined) {
            return;
        }
        const pending = this.pending.get(id);
        if (!pending) {
            return;
        }
        this.pending.delete(id);
        if (msg.error) {
            const errObj = msg.error as { message?: string };
            pending.reject(new Error(errObj.message ?? "LSP error"));
            return;
        }
        pending.resolve(msg.result);
    }
}
