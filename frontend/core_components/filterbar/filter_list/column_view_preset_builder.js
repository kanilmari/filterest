// column_view_preset_builder.js
// Builds the per-view field-collection controls inside Select visible fields.
// Bridges reusable personal/shared collections, site inheritance, and local visual updates.
// Exists so users choose their own fields while administrators can explicitly edit site defaults.
import {
    applyColumnVisibility,
    getColumnVisibilityStorageKey,
    getHiddenColumns,
} from "./column_visibility_handler.js";
import { getTranslationForKey } from "../../lang/translation_handler.js";
import { showSuccessToast } from "../../../reusable_components/notifications/toast_notification_printer.js";
import { showConfirmModal, showInputModal } from "../../../reusable_components/modal/confirm_modal_builder.js";
import { createMultiselectDropdown } from "../../../reusable_components/multiselect_dropdown/multiselect_dropdown_builder.js";
import { buildFilterbarDisclosureSection } from "../filterbar_section_heading_builder.js";
import {
    assignPersonalViewFieldSet,
    assignSiteViewFieldSet,
    deletePersonalViewFieldSet,
    deleteSharedViewFieldSet,
    getViewFieldSets,
    resetPersonalViewFieldSet,
    savePersonalViewFieldSet,
    saveSiteViewFieldSet,
} from "../../endpoints/stable_endpoint_router.js";

const t = (key, fallback) => getTranslationForKey(key) || fallback;

export function buildColumnViewPresetSelector(tableName, columns = [], requestedViewKey = "table") {
    const normalizedViewKey = String(requestedViewKey || "").trim().toLowerCase();
    const viewKey = /^[a-z][a-z0-9_]{0,63}$/.test(normalizedViewKey)
        ? normalizedViewKey
        : "table";
    const listenerCleanups = [];
    let destroyed = false;
    let editingSiteDefault = false;
    let fieldSets = [];
    let activeFieldSetID = null;
    let personalFieldSetID = null;
    let siteDefaultFieldSetID = null;
    let canEditPersonal = false;
    let canEditSiteDefault = false;
    let serverCollectionsAvailable = false;
    let picker = null;

    const addListener = (target, type, handler) => {
        target.addEventListener(type, handler);
        listenerCleanups.push(() => target.removeEventListener(type, handler));
    };

    const content = document.createElement("div");
    content.classList.add("column-preset-content");
    const row = buildFilterbarDisclosureSection({
        iconPath: "/frontend/icons/general/visible-fields-icon.svg",
        iconClassName: ["column-preset-heading-icon", "view-selector-heading-icon"],
        langKey: "filterbar_select_visible_fields",
        fallbackText: t("filterbar_select_visible_fields", "Select visible fields"),
        contentElement: content,
        sectionElement: document.createElement("div"),
        sectionClassNames: ["column-preset-row"],
        startOpen: false,
    });
    row.dataset.testid = "column-view-preset-selector";
    row.dataset.filterbarSectionKey = "field_sets";
    row.dataset.viewKey = viewKey;
    const disclosureDestroy = row.destroy?.bind(row);

    const modeButton = document.createElement("button");
    modeButton.type = "button";
    modeButton.classList.add("fw-btn", "column-preset-btn");
    modeButton.dataset.testid = "field-set-site-default-mode";
    modeButton.hidden = true;
    content.appendChild(modeButton);

    const selectRow = document.createElement("div");
    selectRow.classList.add("column-preset-select-row");
    const select = document.createElement("select");
    select.classList.add("column-preset-select", "fw-btn");
    selectRow.appendChild(select);
    content.appendChild(selectRow);

    let fieldOptions = normalizeColumnOptions(columns);
    const pickerWrapper = document.createElement("div");
    pickerWrapper.classList.add("column-preset-field-picker");
    selectRow.appendChild(pickerWrapper);
    mountPicker(columns);

    const actions = document.createElement("div");
    actions.classList.add("column-preset-actions");
    content.appendChild(actions);

    const saveButton = makeButton("save_field_set", "Tallenna kenttäjoukko");
    const updateButton = makeButton("update_field_set", "Päivitä");
    const resetButton = makeButton("return_to_site_default", "Palaa sivuston oletukseen");
    resetButton.dataset.testid = "field-set-reset-inheritance";
    const deleteButton = makeButton("delete_field_set", "Poista kenttäjoukko");
    deleteButton.classList.add("column-preset-more-item--danger");
    actions.append(saveButton, updateButton, resetButton, deleteButton);

    function makeButton(langKey, fallback) {
        const button = document.createElement("button");
        button.type = "button";
        button.classList.add("fw-btn", "column-preset-btn");
        button.dataset.langKey = langKey;
        button.textContent = t(langKey, fallback);
        return button;
    }

    function selectedSet() {
        return fieldSets.find((set) => String(set.id) === select.value) || null;
    }

    function currentVisibleColumns() {
        const hidden = getHiddenColumns(tableName, viewKey);
        return fieldOptions.filter((option) => !hidden[option.value]).map((option) => option.value);
    }

    function mountPicker(availableColumns, selectedColumns = null) {
        picker?.destroy?.();
        pickerWrapper.replaceChildren();
        fieldOptions = normalizeColumnOptions(availableColumns);
        pickerWrapper.hidden = fieldOptions.length === 0;
        if (fieldOptions.length === 0) {
            picker = null;
            return;
        }
        const initialSelection = Array.isArray(selectedColumns)
            ? selectedColumns
            : visibleFromHidden(fieldOptions, getHiddenColumns(tableName, viewKey));
        picker = createMultiselectDropdown({
            containerElement: pickerWrapper,
            options: fieldOptions,
            placeholder: t("field_set_fields_placeholder", "Kentät kenttäjoukossa"),
            searchPlaceholder: t("search_fields", "Etsi kenttiä"),
            allowExclude: false,
            selectedCountLabel: t("fields_selected", "kenttää"),
            initialState: { includeValues: initialSelection },
            onChange: ({ includeValues }) => applyVisibleColumns(includeValues),
        });
    }

    function applyVisibleColumns(visibleColumns = []) {
        if (destroyed) return;
        const visible = new Set(visibleColumns.map(String));
        const hidden = {};
        for (const option of fieldOptions) {
            if (!visible.has(option.value)) hidden[option.value] = true;
        }
        const key = getColumnVisibilityStorageKey(tableName, viewKey);
        // Keep an explicit empty scoped value. Removing it would revive the
        // old table-wide compatibility key and unexpectedly hide fields again.
        localStorage.setItem(key, JSON.stringify(hidden));
        localStorage.removeItem(`${tableName}_hide_columns`);
        applyColumnVisibility(tableName, viewKey);
        window.dispatchEvent(new CustomEvent("column_visibility_changed", {
            detail: { tableName, viewKey },
        }));
    }

    function syncPicker(visibleColumns) {
        picker?.setValue({ includeValues: visibleColumns, excludeValues: [] });
    }

    function availableSets() {
        return editingSiteDefault
            ? fieldSets.filter((set) => set.scope === "shared")
            : fieldSets;
    }

    function render() {
        if (destroyed) return;
        modeButton.hidden = !serverCollectionsAvailable || !canEditSiteDefault;
        select.hidden = !serverCollectionsAvailable || !canEditPersonal;
        actions.hidden = !serverCollectionsAvailable || (!canEditPersonal && !editingSiteDefault);
        modeButton.textContent = editingSiteDefault
            ? t("edit_personal_field_selection", "Palaa omaan valintaan")
            : t("edit_site_field_default", "Muokkaa sivuston oletusta");
        select.innerHTML = "";
        const placeholder = document.createElement("option");
        placeholder.value = "";
        placeholder.textContent = `— ${t("select_field_set", "Valitse kenttäjoukko")} —`;
        select.appendChild(placeholder);
        for (const fieldSet of availableSets()) {
            const option = document.createElement("option");
            option.value = String(fieldSet.id);
            option.textContent = fieldSet.scope === "shared"
                ? `${fieldSet.name} (${t("shared", "jaettu")})`
                : fieldSet.name;
            select.appendChild(option);
        }
        const selectedAssignmentID = editingSiteDefault
            ? siteDefaultFieldSetID
            : activeFieldSetID;
        if (selectedAssignmentID && availableSets().some((set) => String(set.id) === String(selectedAssignmentID))) {
            select.value = String(selectedAssignmentID);
        }
        const selected = selectedSet();
        updateButton.disabled = !selected || (
            editingSiteDefault
                ? selected.scope !== "shared"
                : selected.scope !== "personal"
        );
        deleteButton.disabled = !selected || (!editingSiteDefault && selected.scope !== "personal");
        resetButton.hidden = editingSiteDefault || !personalFieldSetID;
    }

    async function reload({ applyEffective = false } = {}) {
        const response = await getViewFieldSets(tableName, viewKey);
        if (destroyed) return;
        serverCollectionsAvailable = true;
        fieldSets = Array.isArray(response?.field_sets) ? response.field_sets : [];
        activeFieldSetID = response?.active_field_set_id ?? null;
        personalFieldSetID = response?.personal_field_set_id ?? null;
        siteDefaultFieldSetID = response?.site_default_field_set_id ?? null;
        canEditPersonal = response?.can_edit_personal === true;
        canEditSiteDefault = response?.can_edit_site_default === true;
        const availableColumns = Array.isArray(response?.available_columns)
            ? response.available_columns
            : [];
        if (availableColumns.length > 0) {
            const currentSignature = fieldOptions.map((option) => option.value).join("\u0000");
            const availableSignature = availableColumns.map(String).join("\u0000");
            if (currentSignature !== availableSignature) {
                mountPicker(availableColumns, response?.visible_columns);
            }
        }
        if (applyEffective) {
            const siteDefault = editingSiteDefault
                ? fieldSets.find((fieldSet) => String(fieldSet.id) === String(siteDefaultFieldSetID))
                : null;
            const visibleColumns = siteDefault?.visible_columns ?? response?.visible_columns;
            if (Array.isArray(visibleColumns)) {
                applyVisibleColumns(visibleColumns);
                syncPicker(visibleColumns);
            }
        }
        render();
    }

    async function saveNamed(name) {
        const payload = {
            dataset: tableName,
            view_key: viewKey,
            name,
            visible_columns: currentVisibleColumns(),
        };
        if (editingSiteDefault) await saveSiteViewFieldSet(payload);
        else await savePersonalViewFieldSet(payload);
        await reload({ applyEffective: true });
        await refreshDatasetAfterFieldSetMutation();
    }

    async function refreshDatasetAfterFieldSetMutation() {
        try {
            const { refreshTableUnified } = await import(
                "../../general_tables/gt_1_row_crud/gt_1_2_row_read/table_refresh_unified.js"
            );
            await refreshTableUnified(tableName);
        } catch (error) {
            console.warn("column_view_preset_builder: dataset refresh failed", error);
        }
    }

    addListener(modeButton, "click", async () => {
        editingSiteDefault = !editingSiteDefault;
        if (editingSiteDefault) {
            const siteDefault = fieldSets.find(
                (fieldSet) => String(fieldSet.id) === String(siteDefaultFieldSetID)
            );
            if (siteDefault) {
                applyVisibleColumns(siteDefault.visible_columns || []);
                syncPicker(siteDefault.visible_columns || []);
            }
        } else {
            await reload({ applyEffective: true });
            return;
        }
        render();
    });

    addListener(select, "change", async () => {
        const fieldSet = selectedSet();
        if (!fieldSet) {
            render();
            return;
        }
        const payload = { dataset: tableName, view_key: viewKey, field_set_id: fieldSet.id };
        try {
            if (editingSiteDefault) await assignSiteViewFieldSet(payload);
            else await assignPersonalViewFieldSet(payload);
            if (editingSiteDefault) {
                siteDefaultFieldSetID = fieldSet.id;
                if (!personalFieldSetID) activeFieldSetID = fieldSet.id;
            } else {
                personalFieldSetID = fieldSet.id;
                activeFieldSetID = fieldSet.id;
            }
            applyVisibleColumns(fieldSet.visible_columns || []);
            syncPicker(fieldSet.visible_columns || []);
            render();
            await refreshDatasetAfterFieldSetMutation();
            showSuccessToast(t("field_set_applied", "Kenttäjoukko ladattu"));
        } catch (error) {
            console.warn("column_view_preset_builder: assignment failed", error);
        }
    });

    addListener(saveButton, "click", async () => {
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
        if (!name?.trim()) return;
        try {
            await saveNamed(name.trim());
            showSuccessToast(t("field_set_saved", "Kenttäjoukko tallennettu"));
        } catch (error) {
            console.warn("column_view_preset_builder: save failed", error);
        }
    });

    addListener(updateButton, "click", async () => {
        const fieldSet = selectedSet();
        if (!fieldSet) return;
        try {
            await saveNamed(fieldSet.name);
            showSuccessToast(t("field_set_updated", "Kenttäjoukko päivitetty"));
        } catch (error) {
            console.warn("column_view_preset_builder: update failed", error);
        }
    });

    addListener(resetButton, "click", async () => {
        try {
            await resetPersonalViewFieldSet({ dataset: tableName, view_key: viewKey });
            activeFieldSetID = null;
            await reload({ applyEffective: true });
            await refreshDatasetAfterFieldSetMutation();
            showSuccessToast(t("site_default_restored", "Sivuston oletus palautettu"));
        } catch (error) {
            console.warn("column_view_preset_builder: reset failed", error);
        }
    });

    addListener(deleteButton, "click", async () => {
        const fieldSet = selectedSet();
        if (!fieldSet) return;
        const confirmed = await showConfirmModal({
            titleLangKey: "confirm_delete",
            messageLangKey: "confirm_delete_field_set",
            messageText: `${fieldSet.name}?`,
        });
        if (!confirmed) return;
        try {
            const payload = { field_set_id: fieldSet.id };
            if (editingSiteDefault) await deleteSharedViewFieldSet(payload);
            else await deletePersonalViewFieldSet(payload);
            activeFieldSetID = null;
            await reload({ applyEffective: !editingSiteDefault });
            await refreshDatasetAfterFieldSetMutation();
            showSuccessToast(t("field_set_deleted", "Kenttäjoukko poistettu"));
        } catch (error) {
            console.warn("column_view_preset_builder: delete failed", error);
        }
    });

    void reload({ applyEffective: true }).catch((error) => {
        console.warn("column_view_preset_builder: load failed", error);
        serverCollectionsAvailable = false;
        render();
    });

    render();

    row.destroy = () => {
        destroyed = true;
        picker?.destroy?.();
        listenerCleanups.forEach((cleanup) => cleanup());
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

function visibleFromHidden(fieldOptions, hiddenColumns) {
    return fieldOptions.filter((option) => !hiddenColumns[option.value]).map((option) => option.value);
}
