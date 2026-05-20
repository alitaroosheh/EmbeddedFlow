import { describe, expect, it } from "vitest";
import { buildNewProjectTemplate, sanitizeProjectFileName } from "../src/embfProjectTemplate";

describe("embfNewProject", () => {
    it("sanitizeProjectFileName strips unsafe characters", () => {
        expect(sanitizeProjectFileName("  My UI!  ")).toBe("My_UI");
        expect(sanitizeProjectFileName("   ")).toBe("MyDisplay");
    });

    it("buildNewProjectTemplate includes starter page and label", () => {
        const p = buildNewProjectTemplate("Traffic", "9.5.0");
        expect(p.project.name).toBe("Traffic");
        expect(p.project.lvglVersion).toBe("9.5.0");
        expect(p.pages).toHaveLength(1);
        expect(p.pages[0].components?.[0]).toMatchObject({
            id: "lbl_hello",
            type: "label"
        });
    });
});
