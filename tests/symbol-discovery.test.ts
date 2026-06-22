import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { describe, expect, it } from "vitest";
import { listIndexSourceFiles, countIndexableSourceFiles } from "../src/symbolDiscovery/compileCommandsIndex";
import {
    findFirmwareRootFromWorkspace,
    formatFirmwarePathForStorage,
    linkFirmwareProject,
    resolveCompileCommands,
    resolveFirmwareRootFromProject
} from "../src/symbolDiscovery/firmwarePath";
import {
    documentSymbolsToNodes,
    searchSymbolGraph,
    countSymbolGraphMatches
} from "../src/symbolDiscovery/symbolGraph";
import { toWebviewSymbolNode, toWebviewSymbolNodes } from "../src/symbolDiscovery/symbolWebview";
import type { SymbolGraph } from "../src/symbolDiscovery/types";
import { minimalProject } from "./fixtures";

describe("firmwarePath", () => {
    const embfPath = path.join("D:", "studio", "EmbeddedFlow", "sample", "demo.embf");

    it("formatFirmwarePathForStorage stores relative paths under .embf dir", () => {
        const embfDir = path.join("D:", "studio", "EmbeddedFlow", "sample");
        const embf = path.join(embfDir, "demo.embf");
        const fw = path.join(embfDir, "linked-fw");
        expect(formatFirmwarePathForStorage(embf, fw)).toBe("linked-fw");
    });

    it("formatFirmwarePathForStorage stores absolute paths outside .embf dir", () => {
        const embf = path.join("D:", "studio", "EmbeddedFlow", "sample", "demo.embf");
        const fw = path.join("D:", "studio", "firmware", "esp-idf-app");
        expect(formatFirmwarePathForStorage(embf, fw)).toBe(path.normalize(fw));
    });

    it("resolveFirmwareRootFromProject resolves relative firmwarePath", () => {
        const p = minimalProject();
        p.project.firmwarePath = "../firmware/tree";
        expect(resolveFirmwareRootFromProject(p, embfPath)).toBe(
            path.normalize(path.join(path.dirname(embfPath), "../firmware/tree"))
        );
    });

    it("resolveCompileCommands prefers build/compile_commands.json", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "embf-fw-"));
        const buildDir = path.join(dir, "build");
        fs.mkdirSync(buildDir);
        const cc = path.join(buildDir, "compile_commands.json");
        fs.writeFileSync(cc, "[]");
        const link = resolveCompileCommands(dir);
        expect(link.ok).toBe(true);
        if (link.ok) {
            expect(link.compileCommandsPath).toBe(cc);
            expect(link.compileCommandsDir).toBe(buildDir);
        }
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it("linkFirmwareProject errors when firmware path unset and workspace empty", () => {
        const p = minimalProject();
        const link = linkFirmwareProject(p, embfPath, []);
        expect(link.ok).toBe(false);
        if (!link.ok) {
            expect(link.code).toBe("missing_firmware");
        }
    });

    it("findFirmwareRootFromWorkspace discovers compile_commands at workspace root", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "embf-ws-"));
        fs.mkdirSync(path.join(dir, "build"), { recursive: true });
        fs.writeFileSync(path.join(dir, "build", "compile_commands.json"), "[]");
        expect(findFirmwareRootFromWorkspace([dir])).toBe(path.normalize(dir));
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it("findFirmwareRootFromWorkspace discovers nested project via extra dir", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "embf-ws-"));
        const fw = path.join(dir, "my-fw");
        fs.mkdirSync(path.join(fw, "build"), { recursive: true });
        fs.writeFileSync(path.join(fw, "build", "compile_commands.json"), "[]");
        expect(findFirmwareRootFromWorkspace([], [fw])).toBe(path.normalize(fw));
        fs.rmSync(dir, { recursive: true, force: true });
    });
});

describe("compileCommandsIndex", () => {
    it("listIndexSourceFiles prefers main/ sources", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "embf-cc-"));
        const mainDir = path.join(dir, "main");
        fs.mkdirSync(mainDir);
        const mainC = path.join(mainDir, "app.c");
        const otherC = path.join(dir, "other.c");
        fs.writeFileSync(mainC, "int x;\n");
        fs.writeFileSync(otherC, "int y;\n");
        const ccPath = path.join(dir, "build", "compile_commands.json");
        fs.mkdirSync(path.dirname(ccPath), { recursive: true });
        fs.writeFileSync(
            ccPath,
            JSON.stringify([
                { file: otherC },
                { file: mainC }
            ])
        );
        const files = listIndexSourceFiles(ccPath, dir);
        expect(files[0]).toBe(path.normalize(mainC));
        expect(files).toContain(path.normalize(otherC));
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it("listIndexSourceFiles matches when firmware root drive letter casing differs", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "embf-cc-case-"));
        const mainDir = path.join(dir, "main");
        fs.mkdirSync(mainDir);
        const mainC = path.join(mainDir, "app.c");
        fs.writeFileSync(mainC, "int x;\n");
        const ccPath = path.join(dir, "build", "compile_commands.json");
        fs.mkdirSync(path.dirname(ccPath), { recursive: true });
        // Simulate compile_commands using uppercase drive vs lowercase firmwarePath in .embf
        const fileInCc = mainC.replace(/^([a-z]):/i, (_m, d) => `${String(d).toUpperCase()}:`);
        const rootInEmbf = dir.replace(/^([A-Z]):/, (_m, d) => `${String(d).toLowerCase()}:`);
        fs.writeFileSync(ccPath, JSON.stringify([{ file: fileInCc }]));
        const files = listIndexSourceFiles(ccPath, rootInEmbf);
        expect(files.length).toBeGreaterThan(0);
        expect(files[0].toLowerCase()).toBe(path.normalize(mainC).toLowerCase());
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it("listIndexSourceFiles with maxFiles 0 returns all collected files", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "embf-cc-all-"));
        const mainDir = path.join(dir, "main");
        fs.mkdirSync(mainDir);
        for (let i = 0; i < 5; i++) {
            fs.writeFileSync(path.join(mainDir, `f${i}.c`), "int x;\n");
        }
        const ccPath = path.join(dir, "build", "compile_commands.json");
        fs.mkdirSync(path.dirname(ccPath), { recursive: true });
        fs.writeFileSync(
            ccPath,
            JSON.stringify(
                Array.from({ length: 5 }, (_, i) => ({ file: path.join(mainDir, `f${i}.c`) }))
            )
        );
        expect(listIndexSourceFiles(ccPath, dir, { maxFiles: 0 })).toHaveLength(5);
        expect(countIndexableSourceFiles(ccPath, dir).total).toBe(5);
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it("listIndexSourceFiles mainOnly skips components outside main/", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "embf-cc-main-"));
        const mainDir = path.join(dir, "main");
        const compDir = path.join(dir, "components", "foo");
        fs.mkdirSync(mainDir, { recursive: true });
        fs.mkdirSync(compDir, { recursive: true });
        const mainC = path.join(mainDir, "app.c");
        const compC = path.join(compDir, "foo.c");
        fs.writeFileSync(mainC, "int x;\n");
        fs.writeFileSync(compC, "int y;\n");
        const ccPath = path.join(dir, "build", "compile_commands.json");
        fs.mkdirSync(path.dirname(ccPath), { recursive: true });
        fs.writeFileSync(ccPath, JSON.stringify([{ file: compC }, { file: mainC }]));
        expect(listIndexSourceFiles(ccPath, dir, { mainOnly: true, maxFiles: 0 })).toEqual([
            path.normalize(mainC)
        ]);
        fs.rmSync(dir, { recursive: true, force: true });
    });
});

describe("symbolGraph", () => {
    it("documentSymbolsToNodes maps struct fields as children", () => {
        const file = path.join("D:", "fw", "main.c");
        const nodes = documentSymbolsToNodes(
            [
                {
                    name: "app_data",
                    kind: 23,
                    range: { start: { line: 0, character: 0 }, end: { line: 2, character: 1 } },
                    children: [
                        {
                            name: "temp_c",
                            kind: 8,
                            detail: "float",
                            range: { start: { line: 1, character: 4 }, end: { line: 1, character: 10 } }
                        }
                    ]
                }
            ],
            file
        );
        expect(nodes[0].kind).toBe("struct");
        expect(nodes[0].children?.[0].name).toBe("app_data.temp_c");
        expect(nodes[0].children?.[0].kind).toBe("field");
    });

    it("searchSymbolGraph filters by query", () => {
        const graph: SymbolGraph = {
            firmwareRoot: "/fw",
            compileCommandsPath: "/fw/build/compile_commands.json",
            indexedAt: 0,
            sourceFileCount: 1,
            symbols: [
                { name: "g_temp", kind: "variable" },
                { name: "ui_init", kind: "function", signature: "void ui_init(void)" }
            ]
        };
        const hits = searchSymbolGraph(graph, "ui_");
        expect(hits).toHaveLength(1);
        expect(hits[0].name).toBe("ui_init");
    });

    it("countSymbolGraphMatches counts without limit", () => {
        const graph: SymbolGraph = {
            firmwareRoot: "/fw",
            compileCommandsPath: "/fw/build/compile_commands.json",
            indexedAt: 0,
            sourceFileCount: 1,
            symbols: [
                { name: "a", kind: "variable" },
                { name: "b", kind: "function" },
                { name: "c", kind: "variable" }
            ]
        };
        expect(countSymbolGraphMatches(graph, "")).toBe(3);
        expect(countSymbolGraphMatches(graph, "", ["variable"])).toBe(2);
    });
});

describe("symbolWebview", () => {
    it("toWebviewSymbolNode omits children unless requested", () => {
        const node = {
            name: "app_data",
            kind: "struct" as const,
            children: [{ name: "app_data.temp_c", kind: "field" as const, typeHint: "float" }]
        };
        const flat = toWebviewSymbolNode(node, false);
        expect(flat.children).toBeUndefined();
        const tree = toWebviewSymbolNodes([node], true);
        expect(tree[0].children?.[0].name).toBe("app_data.temp_c");
    });
});
