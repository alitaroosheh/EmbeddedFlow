import { describe, it, expect } from "vitest";
import { generateDisplayHeader } from "../src/codeGen/pageGen";
import { minimalProject } from "./fixtures";

describe("generateDisplayHeader", () => {
    it("swaps H×V when JSON is wide but orientation is portrait", () => {
        const p = minimalProject({
            display: {
                orientation: "portrait",
                width: 1024,
                height: 600
            }
        });
        const h = generateDisplayHeader(p);
        expect(h).toMatch(/EMBF_DISPLAY_JSON_WIDTH\s+\(1024U\)/);
        expect(h).toMatch(/EMBF_DISPLAY_JSON_HEIGHT\s+\(600U\)/);
        expect(h).toMatch(/EMBF_DISPLAY_HOR_RES\s+\(600U\)/);
        expect(h).toMatch(/EMBF_DISPLAY_VER_RES\s+\(1024U\)/);
        expect(h).toContain("orientation=portrait");
    });

    it("keeps JSON dimensions in defines when landscape and width > height", () => {
        const p = minimalProject({
            display: {
                orientation: "landscape",
                width: 800,
                height: 600
            }
        });
        const h = generateDisplayHeader(p);
        expect(h).toMatch(/EMBF_DISPLAY_HOR_RES\s+\(800U\)/);
        expect(h).toMatch(/EMBF_DISPLAY_VER_RES\s+\(600U\)/);
    });
});
