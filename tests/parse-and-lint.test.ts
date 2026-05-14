import { describe, it, expect } from "vitest";
import { EmbfParseError, parseEmbfSource } from "../src/embfParser";
import { lintEmbfProject } from "../src/embfSemanticLint";
import { minimalProject } from "./fixtures";

describe("parseEmbfSource", () => {
    it("accepts a minimal valid project JSON", () => {
        const json = JSON.stringify(minimalProject());
        expect(() => parseEmbfSource(json)).not.toThrow();
        const p = parseEmbfSource(json);
        expect(p.project.name).toBe("Test");
    });

    it("rejects navigate action without target", () => {
        const bad: unknown = JSON.parse(JSON.stringify(minimalProject()));
        const root = bad as {
            pages: Array<{
                components: Array<Record<string, unknown>>;
            }>;
        };
        root.pages[0].components[0] = {
            id: "btn",
            type: "button",
            x: 0,
            y: 0,
            width: 80,
            height: 32,
            events: [{ trigger: "clicked", actions: [{ type: "navigate" }] }]
        };
        expect(() => parseEmbfSource(JSON.stringify(bad))).toThrow(EmbfParseError);
        expect(() => parseEmbfSource(JSON.stringify(bad))).toThrow(/target/);
    });
});

describe("lintEmbfProject", () => {
    it("reports duplicate component ids on one page", () => {
        const p = minimalProject({
            pages: [
                {
                    id: "page_main",
                    name: "Main",
                    components: [
                        {
                            id: "dup",
                            type: "label",
                            x: 0,
                            y: 0,
                            width: 10,
                            height: 10,
                            text: "1"
                        },
                        {
                            id: "dup",
                            type: "label",
                            x: 10,
                            y: 0,
                            width: 10,
                            height: 10,
                            text: "2"
                        }
                    ]
                }
            ]
        });
        const text = JSON.stringify(p);
        const issues = lintEmbfProject(text, p);
        expect(issues.some(i => i.message.includes("Duplicate component id"))).toBe(true);
    });
});
