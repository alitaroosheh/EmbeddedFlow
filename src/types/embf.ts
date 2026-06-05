export type LvglVersion = "8.4.0" | "9.2.2" | "9.3.0" | "9.4.0" | "9.5.0";
export type ColorFormat = "RGB565" | "RGB888" | "ARGB8888" | "L8" | "AL88";
export type Orientation = "portrait" | "landscape" | "portrait_flipped" | "landscape_flipped";
export type TextDirection = "ltr" | "rtl";

/** How generated C code includes LVGL (platform include paths differ). */
export type LvglIncludePath = "lvgl.h" | "lvgl/lvgl.h";

/** Widget copy that references a row in the linked `.res` file. */
export interface StringResourceRef {
    ref: string;
}

/** Literal string or `{ "ref": "key" }` string resource reference. */
export type WidgetTextValue = string | StringResourceRef;

/** Reusable grouped widget saved in the project (insert copies onto a page). */
export interface ComponentLibraryEntry {
    id: string;
    name: string;
    width: number;
    height: number;
    root: ContainerComponent | PanelComponent;
}

export interface EmbfProject {
    version: "1.0";
    project: ProjectMeta;
    display: DisplayConfig;
    theme?: ThemeConfig;
    fonts?: FontDef[];
    images?: ImageDef[];
    /** Reusable named styles emitted as `lv_style_t ui_style_<id>` in `ui_styles.c`. */
    styles?: StyleDef[];
    /**
     * Legacy application fields — Phase 1+ codegen (`ui_bindings.c`) uses this when present.
     * Prefer `model.properties` for new projects (preview-only in Phase 1).
     */
    dataModel?: DataModel;
    /** Application model: properties (Phase 1 IR metadata), derived state (Phase 3). */
    model?: ModelSection;
    pages: Page[];
    /** User-defined reusable groups (container/panel subtrees). */
    componentLibrary?: ComponentLibraryEntry[];
}

/** Named reusable style → `lv_style_t ui_style_<id>` with `lv_obj_add_style` references on widgets. */
export interface StyleDef {
    id: string;
    name?: string;
    /** Property bag — same keys understood by inline StyleProps. */
    props: StyleProps;
}

/** App-side data fields. Phase-1 binding emits `extern <type> ui_data_<id>;` + setters. */
export interface DataModel {
    fields: DataField[];
}

export type DataFieldType = "string" | "int" | "float" | "bool";

export interface DataField {
    id: string;
    type: DataFieldType;
    /** Default value used both for preview substitution and `ui_bindings_init()`. */
    default?: string | number | boolean;
}

export type PropertyDirection = "push" | "pull" | "unknown";

/** Phase 1 property metadata — preview mocks; no codegen until symbol binding (Phase 2). */
export interface ModelProperty {
    id: string;
    type: DataFieldType;
    default?: string | number | boolean;
    min?: number;
    max?: number;
    /** Hint for Phase 2 codegen: push (setter) vs pull (extern + apply). */
    direction?: PropertyDirection;
}

export interface ModelSection {
    properties?: ModelProperty[];
    /** Phase 3 — derived boolean expressions. */
    derived?: ModelDerived[];
}

export interface ModelDerived {
    id: string;
    expression: string;
    cached?: boolean;
}

export interface ProjectMeta {
    name: string;
    lvglVersion: LvglVersion;
    description?: string;
    /**
     * Folder for generated C UI files (`ui.c`, `ui_*.c`, …).
     * Relative paths are resolved from the `.embf` file’s directory; absolute paths are used as-is.
     * When omitted, the extension uses `embeddedflow.outputDirectory` or `ui_output` next to the `.embf` file.
     */
    outputPath?: string;
    /**
     * LVGL header include in generated `ui*.h` / `ui.h`.
     * @default "lvgl/lvgl.h"
     */
    lvglInclude?: LvglIncludePath;
    /**
     * Path to application string resources (`.res` only).
     * Relative to the `.embf` file; default `strings.res` when omitted.
     */
    stringsPath?: string;
    /** Firmware project root for clangd symbol discovery (Phase 2+). */
    firmwarePath?: string;
}

export interface DisplayConfig {
    width: number;
    height: number;
    bitDepth: 16 | 24 | 32;
    colorFormat: ColorFormat;
    orientation: Orientation;
    direction: TextDirection;
    dpi?: number;
    /**
     * Circular panel (preview only): clips the framebuffer to an inscribed circle
     * (diameter = min(width, height)), centered — matches round LCDs (e.g. GC9A01).
     */
    round?: boolean;
}

export interface ThemeConfig {
    dark: boolean;
    primaryColor?: string;
    secondaryColor?: string;
}

export interface FontDef {
    id: string;
    name: string;
    size: number;
    source?: string;
}

export interface ImageDef {
    id: string;
    path: string;
}

// ─── Page ────────────────────────────────────────────────────────────────────

/** Finger swipe direction on a page (maps to `lv_indev_get_gesture_dir()` / `LV_DIR_*`). */
export type SwipeDirection = "left" | "right" | "top" | "bottom";

/** Navigate to another page when the user swipes on this page's screen. */
export interface PageSwipeFlow {
    direction: SwipeDirection;
    target: string;
    anim?: ScreenLoadAnim;
    time?: number;
    delay?: number;
    autoDel?: boolean;
}

export interface Page {
    id: string;
    name: string;
    backgroundColor?: string;
    /** Enable/disable horizontal scrolling on the page's screen object. */
    scrollX?: boolean;
    /** Enable/disable vertical scrolling on the page's screen object. */
    scrollY?: boolean;
    components: Component[];
    /** Page-level swipe handlers (LVGL `LV_EVENT_GESTURE` on the screen). */
    swipes?: PageSwipeFlow[];
    /** Navigation flow diagram position (canvas pixels). Omitted = auto grid layout. */
    flowX?: number;
    flowY?: number;
}

// ─── Components ──────────────────────────────────────────────────────────────

export type Component =
    | LabelComponent
    | ButtonComponent
    | ImageComponent
    | SliderComponent
    | SwitchComponent
    | BarComponent
    | SpinnerComponent
    | ArcComponent
    | KnobComponent
    | CheckboxComponent
    | DropdownComponent
    | RollerComponent
    | TextareaComponent
    | LineComponent
    | ContainerComponent
    | PanelComponent;

export type ComponentType =
    | "label"
    | "button"
    | "image"
    | "slider"
    | "switch"
    | "bar"
    | "spinner"
    | "arc"
    | "knob"
    | "checkbox"
    | "dropdown"
    | "roller"
    | "textarea"
    | "line"
    | "container"
    | "panel";

// ─── Events & Actions ─────────────────────────────────────────────────────────

/** User-input triggers mapped to LVGL event codes */
export type EventTrigger =
    | "clicked"        // LV_EVENT_CLICKED
    | "long_pressed"   // LV_EVENT_LONG_PRESSED
    | "value_changed"; // LV_EVENT_VALUE_CHANGED

/**
 * Screen transition when loading another page (maps to LVGL `lv_scr_load_anim` / `lv_screen_load_anim`).
 * Codegen always emits `LV_SCR_LOAD_ANIM_*` constants (v8 native; v9 via `lv_api_map_v9_*.h`).
 * Omitted or `"none"` → instant `lv_scr_load` / `lv_screen_load`.
 */
export type ScreenLoadAnim =
    | "none"
    | "move_left"
    | "move_right"
    | "move_top"
    | "move_bottom"
    | "over_left"
    | "over_right"
    | "over_top"
    | "over_bottom"
    | "fade_in"
    | "fade_out"
    | "out_left"
    | "out_right"
    | "out_top"
    | "out_bottom";

/** Shared transition fields for page navigation actions. */
export interface NavTransitionFields {
    anim?: ScreenLoadAnim;
    time?: number;
    delay?: number;
    autoDel?: boolean;
}

/** Navigate to another page by id. */
export interface NavigateAction extends NavTransitionFields {
    type: "navigate";
    target: string;
}

/** Push route onto navigation stack (codegen: same as navigate until ui_nav ships). */
export interface NavPushAction extends NavTransitionFields {
    type: "nav_push";
    route: string;
}

/** Pop navigation stack (parsed/stored; stack codegen postponed). */
export interface NavPopAction extends NavTransitionFields {
    type: "nav_pop";
}

export interface NavReplaceAction extends NavTransitionFields {
    type: "nav_replace";
    route: string;
}

export interface NavResetAction extends NavTransitionFields {
    type: "nav_reset";
    route: string;
}

/** What happens when an event fires */
export type Action =
    | NavigateAction
    | NavPushAction
    | NavPopAction
    | NavReplaceAction
    | NavResetAction
    | { type: "set_text";    target: string; text: string }          // update label text
    | { type: "set_value";   target: string; value: number }         // slider/bar/arc
    | { type: "set_checked"; target: string; checked: boolean }      // switch/checkbox
    | { type: "set_hidden";  target: string; hidden: boolean }       // show/hide widget
    /** Re-apply LVGL default theme. Preview: optional `dark` toggles runtime override; omit `dark` on `value_changed` to mirror switch/checkbox checked state. Firmware: re-init theme on display. */
    | { type: "set_theme"; dark?: boolean };

export interface EventDef {
    trigger: EventTrigger;
    actions: Action[];
}

// ─── Base component ────────────────────────────────────────────────────────────

export interface BaseComponent {
    id: string;
    type: ComponentType;
    x: number;
    y: number;
    width: number;
    height: number;
    hidden?: boolean;
    styles?: StyleProps;
    /** Named-style references applied in order (`project.styles[].id`). */
    styleRefs?: string[];
    events?: EventDef[];
    /** Widget-scoped LVGL animations applied after creation. */
    animations?: AnimationDef[];
    /**
     * Data bindings keyed by widget property → `project.dataModel.fields[].id`.
     * Supported properties depend on widget type:
     *   - all                  → `text` (label only) is handled via `{{field}}` in `text`
     *   - slider / bar / arc   → `value`     (numeric)
     */
    bindings?: { [propertyName: string]: string };
    /** Enable/disable horizontal scrolling on this widget (LVGL scroll dir). */
    scrollX?: boolean;
    /** Enable/disable vertical scrolling on this widget (LVGL scroll dir). */
    scrollY?: boolean;
}

/** Property of a widget that can be animated. Maps to a `lv_obj_set_*` setter in codegen. */
export type AnimationProperty = "x" | "y" | "width" | "height" | "opacity";

/** Animation easing path — maps to an `lv_anim_path_*` function pointer. */
export type AnimationEasing =
    | "linear"
    | "ease_in"
    | "ease_out"
    | "ease_in_out"
    | "overshoot"
    | "bounce"
    | "step";

/** Single LVGL animation applied to the owning widget when the screen loads. */
export interface AnimationDef {
    id?: string;
    property: AnimationProperty;
    from: number;
    to: number;
    /** Duration in milliseconds (defaults to 500 in codegen). */
    duration?: number;
    delay?: number;
    easing?: AnimationEasing;
    /** Number of repeats (`0` = none, omit / `-1` for infinite). */
    repeat?: number;
    /** When true, animates back to `from` after reaching `to` (LVGL `lv_anim_set_playback_*`). */
    playback?: boolean;
}

export interface StyleProps {
    bgColor?: string;
    /** Bar / slider / switch indicator fill (LVGL `LV_PART_INDICATOR`). */
    indicatorColor?: string;
    bgOpacity?: number;
    textColor?: string;
    borderColor?: string;
    borderWidth?: number;
    borderRadius?: number;
    padding?: number | [number, number] | [number, number, number, number];
    fontSize?: number;
    fontFamily?: string;
    align?: "left" | "center" | "right";
}

export interface LabelComponent extends BaseComponent {
    type: "label";
    text: WidgetTextValue;
    longMode?: "wrap" | "dot" | "scroll" | "clip";
}

export interface ButtonComponent extends BaseComponent {
    type: "button";
    label?: WidgetTextValue;
}

export interface ImageComponent extends BaseComponent {
    type: "image";
    src: string;
}

export interface SliderComponent extends BaseComponent {
    type: "slider";
    min: number;
    max: number;
    value: number;
}

export interface SwitchComponent extends BaseComponent {
    type: "switch";
    checked: boolean;
}

export interface BarComponent extends BaseComponent {
    type: "bar";
    min: number;
    max: number;
    value: number;
    mode?: "normal" | "symmetrical" | "range";
}

export interface SpinnerComponent extends BaseComponent {
    type: "spinner";
    speed?: number;
    arcLength?: number;
}

export interface ArcComponent extends BaseComponent {
    type: "arc";
    min: number;
    max: number;
    value: number;
    startAngle?: number;
    endAngle?: number;
    mode?: "normal" | "reverse" | "symmetrical";
}

/**
 * Knob widget — first-class type emitted as a styled `lv_arc_t` with click-to-adjust
 * enabled (LVGL's arc is the standard primitive used to build rotary knobs).
 * Distinct schema from {@link ArcComponent} so the inspector + palette + codegen
 * can present knob-specific defaults (full 270° sweep, larger indicator).
 */
export interface KnobComponent extends BaseComponent {
    type: "knob";
    min: number;
    max: number;
    value: number;
    /** Background arc start angle in LVGL degrees (default 135). */
    startAngle?: number;
    /** Background arc end angle in LVGL degrees (default 45 — full 270° sweep). */
    endAngle?: number;
    /** Color of the value indicator + knob (defaults to theme primary). */
    indicatorColor?: string;
}

export interface CheckboxComponent extends BaseComponent {
    type: "checkbox";
    text?: WidgetTextValue;
    checked: boolean;
}

export interface DropdownComponent extends BaseComponent {
    type: "dropdown";
    options: string[];
    selectedIndex: number;
}

export interface RollerComponent extends BaseComponent {
    type: "roller";
    options: string[];
    selectedIndex: number;
    mode?: "normal" | "infinite";
}

export interface TextareaComponent extends BaseComponent {
    type: "textarea";
    text?: string;
    placeholder?: string;
    oneLine?: boolean;
}

export interface LineComponent extends BaseComponent {
    type: "line";
    points: Array<{ x: number; y: number }>;
    rounded?: boolean;
}

export interface ContainerComponent extends BaseComponent {
    type: "container";
    layout?: "none" | "flex" | "grid";
    flexFlow?: "row" | "column" | "row_wrap" | "column_wrap";
    children: Component[];
}

export interface PanelComponent extends BaseComponent {
    type: "panel";
    children: Component[];
}
