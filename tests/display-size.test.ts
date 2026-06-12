import { describe, it, expect } from "vitest";
import { getEffectiveDisplaySize } from "../src/embfParser";
import { minimalProject } from "./fixtures";

describe("getEffectiveDisplaySize", () => {
    it("keeps landscape when width already exceeds height", () => {
        const p = minimalProject({
            display: { orientation: "landscape", width: 800, height: 600 }
        });
        expect(getEffectiveDisplaySize(p)).toEqual({ width: 800, height: 600 });
    });

    it("does not swap tall JSON when orientation is still landscape (128×160 portrait UI)", () => {
        const p = minimalProject({
            display: { orientation: "landscape", width: 128, height: 160 }
        });
        expect(getEffectiveDisplaySize(p)).toEqual({ width: 128, height: 160 });
    });

    it("swaps wide JSON when orientation is portrait (1024×600 panel mounted portrait)", () => {
        const p = minimalProject({
            display: { orientation: "portrait", width: 1024, height: 600 }
        });
        expect(getEffectiveDisplaySize(p)).toEqual({ width: 600, height: 1024 });
    });

    it("keeps portrait when height already exceeds width", () => {
        const p = minimalProject({
            display: { orientation: "portrait", width: 320, height: 480 }
        });
        expect(getEffectiveDisplaySize(p)).toEqual({ width: 320, height: 480 });
    });

    it("swaps wide JSON under portrait_flipped", () => {
        const p = minimalProject({
            display: { orientation: "portrait_flipped", width: 600, height: 320 }
        });
        expect(getEffectiveDisplaySize(p)).toEqual({ width: 320, height: 600 });
    });

    it("keeps tall JSON under landscape_flipped", () => {
        const p = minimalProject({
            display: { orientation: "landscape_flipped", width: 100, height: 200 }
        });
        expect(getEffectiveDisplaySize(p)).toEqual({ width: 100, height: 200 });
    });
});
