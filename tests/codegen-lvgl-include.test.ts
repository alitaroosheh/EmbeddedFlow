import { describe, it, expect } from "vitest";
import { generatePageHeader, generateRootHeader } from "../src/codeGen/pageGen";
import { lvglIncludeDirective } from "../src/codeGen/lvglInclude";
import { minimalProject } from "./fixtures";

describe("codegen LVGL include path", () => {
    it("defaults to lvgl/lvgl.h", () => {
        const p = minimalProject();
        delete p.project.lvglInclude;
        expect(lvglIncludeDirective(p)).toBe('#include "lvgl/lvgl.h"');
    });

    it("emits lvgl.h when project.lvglInclude is lvgl.h", () => {
        const p = minimalProject();
        p.project.lvglInclude = "lvgl.h";
        const page = p.pages[0];
        expect(generatePageHeader(p, page)).toContain('#include "lvgl.h"');
        expect(generatePageHeader(p, page)).not.toContain('#include "lvgl/lvgl.h"');
        expect(generateRootHeader(p)).toContain('#include "lvgl.h"');
    });

    it("emits lvgl/lvgl.h when project.lvglInclude is lvgl/lvgl.h", () => {
        const p = minimalProject();
        p.project.lvglInclude = "lvgl/lvgl.h";
        expect(generateRootHeader(p)).toContain('#include "lvgl/lvgl.h"');
    });
});
