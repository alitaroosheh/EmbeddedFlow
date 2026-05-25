import type {
    Component, LabelComponent, ButtonComponent, SliderComponent,
    SwitchComponent, BarComponent, SpinnerComponent, ArcComponent, KnobComponent,
    CheckboxComponent, DropdownComponent, RollerComponent, TextareaComponent,
    LineComponent, ContainerComponent, PanelComponent, ImageComponent,
    FontDef, StyleDef
} from "../types/embf";
import { toIdentifier, widgetVar } from "./naming";
import { emitStyleCalls } from "./styleGen";
import { styleVarName } from "./stylesGen";
import { emitAnimationCalls } from "./animationGen";

/** Optional shared context for widget emission (project-level resolvers). */
export interface WidgetEmitContext {
    fonts?: FontDef[];
    styles?: StyleDef[];
}

/**
 * Emit all C lines needed to create one component and its children.
 *
 * @param pageId     page ID (for scoping variable names)
 * @param comp       the component definition
 * @param parentExpr C expression for the parent object (e.g. `ui_main` or another var)
 * @param lvglV9     true for LVGL 9.x API, false for 8.x
 * @returns array of C code lines (no trailing newline)
 */
export function emitComponent(
    pageId: string,
    comp: Component,
    parentExpr: string,
    lvglV9: boolean,
    ctx?: WidgetEmitContext
): string[] {
    if (comp.hidden) {
        return [];
    }

    const lines: string[] = [];
    const v = widgetVar(pageId, comp.id);

    switch (comp.type) {
        case "label":      lines.push(...emitLabel(v, comp as LabelComponent, parentExpr, lvglV9)); break;
        case "button":     lines.push(...emitButton(v, comp as ButtonComponent, parentExpr, pageId, lvglV9)); break;
        case "image":      lines.push(...emitImage(v, comp as ImageComponent, parentExpr, lvglV9)); break;
        case "slider":     lines.push(...emitSlider(v, comp as SliderComponent, parentExpr, lvglV9)); break;
        case "switch":     lines.push(...emitSwitch(v, comp as SwitchComponent, parentExpr, lvglV9)); break;
        case "bar":        lines.push(...emitBar(v, comp as BarComponent, parentExpr, lvglV9)); break;
        case "spinner":    lines.push(...emitSpinner(v, comp as SpinnerComponent, parentExpr, lvglV9)); break;
        case "arc":        lines.push(...emitArc(v, comp as ArcComponent, parentExpr, lvglV9)); break;
        case "knob":       lines.push(...emitKnob(v, comp as KnobComponent, parentExpr, lvglV9)); break;
        case "checkbox":   lines.push(...emitCheckbox(v, comp as CheckboxComponent, parentExpr, lvglV9)); break;
        case "dropdown":   lines.push(...emitDropdown(v, comp as DropdownComponent, parentExpr, lvglV9)); break;
        case "roller":     lines.push(...emitRoller(v, comp as RollerComponent, parentExpr, lvglV9)); break;
        case "textarea":   lines.push(...emitTextarea(v, comp as TextareaComponent, parentExpr, lvglV9)); break;
        case "line":       lines.push(...emitLine(v, comp as LineComponent, parentExpr, pageId, lvglV9)); break;
        case "container":  lines.push(...emitContainer(v, comp as ContainerComponent, parentExpr, pageId, lvglV9, ctx)); break;
        case "panel":      lines.push(...emitPanel(v, comp as PanelComponent, parentExpr, pageId, lvglV9, ctx)); break;
        default: {
            const unknown = comp as { type: string; id: string };
            lines.push(`    /* TODO: unsupported widget type "${unknown.type}" — id="${unknown.id}" */`);
            return lines;
        }
    }

    // Position, size, styles apply to all widget types
    lines.push(...posSize(v, comp));
    lines.push(...emitStyleRefCalls(v, comp.styleRefs, ctx?.styles));
    if (comp.styles && Object.keys(comp.styles).length > 0) {
        lines.push(...emitStyleCalls(v, comp.styles, "    ", "LV_PART_MAIN | LV_STATE_DEFAULT", { fonts: ctx?.fonts }));
    }
    lines.push(...emitAnimationCalls(v, comp.animations));
    lines.push("");  // blank line between widgets

    return lines;
}

/** Emit `lv_obj_add_style` for every valid styleRef on this widget. */
function emitStyleRefCalls(v: string, refs: string[] | undefined, defs: StyleDef[] | undefined): string[] {
    if (!refs?.length) {
        return [];
    }
    const known = new Set((defs ?? []).map(d => d.id));
    const lines: string[] = [];
    for (const id of refs) {
        if (!known.has(id)) {
            lines.push(`    /* WARN: styleRef "${id}" not declared in project.styles[] */`);
            continue;
        }
        lines.push(`    lv_obj_add_style(${v}, &${styleVarName(id)}, LV_PART_MAIN | LV_STATE_DEFAULT);`);
    }
    return lines;
}

// ── Position & size ────────────────────────────────────────────────────────────

function posSize(v: string, comp: Component): string[] {
    return [
        `    lv_obj_set_pos(${v}, ${comp.x}, ${comp.y});`,
        `    lv_obj_set_size(${v}, ${comp.width}, ${comp.height});`
    ];
}

// ── Label ──────────────────────────────────────────────────────────────────────

function emitLabel(v: string, c: LabelComponent, parent: string, v9: boolean): string[] {
    const lines = [
        `    lv_obj_t *${v} = lv_label_create(${parent});`
    ];

    const longModeMap: Record<string, string> = {
        wrap:   "LV_LABEL_LONG_WRAP",
        dot:    "LV_LABEL_LONG_DOT",
        scroll: "LV_LABEL_LONG_SCROLL_CIRCULAR",
        clip:   "LV_LABEL_LONG_CLIP"
    };
    if (c.longMode && c.longMode !== "wrap") {
        lines.push(`    lv_label_set_long_mode(${v}, ${longModeMap[c.longMode] ?? "LV_LABEL_LONG_WRAP"});`);
    }

    const escaped = escapeC(c.text);
    lines.push(`    lv_label_set_text(${v}, "${escaped}");`);
    return lines;
}

// ── Button ─────────────────────────────────────────────────────────────────────

function emitButton(v: string, c: ButtonComponent, parent: string, pageId: string, v9: boolean): string[] {
    const createFn = v9 ? "lv_button_create" : "lv_btn_create";
    const lines = [
        `    lv_obj_t *${v} = ${createFn}(${parent});`
    ];
    if (c.label) {
        const lblVar = `${v}_lbl`;
        lines.push(
            `    lv_obj_t *${lblVar} = lv_label_create(${v});`,
            `    lv_label_set_text(${lblVar}, "${escapeC(c.label)}");`,
            `    lv_obj_center(${lblVar});`
        );
    }
    return lines;
}

// ── Image ──────────────────────────────────────────────────────────────────────

function emitImage(v: string, c: ImageComponent, parent: string, v9: boolean): string[] {
    const createFn = v9 ? "lv_image_create" : "lv_img_create";
    const setFn    = v9 ? "lv_image_set_src"  : "lv_img_set_src";
    const imgSym   = `ui_img_${toIdentifier(c.src)}`;
    return [
        `    lv_obj_t *${v} = ${createFn}(${parent});`,
        `    ${setFn}(${v}, &${imgSym});`
    ];
}

// ── Slider ─────────────────────────────────────────────────────────────────────

function emitSlider(v: string, c: SliderComponent, parent: string, _v9: boolean): string[] {
    return [
        `    lv_obj_t *${v} = lv_slider_create(${parent});`,
        `    lv_slider_set_range(${v}, ${c.min}, ${c.max});`,
        `    lv_slider_set_value(${v}, ${c.value}, LV_ANIM_OFF);`
    ];
}

// ── Switch ─────────────────────────────────────────────────────────────────────

function emitSwitch(v: string, c: SwitchComponent, parent: string, _v9: boolean): string[] {
    const lines = [
        `    lv_obj_t *${v} = lv_switch_create(${parent});`
    ];
    if (c.checked) {
        lines.push(`    lv_obj_add_state(${v}, LV_STATE_CHECKED);`);
    }
    return lines;
}

// ── Bar ────────────────────────────────────────────────────────────────────────

function emitBar(v: string, c: BarComponent, parent: string, _v9: boolean): string[] {
    const lines = [
        `    lv_obj_t *${v} = lv_bar_create(${parent});`,
        `    lv_bar_set_range(${v}, ${c.min}, ${c.max});`,
        `    lv_bar_set_value(${v}, ${c.value}, LV_ANIM_OFF);`
    ];
    if (c.mode && c.mode !== "normal") {
        const modeMap: Record<string, string> = {
            symmetrical: "LV_BAR_MODE_SYMMETRICAL",
            range:       "LV_BAR_MODE_RANGE"
        };
        lines.push(`    lv_bar_set_mode(${v}, ${modeMap[c.mode]});`);
    }
    return lines;
}

// ── Spinner ────────────────────────────────────────────────────────────────────

function emitSpinner(v: string, c: SpinnerComponent, parent: string, _v9: boolean): string[] {
    const speed = c.speed ?? 1000;
    const arcLen = c.arcLength ?? 60;
    return [
        `    lv_obj_t *${v} = lv_spinner_create(${parent});`,
        `    lv_spinner_set_anim_params(${v}, ${speed}, ${arcLen});`
    ];
}

// ── Arc ────────────────────────────────────────────────────────────────────────

function emitArc(v: string, c: ArcComponent, parent: string, _v9: boolean): string[] {
    const lines = [
        `    lv_obj_t *${v} = lv_arc_create(${parent});`,
        `    lv_arc_set_range(${v}, ${c.min}, ${c.max});`,
        `    lv_arc_set_value(${v}, ${c.value});`
    ];
    if (c.startAngle !== undefined) {
        lines.push(`    lv_arc_set_bg_angles(${v}, ${c.startAngle}, ${c.endAngle ?? 360});`);
    }
    if (c.mode && c.mode !== "normal") {
        const modeMap: Record<string, string> = {
            reverse:     "LV_ARC_MODE_REVERSE",
            symmetrical: "LV_ARC_MODE_SYMMETRICAL"
        };
        lines.push(`    lv_arc_set_mode(${v}, ${modeMap[c.mode]});`);
    }
    return lines;
}

// ── Knob ───────────────────────────────────────────────────────────────────────

/**
 * Knob primitive — implemented as an `lv_arc_t` with knob-typical defaults:
 *  - 270° sweep (135° → 45°) unless overridden
 *  - thicker indicator arc + visible knob handle in `LV_PART_KNOB`
 *  - background marker layer kept transparent (focus the indicator)
 */
function emitKnob(v: string, c: KnobComponent, parent: string, _v9: boolean): string[] {
    const start = c.startAngle ?? 135;
    const end   = c.endAngle   ?? 45;
    const lines = [
        `    lv_obj_t *${v} = lv_arc_create(${parent});`,
        `    lv_arc_set_range(${v}, ${c.min}, ${c.max});`,
        `    lv_arc_set_value(${v}, ${c.value});`,
        `    lv_arc_set_bg_angles(${v}, ${start}, ${end});`,
        `    lv_obj_remove_style(${v}, NULL, LV_PART_KNOB);`,
        `    lv_obj_set_style_arc_width(${v}, 8, LV_PART_MAIN);`,
        `    lv_obj_set_style_arc_width(${v}, 8, LV_PART_INDICATOR);`,
        `    lv_obj_add_flag(${v}, LV_OBJ_FLAG_CLICKABLE);`
    ];
    if (c.indicatorColor) {
        const col = hexToColor(c.indicatorColor);
        lines.push(`    lv_obj_set_style_arc_color(${v}, ${col}, LV_PART_INDICATOR);`);
    }
    return lines;
}

function hexToColor(hex: string): string {
    const raw = hex.replace(/^#/, "").padStart(6, "0").slice(0, 6).toUpperCase();
    return `lv_color_hex(0x${raw})`;
}

// ── Checkbox ───────────────────────────────────────────────────────────────────

function emitCheckbox(v: string, c: CheckboxComponent, parent: string, _v9: boolean): string[] {
    const lines = [
        `    lv_obj_t *${v} = lv_checkbox_create(${parent});`
    ];
    if (c.text) {
        lines.push(`    lv_checkbox_set_text(${v}, "${escapeC(c.text)}");`);
    }
    if (c.checked) {
        lines.push(`    lv_obj_add_state(${v}, LV_STATE_CHECKED);`);
    }
    return lines;
}

// ── Dropdown ───────────────────────────────────────────────────────────────────

function emitDropdown(v: string, c: DropdownComponent, parent: string, _v9: boolean): string[] {
    const optStr = c.options.join("\n");
    return [
        `    lv_obj_t *${v} = lv_dropdown_create(${parent});`,
        `    lv_dropdown_set_options(${v}, "${escapeC(optStr)}");`,
        `    lv_dropdown_set_selected(${v}, ${c.selectedIndex});`
    ];
}

// ── Roller ─────────────────────────────────────────────────────────────────────

function emitRoller(v: string, c: RollerComponent, parent: string, _v9: boolean): string[] {
    const optStr = c.options.join("\n");
    const modeConst = c.mode === "infinite"
        ? "LV_ROLLER_MODE_INFINITE"
        : "LV_ROLLER_MODE_NORMAL";
    return [
        `    lv_obj_t *${v} = lv_roller_create(${parent});`,
        `    lv_roller_set_options(${v}, "${escapeC(optStr)}", ${modeConst});`,
        `    lv_roller_set_selected(${v}, ${c.selectedIndex}, LV_ANIM_OFF);`
    ];
}

// ── Textarea ───────────────────────────────────────────────────────────────────

function emitTextarea(v: string, c: TextareaComponent, parent: string, _v9: boolean): string[] {
    const lines = [
        `    lv_obj_t *${v} = lv_textarea_create(${parent});`
    ];
    if (c.text) {
        lines.push(`    lv_textarea_set_text(${v}, "${escapeC(c.text)}");`);
    }
    if (c.placeholder) {
        lines.push(`    lv_textarea_set_placeholder_text(${v}, "${escapeC(c.placeholder)}");`);
    }
    if (c.oneLine) {
        lines.push(`    lv_textarea_set_one_line(${v}, true);`);
    }
    return lines;
}

// ── Line ───────────────────────────────────────────────────────────────────────

function emitLine(v: string, c: LineComponent, parent: string, pageId: string, _v9: boolean): string[] {
    const pointsVar = `${widgetVar(pageId, c.id)}_points`;
    const ptsLiteral = c.points.map(p => `{${p.x}, ${p.y}}`).join(", ");
    const lines = [
        `    static lv_point_precise_t ${pointsVar}[] = {${ptsLiteral}};`,
        `    lv_obj_t *${v} = lv_line_create(${parent});`,
        `    lv_line_set_points(${v}, ${pointsVar}, ${c.points.length});`
    ];
    if (c.rounded) {
        lines.push(`    lv_line_set_y_invert(${v}, false);`);
    }
    return lines;
}

// ── Container ─────────────────────────────────────────────────────────────────

function emitContainer(v: string, c: ContainerComponent, parent: string, pageId: string, v9: boolean, ctx?: WidgetEmitContext): string[] {
    const lines = [
        `    lv_obj_t *${v} = lv_obj_create(${parent});`
    ];

    if (!c.styles?.bgColor && (c.styles?.bgOpacity === undefined || c.styles.bgOpacity === 0)) {
        lines.push(
            `    lv_obj_set_style_pad_all(${v}, 0, LV_PART_MAIN);`,
            `    lv_obj_set_style_border_width(${v}, 0, LV_PART_MAIN);`,
            `    lv_obj_set_style_bg_opa(${v}, LV_OPA_TRANSP, LV_PART_MAIN);`,
            `    lv_obj_add_flag(${v}, LV_OBJ_FLAG_OVERFLOW_VISIBLE);`
        );
    }

    if (c.layout === "flex") {
        const flowMap: Record<string, string> = {
            row:         "LV_FLEX_FLOW_ROW",
            column:      "LV_FLEX_FLOW_COLUMN",
            row_wrap:    "LV_FLEX_FLOW_ROW_WRAP",
            column_wrap: "LV_FLEX_FLOW_COLUMN_WRAP"
        };
        lines.push(
            `    lv_obj_set_layout(${v}, LV_LAYOUT_FLEX);`,
            `    lv_obj_set_flex_flow(${v}, ${flowMap[c.flexFlow ?? "row"] ?? "LV_FLEX_FLOW_ROW"});`
        );
    } else if (c.layout === "grid") {
        lines.push(`    lv_obj_set_layout(${v}, LV_LAYOUT_GRID);`);
    }

    for (const child of c.children ?? []) {
        lines.push(...emitComponent(pageId, child, v, v9, ctx));
    }
    return lines;
}

// ── Panel ─────────────────────────────────────────────────────────────────────

function emitPanel(v: string, c: PanelComponent, parent: string, pageId: string, v9: boolean, ctx?: WidgetEmitContext): string[] {
    const lines = [
        `    lv_obj_t *${v} = lv_obj_create(${parent});`
    ];
    if (!c.styles?.bgColor && (c.styles?.bgOpacity === undefined || c.styles.bgOpacity === 0)) {
        lines.push(
            `    lv_obj_set_style_pad_all(${v}, 0, LV_PART_MAIN);`,
            `    lv_obj_set_style_border_width(${v}, 0, LV_PART_MAIN);`,
            `    lv_obj_set_style_bg_opa(${v}, LV_OPA_TRANSP, LV_PART_MAIN);`,
            `    lv_obj_add_flag(${v}, LV_OBJ_FLAG_OVERFLOW_VISIBLE);`
        );
    }
    for (const child of c.children ?? []) {
        lines.push(...emitComponent(pageId, child, v, v9, ctx));
    }
    return lines;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Escape a string for use in a C string literal. */
function escapeC(s: string): string {
    return s
        .replace(/\\/g, "\\\\")
        .replace(/"/g,  '\\"')
        .replace(/\n/g, "\\n")
        .replace(/\r/g, "\\r")
        .replace(/\t/g, "\\t");
}
