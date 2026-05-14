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

    it("swaps landscape when height exceeds width (panel stored as portrait pixels)", () => {
        const p = minimalProject({
            display: { orientation: "landscape", width: 480, height: 800 }
        });
        expect(getEffectiveDisplaySize(p)).toEqual({ width: 800, height: 480 });
    });

    it("swaps portrait when width exceeds height", () => {
        const p = minimalProject({
            display: { orientation: "portrait", width: 600, height: 320 }
        });
        expect(getEffectiveDisplaySize(p)).toEqual({ width: 320, height: 600 });
    });

    it("keeps portrait when height already exceeds width", () => {
        const p = minimalProject({
            display: { orientation: "portrait", width: 320, height: 480 }
        });
        expect(getEffectiveDisplaySize(p)).toEqual({ width: 320, height: 480 });
    });

    it("treats landscape_flipped like landscape for sizing", () => {
        const p = minimalProject({
            display: { orientation: "landscape_flipped", width: 100, height: 200 }
        });
        expect(getEffectiveDisplaySize(p)).toEqual({ width: 200, height: 100 });
    });

    it("treats portrait_flipped like portrait for sizing", () => {
        const p = minimalProject({
            display: { orientation: "portrait_flipped", width: 200, height: 100 }
        });
        expect(getEffectiveDisplaySize(p)).toEqual({ width: 100, height: 200 });
    });
});
