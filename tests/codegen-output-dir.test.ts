import * as path from "path";
import { describe, expect, it } from "vitest";
import { resolveCodegenOutputDir } from "../src/codeGen/outputDir";
import { minimalProject } from "./fixtures";

describe("resolveCodegenOutputDir", () => {
    const embfPath = path.join("D:", "proj", "ui", "demo.embf");

    it("uses project.outputPath when set (relative)", () => {
        const p = minimalProject();
        p.project.outputPath = "generated/ui";
        expect(resolveCodegenOutputDir(p, embfPath, "")).toBe(
            path.normalize(path.join("D:", "proj", "ui", "generated", "ui"))
        );
    });

    it("uses project.outputPath when set (absolute)", () => {
        const p = minimalProject();
        p.project.outputPath = "C:\\build\\ui_out";
        expect(resolveCodegenOutputDir(p, embfPath, "")).toBe(path.normalize("C:\\build\\ui_out"));
    });

    it("falls back to workspace setting when outputPath omitted", () => {
        const p = minimalProject();
        expect(resolveCodegenOutputDir(p, embfPath, "out")).toBe(
            path.normalize(path.join("D:", "proj", "ui", "out"))
        );
    });

    it("defaults to ui_output next to .embf", () => {
        const p = minimalProject();
        expect(resolveCodegenOutputDir(p, embfPath, "")).toBe(
            path.normalize(path.join("D:", "proj", "ui", "ui_output"))
        );
    });

    it("project.outputPath overrides workspace setting", () => {
        const p = minimalProject();
        p.project.outputPath = "from_json";
        expect(resolveCodegenOutputDir(p, embfPath, "from_settings")).toBe(
            path.normalize(path.join("D:", "proj", "ui", "from_json"))
        );
    });
});
