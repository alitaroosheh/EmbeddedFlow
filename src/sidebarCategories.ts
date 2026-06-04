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

const ICON_TREE = `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 4h4v4H4V4zm0 6h4v4H4v-4zm8-6h4v4h-4V4zm0 6h4v4h-4v-4z" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>`;

const ICON_SETTINGS = `<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="2.5" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M10 2v2M10 16v2M2 10h2M16 10h2M4.2 4.2l1.4 1.4M14.4 14.4l1.4 1.4M4.2 15.8l1.4-1.4M14.4 5.6l1.4-1.4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>`;

export const SIDEBAR_CATEGORIES: SidebarCategory[] = [
    {
        id: "components",
        label: "Components",
        title: "Add widgets to the current page",
        iconSvg: ICON_COMPONENTS,
        widePanel: true
    },
    {
        id: "pages",
        label: "Pages",
        title: "Switch between project screens",
        iconSvg: ICON_PAGES,
        widePanel: true
    },
    {
        id: "hierarchy",
        label: "Tree",
        title: "Widget hierarchy on the current page",
        iconSvg: ICON_TREE,
        widePanel: true
    },
    {
        id: "settings",
        label: "Settings",
        title: "Project, display, and codegen settings",
        iconSvg: ICON_SETTINGS,
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

export function buildSidebarPanelViewsHtml(componentsPanelHtml: string): string {
    return SIDEBAR_CATEGORIES.map(c => {
        if (c.id === "components") {
            const hidden = c.id === DEFAULT_SIDEBAR_CATEGORY ? "" : " hidden";
            return `<div id="sidebar-panel-${c.id}" class="sidebar-panel-view" data-sidebar-panel="${c.id}" role="tabpanel"${hidden}>
${componentsPanelHtml}
</div>`;
        }
        if (c.id === "hierarchy") {
            return `<div id="sidebar-panel-${c.id}" class="sidebar-panel-view sidebar-panel-view-hierarchy" data-sidebar-panel="${c.id}" role="tabpanel" hidden>
<ul id="widget-tree" class="widget-tree" aria-label="Widget hierarchy"></ul>
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
        if (c.id === "settings") {
            return `<div id="sidebar-panel-${c.id}" class="sidebar-panel-view sidebar-panel-view-settings" data-sidebar-panel="${c.id}" role="tabpanel" hidden>
<p class="settings-panel-hint">Edit project name, LVGL version, display size, theme, and codegen output. Changes apply to the whole <code>.embf</code> file.</p>
<button type="button" class="tb-btn-small" id="btn-open-project-settings">Open in Properties panel</button>
</div>`;
        }
        if (c.id === "flow") {
            return `<div id="sidebar-panel-${c.id}" class="sidebar-panel-view sidebar-panel-view-flow" data-sidebar-panel="${c.id}" role="tabpanel" hidden>
<p class="flow-sidebar-hint">Open the <strong>Navigation flow</strong> diagram: click a page to edit its transitions, or use <strong>+ Add connection</strong> to link two pages (Visio-style).</p>
<button type="button" class="tb-btn-small" id="btn-open-flow-workspace" title="Open navigation flow in a workspace tab">Open flow diagram</button>
</div>`;
        }
        return `<div id="sidebar-panel-${c.id}" class="sidebar-panel-view" data-sidebar-panel="${c.id}" role="tabpanel" hidden></div>`;
    }).join("\n");
}
