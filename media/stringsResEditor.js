/* global acquireVsCodeApi */
const vscode = acquireVsCodeApi();

/** @type {import("../src/i18n/stringsResParser").StringsResFile | null} */
let doc = null;
/** @type {string | null} */
let selectedKey = null;
/** @type {string | null} */
let selectedLocale = null;
let dirty = false;

const KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const LOCALE_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/;

const grid = document.getElementById("grid");
const thead = grid.querySelector("thead");
const tbody = grid.querySelector("tbody");
const errorEl = document.getElementById("error");
const statusEl = document.getElementById("status");
const defaultLocaleSel = document.getElementById("default-locale");
const btnAddKey = document.getElementById("btn-add-key");
const btnAddLocale = document.getElementById("btn-add-locale");
const btnRemoveKey = document.getElementById("btn-remove-key");
const btnRemoveLocale = document.getElementById("btn-remove-locale");
const btnSave = document.getElementById("btn-save");

function setStatus(text) {
    statusEl.textContent = text;
}

function setError(message) {
    if (message) {
        errorEl.hidden = false;
        errorEl.textContent = message;
    } else {
        errorEl.hidden = true;
        errorEl.textContent = "";
    }
}

function allKeys(data) {
    const keys = new Set();
    for (const table of Object.values(data.locales)) {
        for (const k of Object.keys(table)) {
            keys.add(k);
        }
    }
    return [...keys].sort();
}

function localeIds(data) {
    return Object.keys(data.locales).sort();
}

function ensureKey(data, key) {
    for (const loc of Object.keys(data.locales)) {
        if (!Object.prototype.hasOwnProperty.call(data.locales[loc], key)) {
            data.locales[loc][key] = "";
        }
    }
}

/** @returns {Map<string, string>} rendered locale id → current input value */
function collectLocaleRenames() {
    /** @type {Map<string, string>} */
    const renames = new Map();
    thead.querySelectorAll("th[data-locale]").forEach(th => {
        const oldId = th.getAttribute("data-locale") ?? "";
        const input = th.querySelector("[data-locale-input]");
        const newId = input instanceof HTMLInputElement ? input.value.trim() : oldId;
        if (oldId && newId) {
            renames.set(oldId, newId);
        }
    });
    return renames;
}

function render() {
    if (!doc) {
        thead.innerHTML = "";
        tbody.innerHTML = "";
        return;
    }

    const locales = localeIds(doc);
    const keys = allKeys(doc);

    defaultLocaleSel.innerHTML = locales
        .map(
            loc =>
                `<option value="${esc(loc)}"${loc === doc.defaultLocale ? " selected" : ""}>${esc(loc)}</option>`
        )
        .join("");

    thead.innerHTML =
        `<tr><th class="key-col">Key</th>` +
        locales
            .map(loc => {
                const isDefault = loc === doc.defaultLocale;
                const isSelected = loc === selectedLocale;
                const locInvalid = !LOCALE_PATTERN.test(loc) ? " invalid" : "";
                return (
                    `<th class="locale-col${isDefault ? " default-locale" : ""}${isSelected ? " selected-locale" : ""}" data-locale="${esc(loc)}">` +
                    `<input type="text" data-locale-input="1" value="${esc(loc)}" class="${locInvalid.trim()}" title="Locale id (e.g. en, fa, pt-BR)" />` +
                    `</th>`
                );
            })
            .join("") +
        `</tr>`;

    tbody.innerHTML = keys
        .map(key => {
            const sel = key === selectedKey ? " selected" : "";
            const keyInvalid = !KEY_PATTERN.test(key) ? " invalid" : "";
            const cells = locales
                .map(loc => {
                    const val = doc.locales[loc][key] ?? "";
                    return `<td data-locale="${esc(loc)}"><textarea rows="1" data-cell="1">${esc(val)}</textarea></td>`;
                })
                .join("");
            return (
                `<tr data-key="${esc(key)}" class="${sel.trim()}">` +
                `<td class="key-col"><input type="text" data-key-input="1" value="${esc(key)}" class="${keyInvalid.trim()}" /></td>` +
                cells +
                `</tr>`
            );
        })
        .join("");

    btnRemoveKey.disabled = !selectedKey;
    btnRemoveLocale.disabled = !selectedLocale || locales.length <= 1;
    setStatus(dirty ? "Unsaved changes" : "");
}

function esc(s) {
    return String(s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/"/g, "&quot;");
}

function markDirty() {
    dirty = true;
    setStatus("Unsaved changes");
}

function collectFromDom() {
    if (!doc) {
        return null;
    }

    const localeRenames = collectLocaleRenames();

    /** @type {Record<string, Record<string, string>>} */
    const locales = {};
    for (const newId of localeRenames.values()) {
        if (newId && !locales[newId]) {
            locales[newId] = {};
        }
    }

    tbody.querySelectorAll("tr[data-key]").forEach(row => {
        const keyInput = row.querySelector("[data-key-input]");
        const oldKey = row.getAttribute("data-key") ?? "";
        const newKey = keyInput instanceof HTMLInputElement ? keyInput.value.trim() : oldKey;
        if (!newKey) {
            return;
        }
        row.querySelectorAll("td[data-locale]").forEach(cell => {
            const oldLoc = cell.getAttribute("data-locale");
            const ta = cell.querySelector("textarea");
            if (!oldLoc || !(ta instanceof HTMLTextAreaElement)) {
                return;
            }
            const newLoc = localeRenames.get(oldLoc) ?? oldLoc;
            if (!newLoc) {
                return;
            }
            if (!locales[newLoc]) {
                locales[newLoc] = {};
            }
            locales[newLoc][newKey] = ta.value;
        });
    });

    let defaultLocale = doc.defaultLocale;
    const defaultTh = thead.querySelector("th.default-locale");
    if (defaultTh) {
        const oldDefault = defaultTh.getAttribute("data-locale") ?? "";
        const input = defaultTh.querySelector("[data-locale-input]");
        if (input instanceof HTMLInputElement && input.value.trim()) {
            defaultLocale = input.value.trim();
        } else if (localeRenames.has(oldDefault)) {
            defaultLocale = localeRenames.get(oldDefault) ?? defaultLocale;
        }
    } else if (localeRenames.has(defaultLocale)) {
        defaultLocale = localeRenames.get(defaultLocale) ?? defaultLocale;
    }

    if (selectedLocale && localeRenames.has(selectedLocale)) {
        selectedLocale = localeRenames.get(selectedLocale) ?? selectedLocale;
    }

    return { defaultLocale, locales };
}

function syncDocFromDom() {
    const next = collectFromDom();
    if (next) {
        doc = next;
    }
}

function save() {
    syncDocFromDom();
    if (!doc) {
        return;
    }
    const locIds = Object.keys(doc.locales);
    if (new Set(locIds).size !== locIds.length) {
        setError("Duplicate locale ids — each column must have a unique name");
        return;
    }
    for (const loc of locIds) {
        if (!LOCALE_PATTERN.test(loc)) {
            setError(
                `Invalid locale "${loc}" — start with a letter; use letters, digits, underscore, or hyphen`
            );
            return;
        }
    }
    if (!doc.locales[doc.defaultLocale]) {
        setError(`Default locale "${doc.defaultLocale}" is missing from locales`);
        return;
    }
    for (const key of allKeys(doc)) {
        if (!KEY_PATTERN.test(key)) {
            setError(`Invalid key "${key}" — use letters, digits, underscore; must start with letter or _`);
            return;
        }
    }
    setError("");
    vscode.postMessage({ type: "save", data: doc });
    dirty = false;
    setStatus("Saved");
}

btnAddKey.addEventListener("click", () => {
    if (!doc) {
        return;
    }
    syncDocFromDom();
    let n = 1;
    let key = "string_key";
    const keys = new Set(allKeys(doc));
    while (keys.has(key)) {
        key = `string_key_${n++}`;
    }
    ensureKey(doc, key);
    selectedKey = key;
    dirty = true;
    render();
});

btnAddLocale.addEventListener("click", () => {
    if (!doc) {
        return;
    }
    syncDocFromDom();
    let n = 1;
    let loc = "locale";
    while (doc.locales[loc]) {
        loc = `locale_${n++}`;
    }
    doc.locales[loc] = {};
    for (const key of allKeys(doc)) {
        doc.locales[loc][key] = "";
    }
    selectedLocale = loc;
    dirty = true;
    render();
});

btnRemoveKey.addEventListener("click", () => {
    if (!doc || !selectedKey) {
        return;
    }
    syncDocFromDom();
    for (const loc of Object.keys(doc.locales)) {
        delete doc.locales[loc][selectedKey];
    }
    selectedKey = null;
    dirty = true;
    render();
});

btnRemoveLocale.addEventListener("click", () => {
    if (!doc || !selectedLocale) {
        return;
    }
    syncDocFromDom();
    const locales = localeIds(doc);
    if (locales.length <= 1) {
        return;
    }
    delete doc.locales[selectedLocale];
    if (doc.defaultLocale === selectedLocale) {
        doc.defaultLocale = Object.keys(doc.locales)[0];
    }
    selectedLocale = null;
    dirty = true;
    render();
});

defaultLocaleSel.addEventListener("change", () => {
    if (!doc) {
        return;
    }
    syncDocFromDom();
    doc.defaultLocale = defaultLocaleSel.value;
    dirty = true;
    render();
});

btnSave.addEventListener("click", save);

function selectLocaleColumn(th) {
    if (!th) {
        return;
    }
    selectedLocale = th.getAttribute("data-locale");
    thead.querySelectorAll("th.selected-locale").forEach(el => el.classList.remove("selected-locale"));
    th.classList.add("selected-locale");
    btnRemoveLocale.disabled =
        !selectedLocale || localeIds(doc ?? { locales: {} }).length <= 1;
}

tbody.addEventListener("click", e => {
    const row = e.target.closest("tr[data-key]");
    if (row) {
        selectedKey = row.getAttribute("data-key");
        tbody.querySelectorAll("tr.selected").forEach(r => r.classList.remove("selected"));
        row.classList.add("selected");
        btnRemoveKey.disabled = false;
    }
});

thead.addEventListener("click", e => {
    if (e.target.matches("[data-locale-input]")) {
        selectLocaleColumn(e.target.closest("th[data-locale]"));
        return;
    }
    selectLocaleColumn(e.target.closest("th[data-locale]"));
});

grid.addEventListener("input", e => {
    if (e.target.matches("[data-key-input], [data-cell], [data-locale-input]")) {
        markDirty();
    }
    if (e.target.matches("[data-key-input]")) {
        e.target.classList.toggle("invalid", !KEY_PATTERN.test(e.target.value.trim()));
    }
    if (e.target.matches("[data-locale-input]")) {
        e.target.classList.toggle("invalid", !LOCALE_PATTERN.test(e.target.value.trim()));
    }
});

window.addEventListener("message", ev => {
    const msg = ev.data;
    if (msg.type === "update") {
        doc = msg.data;
        dirty = false;
        setError("");
        render();
    } else if (msg.type === "error") {
        setError(msg.message ?? "Parse error");
    }
});

vscode.postMessage({ type: "ready" });
