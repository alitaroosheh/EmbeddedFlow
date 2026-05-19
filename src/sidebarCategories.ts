/** Left sidebar category definitions (rail + parallel content panel). */

export interface SidebarCategory {
    id: string;
    label: string;
    title: string;
    /** Inline SVG for the category rail button. */
    iconSvg: string;
    /** Wider content panel when this category is active. */
    widePanel?: boolean;
}

const ICON_COMPONENTS = `<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="3" y="3" width="6" height="6" rx="1" fill="none" stroke="currentColor" stroke-width="1.4"/><rect x="11" y="3" width="6" height="6" rx="1" fill="none" stroke="currentColor" stroke-width="1.4"/><rect x="3" y="11" width="6" height="6" rx="1" fill="none" stroke="currentColor" stroke-width="1.4"/><rect x="11" y="11" width="6" height="6" rx="1" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>`;

const ICON_PAGES = `<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="4" y="3" width="12" height="4" rx="1" fill="none" stroke="currentColor" stroke-width="1.4"/><rect x="4" y="9" width="12" height="4" rx="1" fill="none" stroke="currentColor" stroke-width="1.4"/><rect x="4" y="15" width="8" height="2" rx="0.5" fill="currentColor"/></svg>`;

const ICON_FLOW = `<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="5" cy="10" r="2.5" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="15" cy="5" r="2.5" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="15" cy="15" r="2.5" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M7.2 9.2 L12 6.2 M7.2 10.8 L12 13.8" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>`;

export const SIDEBAR_CATEGORIES: SidebarCategory[] = [
    {
        id: "components",
        label: "Components",
        title: "Add widgets to the current page",
        iconSvg: ICON_COMPONENTS
    },
    {
        id: "pages",
        label: "Pages",
        title: "Switch between project screens",
        iconSvg: ICON_PAGES,
        widePanel: true
    },
    {
        id: "flow",
        label: "Flow",
        title: "Page navigation between components",
        iconSvg: ICON_FLOW,
        widePanel: true
    }
];

export const DEFAULT_SIDEBAR_CATEGORY = "components";

export function buildSidebarRailHtml(activeId: string = DEFAULT_SIDEBAR_CATEGORY): string {
    return SIDEBAR_CATEGORIES.map(
        c => `<button type="button" class="sidebar-rail-btn${c.id === activeId ? " active" : ""}" data-sidebar-panel="${c.id}" title="${c.title}" aria-label="${c.label}">
${c.iconSvg}
</button>`
    ).join("\n");
}

export function buildSidebarPanelViewsHtml(widgetPaletteHtml: string): string {
    return SIDEBAR_CATEGORIES.map(c => {
        if (c.id === "components") {
            const hidden = c.id === DEFAULT_SIDEBAR_CATEGORY ? "" : " hidden";
            return `<div id="sidebar-panel-${c.id}" class="sidebar-panel-view" data-sidebar-panel="${c.id}" role="tabpanel"${hidden}>
${widgetPaletteHtml}
</div>`;
        }
        if (c.id === "pages") {
            return `<div id="sidebar-panel-${c.id}" class="sidebar-panel-view sidebar-panel-view-pages" data-sidebar-panel="${c.id}" role="tabpanel" hidden>
<div class="page-sidebar-actions">
<button type="button" class="tb-btn-small" id="btn-page-add" title="Add a new page">+ Add</button>
<button type="button" class="tb-btn-small" id="btn-page-remove" title="Remove selected page">Remove</button>
<button type="button" class="tb-btn-small" id="btn-page-rename" title="Rename selected page">Rename</button>
</div>
<ul id="page-list" class="page-list" aria-label="Project pages"></ul>
</div>`;
        }
        if (c.id === "flow") {
            return `<div id="sidebar-panel-${c.id}" class="sidebar-panel-view sidebar-panel-view-flow" data-sidebar-panel="${c.id}" role="tabpanel" hidden>
<div class="flow-add-form">
<label class="flow-field"><span class="flow-label">Type</span><select id="flow-kind" title="Component event or screen swipe">
<option value="component">Component event</option>
<option value="swipe">Swipe</option>
</select></label>
<label class="flow-field"><span class="flow-label">From page</span><select id="flow-from-page"></select></label>
<div id="flow-component-fields">
<label class="flow-field"><span class="flow-label">Component</span><select id="flow-component"></select></label>
<label class="flow-field"><span class="flow-label">On</span><select id="flow-trigger">
<option value="clicked">clicked</option>
<option value="long_pressed">long_pressed</option>
<option value="value_changed">value_changed</option>
</select></label>
</div>
<div id="flow-swipe-fields" hidden>
<label class="flow-field"><span class="flow-label">Swipe</span><select id="flow-swipe-direction" title="Finger swipe direction on the page screen">
<option value="left">Swipe left</option>
<option value="right">Swipe right</option>
<option value="top">Swipe up</option>
<option value="bottom">Swipe down</option>
</select></label>
</div>
<label class="flow-field"><span class="flow-label">To page</span><select id="flow-to-page"></select></label>
<label class="flow-field"><span class="flow-label">Animation</span><select id="flow-anim" title="LVGL screen load animation (firmware; preview stays instant)">
<option value="none">None (instant)</option>
<option value="move_left">Move left</option>
<option value="move_right">Move right</option>
<option value="move_top">Move top</option>
<option value="move_bottom">Move bottom</option>
<option value="over_left">Over left</option>
<option value="over_right">Over right</option>
<option value="over_top">Over top</option>
<option value="over_bottom">Over bottom</option>
<option value="fade_in">Fade in</option>
<option value="fade_out">Fade out</option>
<option value="out_left">Out left</option>
<option value="out_right">Out right</option>
<option value="out_top">Out top</option>
<option value="out_bottom">Out bottom</option>
</select></label>
<label class="flow-field"><span class="flow-label">Duration (ms)</span><input type="number" id="flow-time" min="0" step="50" value="300" title="Animation duration in milliseconds"></label>
<button type="button" class="tb-btn-small" id="btn-flow-add">+ Add flow</button>
</div>
<ul id="flow-list" class="flow-list" aria-label="Page navigation flows"></ul>
</div>`;
        }
        return `<div id="sidebar-panel-${c.id}" class="sidebar-panel-view" data-sidebar-panel="${c.id}" role="tabpanel" hidden></div>`;
    }).join("\n");
}
