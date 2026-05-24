import type { ComponentType } from "./types/embf";
import { WIDGET_PALETTE_ORDER } from "./embfPalette";

/** 20×20 monochrome icons for the preview widget palette (currentColor). */
const ICONS: Record<ComponentType, string> = {
    label: `<svg viewBox="0 0 20 20" aria-hidden="true"><text x="3" y="14" font-size="11" font-family="sans-serif" fill="currentColor">A</text></svg>`,
    button: `<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="3" y="6" width="14" height="8" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>`,
    slider: `<svg viewBox="0 0 20 20" aria-hidden="true"><line x1="3" y1="10" x2="17" y2="10" stroke="currentColor" stroke-width="1.5"/><circle cx="12" cy="10" r="3" fill="currentColor"/></svg>`,
    switch: `<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="3" y="7" width="14" height="6" rx="3" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="13" cy="10" r="2.5" fill="currentColor"/></svg>`,
    bar: `<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="3" y="8" width="14" height="4" rx="1" fill="none" stroke="currentColor" stroke-width="1.2"/><rect x="3" y="8" width="9" height="4" rx="1" fill="currentColor"/></svg>`,
    arc: `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4a6 6 0 0 1 4 10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`,
    checkbox: `<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="4" y="4" width="12" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M6 10l3 3 5-6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`,
    dropdown: `<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="3" y="5" width="14" height="10" rx="1" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 9l2 2 2-2" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>`,
    roller: `<svg viewBox="0 0 20 20" aria-hidden="true"><line x1="5" y1="6" x2="15" y2="6" stroke="currentColor" stroke-width="1.2"/><line x1="5" y1="10" x2="15" y2="10" stroke="currentColor" stroke-width="2"/><line x1="5" y1="14" x2="15" y2="14" stroke="currentColor" stroke-width="1.2"/></svg>`,
    textarea: `<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="3" y="4" width="14" height="12" rx="1" fill="none" stroke="currentColor" stroke-width="1.5"/><line x1="5" y1="8" x2="15" y2="8" stroke="currentColor" stroke-width="1"/><line x1="5" y1="11" x2="12" y2="11" stroke="currentColor" stroke-width="1"/></svg>`,
    line: `<svg viewBox="0 0 20 20" aria-hidden="true"><line x1="4" y1="14" x2="16" y2="6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`,
    image: `<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="3" y="5" width="14" height="10" rx="1" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M3 13l4-3 3 2 4-4 3 3" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>`,
    container: `<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="4" y="5" width="12" height="10" rx="1" fill="none" stroke="currentColor" stroke-width="1.2" stroke-dasharray="2 2"/></svg>`,
    panel: `<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="3" y="4" width="14" height="12" rx="1" fill="none" stroke="currentColor" stroke-width="1.5"/><line x1="3" y1="8" x2="17" y2="8" stroke="currentColor" stroke-width="1"/></svg>`,
    spinner: `<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="14 20" stroke-linecap="round"/></svg>`
};

export function widgetPaletteIconSvg(type: ComponentType): string {
    return ICONS[type];
}

const LIBRARY_GROUP_ICON = `<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="4" y="5" width="12" height="10" rx="1" fill="none" stroke="currentColor" stroke-width="1.2" stroke-dasharray="2 2"/><rect x="7" y="8" width="6" height="4" rx="0.5" fill="currentColor" opacity="0.35"/></svg>`;

/** HTML for the vertical widget palette sidebar. */
export function buildWidgetPaletteHtml(): string {
    return WIDGET_PALETTE_ORDER.map(
        w =>
            `<button type="button" class="palette-item" draggable="true" data-widget="${w}" title="${w} (drag onto canvas)" aria-label="Add ${w}">` +
            widgetPaletteIconSvg(w) +
            `</button>`
    ).join("\n");
}

/** Standard palette + empty My components list (filled by webview on load). */
export function buildComponentsSidebarHtml(): string {
    return (
        `<input type="search" id="palette-search" class="palette-search" placeholder="Search widgets…" autocomplete="off" spellcheck="false" />` +
        `<div id="palette-standard" class="palette-standard">` +
        buildWidgetPaletteHtml() +
        `</div>` +
        `<div class="palette-section-label" id="library-palette-label">My components</div>` +
        `<div id="library-palette-list" class="library-palette-list" aria-label="Custom components"></div>`
    );
}

export function libraryPaletteButtonHtml(entryId: string, displayName: string, sizeLabel: string): string {
    const title = `${displayName} (${sizeLabel})`;
    return (
        `<button type="button" class="palette-item palette-item-library" data-library="${entryId}" ` +
        `title="${title}" aria-label="Insert ${displayName}">` +
        LIBRARY_GROUP_ICON +
        `<span class="palette-library-label">${displayName}</span>` +
        `</button>`
    );
}
