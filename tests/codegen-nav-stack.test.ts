import { describe, expect, it } from "vitest";
import { generateCode } from "../src/codeGen/index";
import { minimalProject } from "./fixtures";
import * as os from "os";
import * as path from "path";

describe("codegen nav stack (N5)", () => {
    it("generates ui_nav when nav_push is used", () => {
        const p = minimalProject();
        p.pages.push({
            id: "detail",
            name: "Detail",
            components: []
        });
        p.pages[0].components.push({
            id: "btn_go",
            type: "button",
            x: 0,
            y: 0,
            width: 80,
            height: 36,
            label: "Go",
            events: [
                {
                    trigger: "clicked",
                    actions: [{ type: "nav_push", route: "detail" }]
                }
            ]
        });
        p.pages[1].components.push({
            id: "btn_back",
            type: "button",
            x: 0,
            y: 0,
            width: 80,
            height: 36,
            label: "Back",
            events: [
                {
                    trigger: "clicked",
                    actions: [{ type: "nav_pop" }]
                }
            ]
        });

        const embfPath = path.join(os.tmpdir(), "nav-stack-test.embf");
        const outDir = path.join(os.tmpdir(), "nav-stack-out");
        const result = generateCode(p, embfPath, outDir);

        expect(result.files.has(path.join(outDir, "ui_nav.h"))).toBe(true);
        expect(result.files.has(path.join(outDir, "ui_nav.c"))).toBe(true);

        const pageC = result.files.get(path.join(outDir, "ui_page_main.c")) ?? "";
        expect(pageC).toContain('ui_nav_push("detail"');
        const detailC = result.files.get(path.join(outDir, "ui_detail.c")) ?? "";
        expect(detailC).toContain("ui_nav_pop(");

        const navC = result.files.get(path.join(outDir, "ui_nav.c")) ?? "";
        expect(navC).toContain("ui_nav_stack_depth");
        expect(navC).toContain("ui_nav_push");
    });
});
