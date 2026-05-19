import { describe, it, expect } from "vitest";
import { generatePageSource, generateRootHeader } from "../src/codeGen/pageGen";
import { minimalProject } from "./fixtures";

describe("codegen cross-page symbols", () => {
    it("ui.h includes every page header", () => {
        const p = minimalProject();
        p.pages.push({ id: "page_settings", name: "Settings", components: [] });
        const h = generateRootHeader(p);
        expect(h).toContain('#include "ui_page_main.h"');
        expect(h).toContain('#include "ui_page_settings.h"');
    });

    it("page .c includes ui.h for cross-page navigate in event handlers", () => {
        const p = minimalProject();
        p.pages.push({ id: "page_settings", name: "Settings", components: [] });
        p.pages[0].components.push({
            id: "btn_go",
            type: "button",
            x: 0,
            y: 0,
            width: 80,
            height: 32,
            label: "Settings",
            events: [
                {
                    trigger: "clicked",
                    actions: [{ type: "navigate", target: "page_settings" }]
                }
            ]
        });
        const src = generatePageSource(p, p.pages[0]);
        expect(src).toContain('#include "ui.h"');
        expect(src).toMatch(/lv_(?:scr|screen)_load\(ui_page_settings\)/);
        expect(src).not.toMatch(/#include "ui_page_main\.h"/);
    });
});
