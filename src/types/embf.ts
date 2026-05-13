export type LvglVersion = "8.4.0" | "9.2.2" | "9.3.0" | "9.4.0" | "9.5.0";
export type ColorFormat = "RGB565" | "RGB888" | "ARGB8888" | "L8" | "AL88";
export type Orientation = "portrait" | "landscape" | "portrait_flipped" | "landscape_flipped";
export type TextDirection = "ltr" | "rtl";

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
}

export interface DisplayConfig {
    width: number;
    height: number;
    bitDepth: 16 | 24 | 32;
    colorFormat: ColorFormat;
    orientation: Orientation;
    direction: TextDirection;
    dpi?: number;
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

export interface Page {
    id: string;
    name: string;
    backgroundColor?: string;
    components: Component[];
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

/** What happens when an event fires */
export type Action =
    | { type: "navigate";    target: string }                        // load page by id
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
