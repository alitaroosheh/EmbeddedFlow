export type LvglVersion = "8.4.0" | "9.2.2" | "9.3.0" | "9.4.0" | "9.5.0";
export type ColorFormat = "RGB565" | "RGB888" | "ARGB8888" | "L8" | "AL88";
export type Orientation = "portrait" | "landscape" | "portrait_flipped" | "landscape_flipped";
export type TextDirection = "ltr" | "rtl";

/** How generated C code includes LVGL (platform include paths differ). */
export type LvglIncludePath = "lvgl.h" | "lvgl/lvgl.h";

export interface EmbfProject {
    version: "1.0";
    project: ProjectMeta;
    display: DisplayConfig;
    theme?: ThemeConfig;
    fonts?: FontDef[];
    images?: ImageDef[];
    pages: Page[];
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
    components: Component[];
    /** Page-level swipe handlers (LVGL `LV_EVENT_GESTURE` on the screen). */
    swipes?: PageSwipeFlow[];
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
    events?: EventDef[];
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
    text: string;
    longMode?: "wrap" | "dot" | "scroll" | "clip";
}

export interface ButtonComponent extends BaseComponent {
    type: "button";
    label?: string;
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

export interface CheckboxComponent extends BaseComponent {
    type: "checkbox";
    text?: string;
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
