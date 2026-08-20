// symbol_registry_view.js
// Renders the administrator tool for assigning safe filesystem SVG symbols.
// Bridges the symbols API with dataset and field metadata selectors and previews.
// Exists so icon keys can be managed without source edits or raw SVG database input.

import {
    fetchAdminSymbols,
    saveAdminSymbolAssignment,
} from "../endpoints/stable_endpoint_router.js";
import { createSymbolMaskElement } from "../../reusable_components/symbol_asset_resolver.js";
import {
    showErrorToast,
    showSuccessToast,
} from "../../reusable_components/notifications/toast_notification_printer.js";

function appendTranslatedHeading(parent, tagName, langKey, fallback) {
    const heading = document.createElement(tagName);
    heading.dataset.langKey = langKey;
    heading.textContent = fallback;
    parent.appendChild(heading);
    return heading;
}

function createLabeledSelect(id, langKey, fallback) {
    const wrapper = document.createElement("label");
    wrapper.className = "symbol-registry-field";
    const text = document.createElement("span");
    text.dataset.langKey = langKey;
    text.textContent = fallback;
    const select = document.createElement("select");
    select.id = id;
    select.className = "fw-form-control";
    wrapper.append(text, select);
    return { wrapper, select };
}

function replaceOptions(select, entries, getValue, getLabel, placeholder) {
    select.replaceChildren();
    const emptyOption = document.createElement("option");
    emptyOption.value = "";
    emptyOption.textContent = placeholder;
    select.appendChild(emptyOption);
    entries.forEach((entry) => {
        const option = document.createElement("option");
        option.value = String(getValue(entry));
        option.textContent = getLabel(entry);
        select.appendChild(option);
    });
}

export async function generate_symbol_registry_view(container) {
    if (!container) return;
    container.replaceChildren();

    const root = document.createElement("div");
    root.className = "symbol-registry-view fw-container fw-flex fw-flex-col fw-gap-4";
    const intro = document.createElement("section");
    intro.className = "fw-card fw-flex fw-flex-col fw-gap-2";
    appendTranslatedHeading(intro, "h2", "symbols", "Symbols");
    const description = document.createElement("p");
    description.dataset.langKey = "symbols_description";
    description.textContent = "Assign reviewed SVG files to dataset tabs and card fields. The database stores only the symbol key.";
    intro.appendChild(description);
    root.appendChild(intro);

    const editor = document.createElement("section");
    editor.className = "symbol-registry-editor fw-card fw-grid";
    const targetType = createLabeledSelect("symbol_registry_target_type", "symbol_target_type", "Target type");
    [
        ["dataset", "symbol_target_dataset", "Dataset"],
        ["field", "symbol_target_field", "Field"],
    ].forEach(([value, langKey, fallback]) => {
        const option = document.createElement("option");
        option.value = value;
        option.dataset.langKey = langKey;
        option.textContent = fallback;
        targetType.select.appendChild(option);
    });
    const datasetTarget = createLabeledSelect("symbol_registry_dataset", "dataset", "Dataset");
    const fieldTarget = createLabeledSelect("symbol_registry_field", "field", "Field");
    editor.append(targetType.wrapper, datasetTarget.wrapper, fieldTarget.wrapper);

    const currentRow = document.createElement("div");
    currentRow.className = "symbol-registry-current";
    const currentLabel = document.createElement("strong");
    currentLabel.dataset.langKey = "current_symbol";
    currentLabel.textContent = "Current symbol";
    const currentPreview = document.createElement("span");
    currentPreview.className = "symbol-registry-current-preview";
    const currentKey = document.createElement("code");
    currentRow.append(currentLabel, currentPreview, currentKey);
    editor.appendChild(currentRow);

    const actions = document.createElement("div");
    actions.className = "symbol-registry-actions fw-flex fw-gap-2 fw-wrap";
    const saveButton = document.createElement("button");
    saveButton.type = "button";
    saveButton.className = "fw-btn fw-btn--primary";
    saveButton.dataset.langKey = "save_symbol_assignment";
    saveButton.textContent = "Save symbol";
    const clearButton = document.createElement("button");
    clearButton.type = "button";
    clearButton.className = "fw-btn fw-btn--secondary";
    clearButton.dataset.langKey = "clear_symbol_assignment";
    clearButton.textContent = "Clear symbol";
    actions.append(saveButton, clearButton);
    editor.appendChild(actions);
    root.appendChild(editor);

    const library = document.createElement("section");
    library.className = "fw-card fw-flex fw-flex-col fw-gap-3";
    appendTranslatedHeading(library, "h3", "symbol_library", "Symbol library");
    const symbolGrid = document.createElement("div");
    symbolGrid.className = "symbol-registry-grid";
    library.appendChild(symbolGrid);
    root.appendChild(library);
    container.appendChild(root);

    let snapshot;
    let selectedIconKey = "";
    try {
        snapshot = await fetchAdminSymbols();
    } catch (error) {
        showErrorToast(error?.message || "Loading symbols failed");
        return;
    }
    const datasets = Array.isArray(snapshot?.datasets) ? snapshot.datasets : [];
    const fields = Array.isArray(snapshot?.fields) ? snapshot.fields : [];
    const symbols = Array.isArray(snapshot?.symbols) ? snapshot.symbols : [];

    replaceOptions(
        datasetTarget.select,
        datasets,
        (entry) => entry.table_uid,
        (entry) => entry.display_name || entry.dataset_name,
        "Select dataset…"
    );

    function selectedTarget() {
        const type = targetType.select.value;
        const uid = Number(type === "dataset" ? datasetTarget.select.value : fieldTarget.select.value);
        const entries = type === "dataset" ? datasets : fields;
        const uidKey = type === "dataset" ? "table_uid" : "column_uid";
        return { type, uid, entry: entries.find((item) => Number(item[uidKey]) === uid) || null };
    }

    function updateFieldOptions() {
        const datasetUID = Number(datasetTarget.select.value);
        const matchingFields = fields.filter((entry) => Number(entry.table_uid) === datasetUID);
        replaceOptions(
            fieldTarget.select,
            matchingFields,
            (entry) => entry.column_uid,
            (entry) => entry.column_name,
            "Select field…"
        );
    }

    function syncTargetMode() {
        const isField = targetType.select.value === "field";
        fieldTarget.wrapper.hidden = !isField;
        updateFieldOptions();
        syncCurrentAssignment();
    }

    function syncCurrentAssignment() {
        const { entry } = selectedTarget();
        const key = String(entry?.icon_key || "");
        currentPreview.replaceChildren();
        if (key) currentPreview.appendChild(createSymbolMaskElement(key, "symbol-registry-preview-icon"));
        currentKey.textContent = key || "—";
        selectedIconKey = key;
        for (const button of symbolGrid.querySelectorAll("button")) {
            button.classList.toggle("is-selected", button.dataset.symbolKey === selectedIconKey);
        }
    }

    symbols.forEach((symbol) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "symbol-registry-option";
        button.dataset.symbolKey = symbol.key;
        button.appendChild(createSymbolMaskElement(symbol.key, "symbol-registry-option-icon"));
        const label = document.createElement("span");
        label.textContent = symbol.key;
        button.appendChild(label);
        button.addEventListener("click", () => {
            selectedIconKey = symbol.key;
            for (const option of symbolGrid.querySelectorAll("button")) {
                option.classList.toggle("is-selected", option === button);
            }
        });
        symbolGrid.appendChild(button);
    });

    async function persist(iconKey) {
        const target = selectedTarget();
        if (!target.entry || !target.uid) {
            showErrorToast("Select a dataset or field first");
            return;
        }
        saveButton.disabled = true;
        clearButton.disabled = true;
        try {
            await saveAdminSymbolAssignment({
                target_type: target.type,
                target_uid: target.uid,
                icon_key: iconKey,
            });
            target.entry.icon_key = iconKey;
            selectedIconKey = iconKey;
            syncCurrentAssignment();
            showSuccessToast("Symbol assignment saved");
        } catch (error) {
            showErrorToast(error?.message || "Saving symbol failed");
        } finally {
            saveButton.disabled = false;
            clearButton.disabled = false;
        }
    }

    targetType.select.addEventListener("change", syncTargetMode);
    datasetTarget.select.addEventListener("change", () => {
        updateFieldOptions();
        syncCurrentAssignment();
    });
    fieldTarget.select.addEventListener("change", syncCurrentAssignment);
    saveButton.addEventListener("click", () => void persist(selectedIconKey));
    clearButton.addEventListener("click", () => void persist(""));

    if (datasets[0]) datasetTarget.select.value = String(datasets[0].table_uid);
    updateFieldOptions();
    syncTargetMode();
}
