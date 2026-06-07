import { describe, expect, it } from "vitest";
import { generatePageSource } from "../src/codeGen/pageGen";
import { minimalProject } from "./fixtures";

describe("codegen layout (V5)", () => {
    it("emits flex align and flexGrow on containers and children", () => {
        const p = minimalProject();
        p.pages[0].components = [
            {
                id: "flex_root",
                type: "container",
                x: 0,
                y: 0,
                width: 200,
                height: 100,
                layout: "flex",
                flexFlow: "column",
                flexAlign: "center",
                flexCrossAlign: "start",
                flexTrackCrossAlign: "space_between",
                children: [
                    {
                        id: "lbl_a",
                        type: "label",
                        x: 0,
                        y: 0,
                        width: 80,
                        height: 24,
                        text: "A",
                        flexGrow: 1
                    }
                ]
            }
        ];
        const src = generatePageSource(p, p.pages[0]);
        expect(src).toContain("lv_obj_set_layout(ui_page_main_flex_root, LV_LAYOUT_FLEX)");
        expect(src).toContain("lv_obj_set_flex_flow(ui_page_main_flex_root, LV_FLEX_FLOW_COLUMN)");
        expect(src).toContain("lv_obj_set_flex_align(ui_page_main_flex_root");
        expect(src).toContain("LV_FLEX_ALIGN_CENTER");
        expect(src).toContain("LV_FLEX_ALIGN_SPACE_BETWEEN");
        expect(src).toContain("lv_obj_set_flex_grow(ui_page_main_lbl_a, 1)");
    });

    it("emits grid descriptors and grid cells", () => {
        const p = minimalProject();
        p.pages[0].components = [
            {
                id: "grid_root",
                type: "container",
                x: 0,
                y: 0,
                width: 200,
                height: 100,
                layout: "grid",
                gridColumnDescriptors: ["1fr", "2fr"],
                gridRowDescriptors: [40, "content"],
                gridColumnGap: 8,
                gridRowGap: 4,
                children: [
                    {
                        id: "cell_a",
                        type: "label",
                        x: 0,
                        y: 0,
                        width: 60,
                        height: 20,
                        text: "Cell",
                        gridCol: 1,
                        gridRow: 0,
                        gridColSpan: 1,
                        gridRowSpan: 1,
                        gridCellXAlign: "stretch",
                        gridCellYAlign: "center"
                    }
                ]
            }
        ];
        const src = generatePageSource(p, p.pages[0]);
        expect(src).toContain("ui_page_main_grid_root_col_dsc[]");
        expect(src).toContain("LV_GRID_FR(1)");
        expect(src).toContain("LV_GRID_FR(2)");
        expect(src).toContain("LV_GRID_CONTENT");
        expect(src).toContain("lv_obj_set_grid_dsc_array(ui_page_main_grid_root");
        expect(src).toContain("lv_obj_set_style_pad_column(ui_page_main_grid_root, 8");
        expect(src).toContain("lv_obj_set_grid_cell(ui_page_main_cell_a");
    });
});
