// article_language_editor.js
// Edits one metadata-authorized article field across its content languages.
// Bridges the existing updateRow API, locale merge helper, and article toolbar.
// Preserves unedited translations and failed drafts without exposing stored JSON.

import { endpoint_router } from "../../endpoints/endpoint_router.js";
import { hasDatasetPermission } from "../../route_permission_checker.js";
import { getTranslationForKey } from "../../lang/translation_handler.js";
import { loadPublicUiLanguageCatalog, getUiLanguageOptions } from "../../lang/ui_language_catalog.js";
import { getLanguageWithBrowserFallback } from "../../state_stores/lang_preference_reader.js";
import { readCachedUserPermissions, canEditServiceCatalogColumn } from "../../service_catalog/service_catalog_moderation.js";
import { fetchPermittedRowArticleData } from "../card_view/row_article_data_fetcher.js";
import { reconstructMultilingualValue } from "../card_view/card_field_formatter_helpers.js";

const LANGUAGE_CODE = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;
const copy = (key, fallback) => getTranslationForKey(key, { fallback });

export function readArticleLanguageValues(raw, language = getLanguageWithBrowserFallback()) {
    if (raw == null || raw === "") return {};
    if (typeof raw === "string" && !raw.trim().startsWith("{")) {
        return LANGUAGE_CODE.test(language) ? { [language]: raw } : null;
    }
    try {
        const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
        if (!Object.entries(parsed).every(([key, value]) => LANGUAGE_CODE.test(key)
            && (typeof value === "string" || value === null))) return null;
        return { ...parsed };
    } catch { return null; }
}

export function getArticleLanguageFields({ row, columns, dataTypes, tableName }) {
    if (row?.id == null) return [];
    const permissions = readCachedUserPermissions();
    return columns.filter((column) => {
        const metadata = dataTypes[column];
        return column !== "id" && Object.hasOwn(row, column)
            && metadata?.is_multilingual === true && metadata.editable_in_ui === true
            && !metadata.foreign_table
            && String(metadata.card_element || "").split(",").some((role) => (
                /^(header|description)(?:_?\d+)?$/.test(role.trim())
            ))
            && canEditServiceCatalogColumn(tableName, column, permissions)
            && readArticleLanguageValues(row[column]) !== null;
    });
}

export function mergeArticleLanguageDraft(original, changedValues) {
    let serialized = JSON.stringify(original);
    for (const [language, value] of Object.entries(changedValues)) {
        if (!LANGUAGE_CODE.test(language) || typeof value !== "string") throw new TypeError("Invalid language draft");
        serialized = reconstructMultilingualValue(serialized, language, value);
        if (serialized === null) throw new TypeError("Invalid language value");
    }
    return serialized;
}

export function resolveArticleEditorLanguages(values, options) {
    const choices = new Map();
    for (const option of options) {
        if (LANGUAGE_CODE.test(option?.value || "")) choices.set(option.value, option.label || option.value);
    }
    for (const code of Object.keys(values)) {
        if (!choices.has(code)) choices.set(code, code);
    }
    return Array.from(choices, ([code, label]) => ({ code, label }));
}

/** The server rechecks row and field rights on update; client controls fail closed. */
export function createArticleLanguageEditor({
    row, columns, dataTypes, tableName, canUpdateRow,
    onActiveChange = () => {}, onSaved = async () => {}, isCurrent = () => true,
}) {
    const fields = canUpdateRow ? getArticleLanguageFields({ row, columns, dataTypes, tableName }) : [];
    if (!fields.length) return null;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "fw-btn article-language-editor-open";
    button.dataset.langKey = "article_edit_languages";
    button.textContent = copy("article_edit_languages", "Edit language versions");
    const panel = document.createElement("section");
    panel.className = "article-language-editor";
    panel.hidden = true;
    panel.setAttribute("aria-label", button.textContent);
    const fieldLabel = document.createElement("label");
    fieldLabel.textContent = copy("article_language_field", "Field");
    const select = document.createElement("select");
    select.setAttribute("aria-label", fieldLabel.textContent);
    for (const field of fields) {
        const option = document.createElement("option");
        option.value = field;
        option.textContent = copy(field, field.replaceAll("_", " "));
        select.append(option);
    }
    fieldLabel.append(select);
    const help = document.createElement("p");
    help.textContent = copy("article_language_help", "Edit one field across languages. Drag the lower edge of a text area to resize it. Other languages are preserved.");
    const grid = document.createElement("div");
    grid.className = "article-language-editor-grid";
    const status = document.createElement("p");
    status.className = "article-language-editor-status";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    const actions = document.createElement("div");
    actions.className = "article-language-editor-actions";
    const save = document.createElement("button");
    save.type = "button";
    save.className = "fw-btn fw-btn--primary";
    save.dataset.langKey = "save";
    save.textContent = copy("save", "Save");
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "fw-btn fw-btn--ghost";
    cancel.dataset.langKey = "cancel";
    cancel.textContent = copy("cancel", "Cancel");
    actions.append(save, cancel);
    panel.append(fieldLabel, help, grid, status, actions);

    let values = {};
    let originalRaw;
    let busy = false;
    let disabled = false;
    let opened = false;
    let loadFailed = false;
    const inputs = new Map();
    const changed = () => Object.fromEntries(Array.from(inputs)
        .filter(([code, textarea]) => textarea.value !== String(values[code] ?? ""))
        .map(([code, textarea]) => [code, textarea.value]));
    const sync = () => {
        const dirty = Object.keys(changed()).length > 0;
        select.disabled = busy || dirty || loadFailed;
        fieldLabel.hidden = loadFailed;
        help.hidden = loadFailed;
        grid.hidden = loadFailed;
        save.hidden = loadFailed;
        save.disabled = busy || !dirty;
        cancel.disabled = busy;
        for (const textarea of inputs.values()) textarea.disabled = busy;
        button.disabled = disabled || busy || opened;
    };
    const close = () => {
        opened = false;
        panel.hidden = true;
        grid.replaceChildren();
        inputs.clear();
        status.textContent = "";
        onActiveChange(false);
        sync();
        button.focus();
    };
    const renderField = () => {
        loadFailed = false;
        originalRaw = row[select.value];
        values = readArticleLanguageValues(originalRaw);
        grid.replaceChildren();
        inputs.clear();
        status.textContent = "";
        for (const { code, label } of resolveArticleEditorLanguages(values, getUiLanguageOptions())) {
            const wrapper = document.createElement("label");
            wrapper.textContent = label;
            const textarea = document.createElement("textarea");
            textarea.rows = 8;
            textarea.lang = code;
            textarea.dataset.language = code;
            textarea.setAttribute("aria-label", label);
            textarea.value = values[code] ?? "";
            textarea.addEventListener("input", sync);
            wrapper.append(textarea);
            grid.append(wrapper);
            inputs.set(code, textarea);
        }
        sync();
    };
    button.addEventListener("click", async () => {
        if (disabled || busy || opened || !isCurrent()) return;
        busy = true;
        sync();
        try {
            await loadPublicUiLanguageCatalog();
            const fresh = await fetchPermittedRowArticleData({ tableName, rowItem: row });
            if (!isCurrent() || disabled) return;
            const selectedField = select.value;
            select.replaceChildren();
            for (const field of fields) {
                if (!Object.hasOwn(fresh, field) || readArticleLanguageValues(fresh[field]) === null) continue;
                row[field] = fresh[field];
                const option = document.createElement("option");
                option.value = field;
                option.textContent = copy(field, field.replaceAll("_", " "));
                select.append(option);
            }
            if (!select.options.length) throw new Error("Field unavailable");
            if (Array.from(select.options).some((option) => option.value === selectedField)) select.value = selectedField;
        } catch {
            if (!isCurrent()) return;
            loadFailed = true;
            panel.hidden = false;
            status.textContent = copy("article_language_load_failed", "The field could not be loaded. Try again.");
            return;
        } finally { busy = false; sync(); }
        if (!isCurrent() || disabled) { sync(); return; }
        opened = true;
        panel.hidden = false;
        renderField();
        onActiveChange(true);
        inputs.values().next().value?.focus();
    });
    select.addEventListener("change", renderField);
    cancel.addEventListener("click", () => { if (!busy) close(); });
    save.addEventListener("click", async () => {
        const draft = changed();
        if (busy || !opened || !Object.keys(draft).length || !isCurrent()) return;
        busy = true;
        status.textContent = "";
        sync();
        let saved = false;
        try {
            if (!await hasDatasetPermission("/api/update-row", tableName)
                || !getArticleLanguageFields({ row, columns, dataTypes, tableName }).includes(select.value)
                || !isCurrent()) throw new Error("Edit access changed");
            // Refuse stale local state instead of overwriting a same-window edit.
            if (row[select.value] !== originalRaw) throw new Error("Field changed");
            const column = select.value;
            const fresh = await fetchPermittedRowArticleData({ tableName, rowItem: row });
            const latest = Object.hasOwn(fresh, column) ? readArticleLanguageValues(fresh[column]) : null;
            if (!latest || !isCurrent()) throw new Error("Field unavailable");
            for (const language of Object.keys(draft)) {
                if (latest[language] !== values[language]) throw new Error("Translation changed");
            }
            const value = mergeArticleLanguageDraft(latest, draft);
            await endpoint_router("updateRow", {
                method: "POST",
                url_params: "?dataset=" + encodeURIComponent(tableName),
                body_data: { id: row.id, column, value },
            });
            row[column] = value;
            saved = true;
            close();
            await onSaved(column, value);
        } catch {
            if (!saved) {
                status.textContent = copy("article_language_save_failed", "Saving failed. Your changes are still here; retry or cancel.");
            }
        } finally {
            busy = false;
            sync();
        }
    });
    return { button, panel, setDisabled(value) { disabled = Boolean(value); sync(); } };
}
