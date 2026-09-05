// row_existing_relation_builder.js
// Builds the single add-row page used to link already existing related rows.
// Bridges relation metadata, row-policy-aware option reads, and the shared multiselect.
// Exists so row creation never needs to render another business table's create form.

import { createMultiselectDropdown } from "../../../../reusable_components/multiselect_dropdown/multiselect_dropdown_builder.js";
import { getTranslationForKey } from "../../../lang/translation_handler.js";
import { getLanguageWithBrowserFallback } from "../../../state_stores/lang_preference_reader.js";
import { resolveDatasetDisplayValue } from "../../../table_views/dataset_value_localizer.js";
import { fetchLinkableRows } from "./row_api_fetcher.js";

const RELATION_KIND_ONE_TO_MANY = "one_to_many";
const RELATION_KIND_MANY_TO_MANY = "many_to_many";

export function relationHasEnabledFileUpload(relation = {}) {
    try {
        const specs = relation.target_insert_specs
            ? JSON.parse(relation.target_insert_specs)
            : null;
        return specs?.file_upload?.enabled === true;
    } catch (error) {
        console.warn("virhe target_insert_specs JSON-parsinnassa:", error);
        return false;
    }
}

export function manyToManyRelatedDatasetNames(manyToManyInfos = []) {
    return new Set(
        manyToManyInfos
            .map((info) => normalizeManyToManyInfo(info).thirdTableName)
            .filter(Boolean)
    );
}

export function buildExistingRelationFields(
    container,
    oneToManyRelations,
    manyToManyInfos,
    modalFormState
) {
    modalFormState._existingRelationLinks = [];
    const m2mDatasetNames = manyToManyRelatedDatasetNames(manyToManyInfos);
    let controlCount = 0;

    oneToManyRelations.forEach((relation) => {
        if (relationHasEnabledFileUpload(relation)) return;
        const normalized = normalizeOneToManyInfo(relation);
        if (!normalized.relationId || !normalized.relatedDatasetName) return;
        // Prefer the M:M path when the same two datasets intentionally expose
        // both legacy direct-child metadata and a true multi-link relation.
        if (m2mDatasetNames.has(normalized.relatedDatasetName)) return;
        appendExistingRelationPicker(container, normalized, modalFormState);
        controlCount += 1;
    });

    manyToManyInfos.forEach((relation) => {
        const normalized = normalizeManyToManyInfo(relation);
        if (!normalized.relationId || !normalized.relatedDatasetName) return;
        appendExistingRelationPicker(container, normalized, modalFormState);
        controlCount += 1;
    });

    return controlCount;
}

function appendExistingRelationPicker(container, relation, modalFormState) {
    const fieldset = document.createElement("fieldset");
    fieldset.classList.add("row-creation-form__relation-fieldset");
    fieldset.dataset.relationKind = relation.relationKind;
    fieldset.dataset.relationId = String(relation.relationId);
    fieldset.dataset.testid = `existing-relation-${relation.relationKind}-${relation.relationId}`;

    const legend = document.createElement("legend");
    const actionLabel = document.createElement("span");
    actionLabel.dataset.langKey = "link_existing";
    actionLabel.textContent = "Link existing";
    const datasetLabel = document.createElement("span");
    datasetLabel.dataset.langKey = relation.relatedDatasetName;
    datasetLabel.textContent = relation.relatedDatasetName;
    legend.append(actionLabel, document.createTextNode(" "), datasetLabel);
    fieldset.appendChild(legend);

    const dropdownContainer = document.createElement("div");
    dropdownContainer.dataset.testid = `existing-relation-picker-${relation.relationId}`;
    fieldset.appendChild(dropdownContainer);
    container.appendChild(fieldset);

    const state = {
        relationKind: relation.relationKind,
        relationId: relation.relationId,
        relatedDatasetName: relation.relatedDatasetName,
        rowIds: [],
    };
    modalFormState._existingRelationLinks.push(state);

    const dropdown = createMultiselectDropdown({
        containerElement: dropdownContainer,
        portalElement: document.getElementById("custom_modal_overlay") || document.body,
        options: [],
        placeholder: getTranslationForKey("choose_from_existing") || "Choose from existing…",
        searchPlaceholder: getTranslationForKey("search_by_name_or_id") || "Search by name or ID…",
        allowExclude: false,
        selectedCountLabel: getTranslationForKey("selected") || "selected",
        noResultsLabel: getTranslationForKey("no_results") || "No results",
        clearLabel: getTranslationForKey("clear_selection") || "Clear selection",
        onSearch: async (searchText) => mapRelationOptions(await fetchLinkableRows(
            relation.relatedDatasetName,
            "id",
            { search: searchText }
        )),
        onChange: ({ includeValues }) => {
            state.rowIds = [...includeValues];
        },
    });
    state.dropdown = dropdown;

    // Relation metadata identifies the write target. The option list itself
    // comes from the standard row-policy-aware read endpoint, so opening this
    // control cannot reveal rows the current actor is unable to read.
    fetchLinkableRows(relation.relatedDatasetName).then((options) => {
        dropdown.setOptions(mapRelationOptions(options));
    }).catch((error) => {
        console.warn("virhe olemassa olevien liitosrivien haussa:", error);
        dropdown.setOptions([]);
    });
}

export function mapRelationOptions(options = []) {
    const chosenLanguage = getLanguageWithBrowserFallback();
    return options.map((option) => {
        const value = String(option.value ?? "");
        const label = resolveDatasetDisplayValue(option.label, null, chosenLanguage) || value;
        return {
            value,
            label: `${label} · #${value}`,
            searchTerms: [value, label, String(option.label ?? "")],
        };
    }).filter((option) => option.value);
}

function normalizeOneToManyInfo(info = {}) {
    return {
        relationKind: RELATION_KIND_ONE_TO_MANY,
        relationId: Number(info.relation_id) || 0,
        relatedDatasetName: String(info.source_dataset_name || "").trim(),
    };
}

function normalizeManyToManyInfo(info = {}) {
    return {
        relationKind: RELATION_KIND_MANY_TO_MANY,
        relationId: Number(info.relation_id) || 0,
        relatedDatasetName: String(
            info.third_dataset_name || info.thirdTableName || ""
        ).trim(),
        thirdTableName: String(
            info.third_dataset_name || info.thirdTableName || ""
        ).trim(),
    };
}
