// column_view_preset_builder.js
// Builds a compact preset selector for column visibility (field sets).
// Between server-side presets, localStorage hidden-columns, and the table view.
// Exists to let admins save, apply, and manage shared column visibility presets.
import { getHiddenColumns, applyColumnVisibility } from "./column_visibility_handler.js";
import { getTranslationForKey } from "../../lang/translation_handler.js";
import { showSuccessToast } from "../../../reusable_components/notifications/toast_notification_printer.js";
import { showConfirmModal, showInputModal } from "../../../reusable_components/modal/confirm_modal_builder.js";
import { createMultiselectDropdown } from "../../../reusable_components/multiselect_dropdown/multiselect_dropdown_builder.js";
import { hasRoutePermission } from "../../route_permission_checker.js";
import { buildFilterbarDisclosureSection } from "../filterbar_section_heading_builder.js";
import { findPresetById, findPresetByName, computeUIState, normalizePresetList } from "./column_view_preset_helpers.js";
import {
    deleteColumnViewPreset,
    listColumnViewPresets,
    saveColumnViewPreset,
} from "../../endpoints/stable_endpoint_router.js";

const t = (key, fallback) => getTranslationForKey(key) || fallback;

/**
 * Build the field-set preset selector row and its local menu interactions.
 * Between preset CRUD endpoints, local column-visibility storage, and filterbar UI.
 * Exists so filterbar callers can mount one reusable preset control with teardown.
 */
export function buildColumnViewPresetSelector(tableName, columns = []) {
    const listenerCleanups = [];
    let destroyed = false;
    function addManagedListener(target, type, handler, options) {
        target.addEventListener(type, handler, options);
        listenerCleanups.push(() => {
            target.removeEventListener(type, handler, options);
        });
    }
    const content = document.createElement("div");
    content.classList.add("column-preset-content");
    const row = buildFilterbarDisclosureSection({
        iconPath: "/frontend/icons/general/visible-fields-icon.svg",
        iconClassName: ["column-preset-heading-icon", "view-selector-heading-icon"],
        langKey: "field_sets",
        fallbackText: t("field_sets", "Näytettävät kentät"),
        contentElement: content,
        sectionElement: document.createElement("div"),
        sectionClassNames: ["column-preset-row"],
        startOpen: false,
    });
    row.dataset.testid = "column-view-preset-selector";
    row.dataset.filterbarSectionKey = "field_sets";
    const disclosureDestroy = row.destroy?.bind(row);

    // Dropdown
    const selectRow = document.createElement("div");
    selectRow.classList.add("column-preset-select-row");
    const select = document.createElement("select");
    select.classList.add("column-preset-select", "fw-btn");
    selectRow.appendChild(select);
    content.appendChild(selectRow);

    const fieldOptions = normalizeColumnOptions(columns);
    const fieldPickerWrapper = document.createElement("div");
    fieldPickerWrapper.classList.add("column-preset-field-picker");
    selectRow.appendChild(fieldPickerWrapper);

    let fieldPicker = null;
    if (fieldOptions.length > 0) {
        fieldPicker = createMultiselectDropdown({
            containerElement: fieldPickerWrapper,
            options: fieldOptions,
            placeholder: t("field_set_fields_placeholder", "Kentät kenttäjoukossa"),
            searchPlaceholder: t("search_fields", "Etsi kenttiä"),
            allowExclude: false,
            selectedCountLabel: t("fields_selected", "kenttää"),
            initialState: {
                includeValues: getVisibleFieldValues(getHiddenColumns(tableName)),
            },
            onChange: ({ includeValues }) => {
                commitFieldSelection(includeValues);
            },
        });
    } else {
        fieldPickerWrapper.hidden = true;
    }

    const actionsRow = document.createElement("div");
    actionsRow.classList.add("column-preset-actions");
    content.appendChild(actionsRow);

    // --- State 1: save new ---
    const saveNewBtn = document.createElement("button");
    saveNewBtn.classList.add("fw-btn", "column-preset-btn");
    saveNewBtn.dataset.langKey = "save_field_set";
    saveNewBtn.textContent = t("save_field_set", "Tallenna kenttäjoukko");
    saveNewBtn.title = saveNewBtn.textContent;
    actionsRow.appendChild(saveNewBtn);

    // --- State 2: update + clear + more-actions dropdown ---
    const updateBtn = document.createElement("button");
    updateBtn.classList.add("fw-btn", "column-preset-btn");
    updateBtn.dataset.langKey = "update_field_set";
    updateBtn.textContent = t("update_field_set", "Päivitä");
    actionsRow.appendChild(updateBtn);

    const clearBtn = document.createElement("button");
    clearBtn.classList.add("fw-btn", "column-preset-btn");
    clearBtn.dataset.langKey = "clear_selections";
    clearBtn.textContent = t("clear_selections", "Tyhjennä valinnat");
    actionsRow.appendChild(clearBtn);

    // More-actions dropdown wrapper
    const moreWrapper = document.createElement("div");
    moreWrapper.classList.add("column-preset-more-wrapper");

    const moreBtn = document.createElement("button");
    moreBtn.classList.add("fw-btn", "column-preset-btn");
    moreBtn.dataset.langKey = "more_actions";
    moreBtn.textContent = `${t("more_actions", "Lisää")} ▾`;
    moreWrapper.appendChild(moreBtn);

    const moreMenu = document.createElement("div");
    moreMenu.classList.add("column-preset-more-menu");
    moreMenu.hidden = true;

    function makeMenuItem(langKey, fallback) {
        const item = document.createElement("button");
        item.classList.add("fw-btn", "column-preset-more-item");
        item.dataset.langKey = langKey;
        item.textContent = t(langKey, fallback);
        moreMenu.appendChild(item);
        return item;
    }

    const saveAsItem = makeMenuItem("save_as_new_field_set", "Tallenna uutena");
    const deleteItem = makeMenuItem("delete_field_set", "Tuhoa kenttäjoukko lopullisesti");
    deleteItem.classList.add("column-preset-more-item--danger");

    moreWrapper.appendChild(moreMenu);
    actionsRow.appendChild(moreWrapper);

    // Close menu on outside click
    addManagedListener(document, "click", (e) => {
        if (!moreWrapper.contains(e.target)) {
            moreMenu.hidden = true;
        }
    });
    addManagedListener(moreBtn, "click", (e) => {
        e.stopPropagation();
        moreMenu.hidden = !moreMenu.hidden;
    });

    // ========== State management ==========
    let presets = [];
    let presetsLoaded = false;
    let presetsLoadPromise = null;

    function getSelectedPreset() {
        return findPresetById(presets, select.value);
    }

    function getVisibleFieldValues(hiddenColumns = getHiddenColumns(tableName)) {
        return fieldOptions
            .filter((option) => !hiddenColumns[option.value])
            .map((option) => option.value);
    }

    function syncFieldPickerFromHiddenColumns(hiddenColumns = getHiddenColumns(tableName)) {
        fieldPicker?.setValue({
            includeValues: getVisibleFieldValues(hiddenColumns),
            excludeValues: [],
        });
    }

    function commitFieldSelection(includeValues = []) {
        if (destroyed || fieldOptions.length === 0) return;
        const selected = new Set(includeValues.map((value) => String(value)));
        const hiddenColumns = { ...getHiddenColumns(tableName) };
        for (const option of fieldOptions) {
            if (selected.has(option.value)) {
                delete hiddenColumns[option.value];
            } else {
                hiddenColumns[option.value] = true;
            }
        }
        storeHiddenColumns(hiddenColumns);
        applyColumnVisibility(tableName);
        window.dispatchEvent(
            new CustomEvent("column_visibility_changed", { detail: { tableName } })
        );
    }

    function storeHiddenColumns(hiddenColumns = {}) {
        if (Object.keys(hiddenColumns).length === 0) {
            localStorage.removeItem(`${tableName}_hide_columns`);
            return;
        }
        localStorage.setItem(`${tableName}_hide_columns`, JSON.stringify(hiddenColumns));
    }

    function syncUI() {
        if (destroyed) return;
        const selected = getSelectedPreset();
        const ui = computeUIState(selected);
        // State 1
        saveNewBtn.style.display = ui.showSaveNew ? "" : "none";
        // State 2
        updateBtn.style.display = ui.showUpdate ? "" : "none";
        clearBtn.style.display = ui.showClear ? "" : "none";
        moreWrapper.style.display = ui.showMore ? "" : "none";
        updateBtn.disabled = ui.updateDisabled;
        deleteItem.disabled = ui.deleteDisabled;
        moreMenu.hidden = true;

        if (ui.updateTitle) {
            updateBtn.title = `${t("update_field_set", "Päivitä")}: ${ui.updateTitle}`;
        } else {
            updateBtn.title = t("select_field_set_first", "Valitse ensin kenttäjoukko");
        }
    }

    function renderSelect(keepValue) {
        if (destroyed) return;
        const prev = keepValue ?? select.value;
        select.innerHTML = "";
        const defaultOpt = document.createElement("option");
        defaultOpt.value = "";
        defaultOpt.textContent = `— ${t("select_field_set", "Valitse kenttäjoukko")} —`;
        select.appendChild(defaultOpt);
        for (const p of presets) {
            const opt = document.createElement("option");
            opt.value = String(p.id);
            opt.textContent = p.preset_name;
            select.appendChild(opt);
        }
        if (prev && presets.some((p) => String(p.id) === prev)) {
            select.value = prev;
        }
        syncUI();
    }

    async function loadPresets(keepValue) {
        if (destroyed) return;
        // Skip loading if user lacks permission for this admin-only route
        if (!hasRoutePermission('/api/column-view-presets/')) {
            presets = [];
            presetsLoaded = true;
            renderSelect(keepValue);
            return;
        }

        try {
            const data = await listColumnViewPresets(tableName);
            if (destroyed) return;
            presets = normalizePresetList(data);
        } catch {
            if (destroyed) return;
            presets = [];
        }
        presetsLoaded = true;
        renderSelect(keepValue);
    }

    function ensurePresetsLoaded(keepValue) {
        if (destroyed || presetsLoaded) {
            return Promise.resolve();
        }
        if (presetsLoadPromise) {
            return presetsLoadPromise;
        }

        presetsLoadPromise = loadPresets(keepValue).finally(() => {
            presetsLoadPromise = null;
        });
        return presetsLoadPromise;
    }

    async function doSave(presetName) {
        const hiddenColumns = getHiddenColumns(tableName);
        await saveColumnViewPreset({
            table_name: tableName,
            preset_name: presetName,
            hidden_columns: hiddenColumns,
        });
    }

    function selectPresetByName(name) {
        const match = findPresetByName(presets, name);
        if (match) {
            select.value = String(match.id);
            syncUI();
        }
    }

    // ========== Events ==========

    // Apply preset on dropdown change
    addManagedListener(select, "change", () => {
        syncUI();
        const preset = getSelectedPreset();
        if (!preset) return;

        localStorage.setItem(
            `${tableName}_hide_columns`,
            JSON.stringify(preset.hidden_columns || {})
        );
        syncFieldPickerFromHiddenColumns(preset.hidden_columns || {});
        applyColumnVisibility(tableName);
        window.dispatchEvent(
            new CustomEvent("column_visibility_changed", { detail: { tableName } })
        );
        showSuccessToast(
            `${t("field_set_applied", "Kenttäjoukko ladattu")}: ${preset.preset_name}`
        );
    });

    // State 1: save current fields as a new named set
    addManagedListener(saveNewBtn, "click", async () => {
        await ensurePresetsLoaded();
        await promptAndSaveNew();
    });

    // State 2: update current preset with current visibility
    addManagedListener(updateBtn, "click", async () => {
        await ensurePresetsLoaded(select.value);
        const selected = getSelectedPreset();
        if (!selected) return;
        try {
            await doSave(selected.preset_name);
            showSuccessToast(
                `${t("field_set_updated", "Kenttäjoukko päivitetty")}: ${selected.preset_name}`
            );
            await loadPresets(select.value);
        } catch (err) {
            console.warn("column_view_preset_builder: update failed", err);
        }
    });

    // State 2: clear selections → show all fields, deselect preset → State 1
    addManagedListener(clearBtn, "click", () => {
        localStorage.removeItem(`${tableName}_hide_columns`);
        syncFieldPickerFromHiddenColumns({});
        applyColumnVisibility(tableName);
        window.dispatchEvent(
            new CustomEvent("column_visibility_changed", { detail: { tableName } })
        );
        select.value = "";
        syncUI();
    });

    // More menu: save as new copy
    addManagedListener(saveAsItem, "click", () => {
        moreMenu.hidden = true;
        void ensurePresetsLoaded().then(() => promptAndSaveNew());
    });

    // More menu: delete permanently
    addManagedListener(deleteItem, "click", async () => {
        moreMenu.hidden = true;
        await ensurePresetsLoaded(select.value);
        const preset = getSelectedPreset();
        if (!preset) return;
        const confirmed = await showConfirmModal({
            titleLangKey: "confirm_delete",
            messageLangKey: "confirm_delete_field_set",
            messageText: `${preset.preset_name}?`,
        });
        if (!confirmed) return;
        try {
            await deleteColumnViewPreset({ id: preset.id });
            presets = presets.filter((candidate) => String(candidate.id) !== String(preset.id));
            renderSelect();
            showSuccessToast(t("field_set_deleted", "Kenttäjoukko poistettu"));
        } catch (err) {
            console.warn("column_view_preset_builder: delete failed", err);
        }
    });

    async function promptAndSaveNew() {
        const name = await showInputModal({
            titleLangKey: "save_field_set",
            titlePlainText: t("save_field_set", "Tallenna kenttäjoukko"),
            labelLangKey: "field_set_name_prompt",
            labelPlainText: t("field_set_name_prompt", "Anna kenttäjoukolle nimi:"),
            confirmLangKey: "save",
            confirmText: t("save", "Tallenna"),
            cancelLangKey: "cancel",
            cancelText: t("cancel", "Peruuta"),
        });
        if (!name || !name.trim()) return;
        const trimmed = name.trim();

        const existing = findPresetByName(presets, trimmed);
        if (existing) {
            const overwrite = await showConfirmModal({
                titleLangKey: "confirm_overwrite",
                messageLangKey: "confirm_overwrite_field_set",
                messageText: `"${existing.preset_name}" ${t("already_exists", "on jo olemassa")}. ${t("overwrite_question", "Korvataanko?")}`,
            });
            if (!overwrite) return;
        }

        try {
            await doSave(trimmed);
            showSuccessToast(t("field_set_saved", "Kenttäjoukko tallennettu"));
            await loadPresets();
            selectPresetByName(trimmed);
        } catch (err) {
            console.warn("column_view_preset_builder: save failed", err);
        }
    }

    const lazyLoadPresets = () => {
        void ensurePresetsLoaded(select.value);
    };
    addManagedListener(select, "focus", lazyLoadPresets);
    addManagedListener(select, "pointerdown", lazyLoadPresets);
    addManagedListener(row, "focusin", lazyLoadPresets);

    renderSelect("");

    row.destroy = () => {
        destroyed = true;
        fieldPicker?.destroy?.();
        listenerCleanups.forEach((cleanup) => cleanup());
        listenerCleanups.length = 0;
        disclosureDestroy?.();
    };
    return row;
}

function normalizeColumnOptions(columns = []) {
    return columns
        .map((column) => String(column || "").trim())
        .filter(Boolean)
        .map((column) => ({ value: column, label: column }));
}
