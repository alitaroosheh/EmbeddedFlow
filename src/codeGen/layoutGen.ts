import type { Component, ContainerComponent } from "../types/embf";
import { toIdentifier } from "./naming";

export type FlexAlign =
    | "start"
    | "end"
    | "center"
    | "space_evenly"
    | "space_around"
    | "space_between";

export type GridCellAlign = "start" | "end" | "center" | "stretch";

export type GridTrackSize = number | "content" | string;

const FLEX_FLOW: Record<string, string> = {
    row: "LV_FLEX_FLOW_ROW",
    column: "LV_FLEX_FLOW_COLUMN",
    row_wrap: "LV_FLEX_FLOW_ROW_WRAP",
    column_wrap: "LV_FLEX_FLOW_COLUMN_WRAP"
};

const FLEX_ALIGN: Record<FlexAlign, string> = {
    start: "LV_FLEX_ALIGN_START",
    end: "LV_FLEX_ALIGN_END",
    center: "LV_FLEX_ALIGN_CENTER",
    space_evenly: "LV_FLEX_ALIGN_SPACE_EVENLY",
    space_around: "LV_FLEX_ALIGN_SPACE_AROUND",
    space_between: "LV_FLEX_ALIGN_SPACE_BETWEEN"
};

const GRID_ALIGN: Record<FlexAlign, string> = {
    start: "LV_GRID_ALIGN_START",
    end: "LV_GRID_ALIGN_END",
    center: "LV_GRID_ALIGN_CENTER",
    space_evenly: "LV_GRID_ALIGN_SPACE_EVENLY",
    space_around: "LV_GRID_ALIGN_SPACE_AROUND",
    space_between: "LV_GRID_ALIGN_SPACE_BETWEEN"
};

const GRID_CELL_ALIGN: Record<GridCellAlign, string> = {
    start: "LV_GRID_ALIGN_START",
    end: "LV_GRID_ALIGN_END",
    center: "LV_GRID_ALIGN_CENTER",
    stretch: "LV_GRID_ALIGN_STRETCH"
};

function gridTrackToC(track: GridTrackSize): string {
    if (track === "content") {
        return "LV_GRID_CONTENT";
    }
    if (typeof track === "number") {
        return String(Math.round(track));
    }
    const m = /^(\d+(?:\.\d+)?)fr$/i.exec(track.trim());
    if (m) {
        const n = Number(m[1]);
        return Number.isInteger(n) ? `LV_GRID_FR(${n})` : `LV_GRID_FR(${n})`;
    }
    const px = Number.parseInt(track, 10);
    if (Number.isFinite(px)) {
        return String(px);
    }
    return "LV_GRID_FR(1)";
}

function dscArrayName(pageId: string, containerId: string, axis: "col" | "row"): string {
    return `ui_${toIdentifier(pageId)}_${toIdentifier(containerId)}_${axis}_dsc`;
}

export function emitGridDescriptorArrays(
    pageId: string,
    c: ContainerComponent
): string[] {
    if (c.layout !== "grid") {
        return [];
    }
    const cols = c.gridColumnDescriptors ?? ["1fr"];
    const rows = c.gridRowDescriptors ?? ["1fr"];
    const colName = dscArrayName(pageId, c.id, "col");
    const rowName = dscArrayName(pageId, c.id, "row");
    const colItems = cols.map(t => gridTrackToC(t)).concat(["LV_GRID_TEMPLATE_LAST"]);
    const rowItems = rows.map(t => gridTrackToC(t)).concat(["LV_GRID_TEMPLATE_LAST"]);
    return [
        `static const lv_coord_t ${colName}[] = { ${colItems.join(", ")} };`,
        `static const lv_coord_t ${rowName}[] = { ${rowItems.join(", ")} };`
    ];
}

/** Collect grid static arrays for all grid containers on a page (file scope). */
export function collectPageGridDescriptors(pageId: string, components: Component[]): string[] {
    const out: string[] = [];
    function walk(comps: Component[]): void {
        for (const comp of comps) {
            if (comp.type === "container") {
                const c = comp as ContainerComponent;
                out.push(...emitGridDescriptorArrays(pageId, c));
                if (c.children?.length) {
                    walk(c.children);
                }
            } else if (comp.type === "panel") {
                const ch = (comp as { children?: Component[] }).children;
                if (ch?.length) {
                    walk(ch);
                }
            }
        }
    }
    walk(components);
    return out;
}

export function emitContainerLayoutLines(v: string, pageId: string, c: ContainerComponent): string[] {
    const lines: string[] = [];
    if (c.layout === "flex") {
        lines.push(
            `    lv_obj_set_layout(${v}, LV_LAYOUT_FLEX);`,
            `    lv_obj_set_flex_flow(${v}, ${FLEX_FLOW[c.flexFlow ?? "row"] ?? "LV_FLEX_FLOW_ROW"});`
        );
        const main = c.flexAlign ?? "start";
        const cross = c.flexCrossAlign ?? "start";
        const track = c.flexTrackCrossAlign ?? "start";
        lines.push(
            `    lv_obj_set_flex_align(${v}, ${FLEX_ALIGN[main]}, ${FLEX_ALIGN[cross]}, ${FLEX_ALIGN[track]});`
        );
    } else if (c.layout === "grid") {
        const colName = dscArrayName(pageId, c.id, "col");
        const rowName = dscArrayName(pageId, c.id, "row");
        lines.push(`    lv_obj_set_layout(${v}, LV_LAYOUT_GRID);`);
        lines.push(`    lv_obj_set_grid_dsc_array(${v}, ${colName}, ${rowName});`);
        if (c.gridColumnGap !== undefined || c.gridRowGap !== undefined) {
            lines.push(
                `    lv_obj_set_style_pad_column(${v}, ${Math.round(c.gridColumnGap ?? 0)}, LV_PART_MAIN);`,
                `    lv_obj_set_style_pad_row(${v}, ${Math.round(c.gridRowGap ?? 0)}, LV_PART_MAIN);`
            );
        }
        const ga = c.gridAlign ?? "start";
        const gva = c.gridVAlign ?? "start";
        lines.push(`    lv_obj_set_grid_align(${v}, ${GRID_ALIGN[ga]}, ${GRID_ALIGN[gva]});`);
    }
    return lines;
}

export function emitChildLayoutLines(v: string, comp: Component): string[] {
    const lines: string[] = [];
    if (comp.flexGrow !== undefined && comp.flexGrow > 0) {
        lines.push(`    lv_obj_set_flex_grow(${v}, ${Math.round(comp.flexGrow)});`);
    }
    if (
        comp.gridCol !== undefined ||
        comp.gridRow !== undefined ||
        comp.gridColSpan !== undefined ||
        comp.gridRowSpan !== undefined
    ) {
        const col = comp.gridCol ?? 0;
        const row = comp.gridRow ?? 0;
        const cspan = comp.gridColSpan ?? 1;
        const rspan = comp.gridRowSpan ?? 1;
        const xa = GRID_CELL_ALIGN[comp.gridCellXAlign ?? "stretch"];
        const ya = GRID_CELL_ALIGN[comp.gridCellYAlign ?? "stretch"];
        lines.push(
            `    lv_obj_set_grid_cell(${v}, ${xa}, ${col}, ${cspan}, ${ya}, ${row}, ${rspan});`
        );
    }
    return lines;
}
