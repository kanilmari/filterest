// row_input_builder.js
// Builds standard form inputs: text, number, date, and foreign key dropdowns.
// Between the row creation form and the DOM input elements.
// Exists to handle input field creation and FK data fetching for new rows.

import { createMultiselectDropdown } from "../../../../reusable_components/multiselect_dropdown/multiselect_dropdown_builder.js";
import { fetchLinkableRows } from "./row_api_fetcher.js";
import { buildGeometryField } from "./row_geometry_builder.js";
import { buildFieldTestId, getInputType } from "./row_input_builder_helpers.js";
import { getLanguageWithBrowserFallback } from "../../../state_stores/lang_preference_reader.js";
import { resolveDatasetDisplayValue } from "../../../table_views/dataset_value_localizer.js";
import { buildMultilingualTextareaGroup } from "./row_multilingual_input_builder.js";
import { getTranslationForKey } from "../../../lang/translation_handler.js";

/** @deprecated Use getInputType from row_input_builder_helpers.js */
export const get_input_type = getInputType;

export function buildForeignKeyField(form, table_name, column, modal_form_state) {
    const foreignDatasetName = column.foreign_dataset_name || column.foreign_table_name;
    const fieldset = document.createElement("fieldset");
    fieldset.classList.add("row-creation-form__relation-fieldset");
    fieldset.dataset.relationKind = "foreign-key";
    fieldset.dataset.testid = `foreign-key-${column.column_name}`;

    const legend = document.createElement("legend");
    const actionLabel = document.createElement("span");
    actionLabel.dataset.langKey = "link_existing";
    actionLabel.textContent = "Link existing";
    const datasetLabel = document.createElement("span");
    datasetLabel.dataset.langKey = foreignDatasetName;
    datasetLabel.textContent = foreignDatasetName;
    legend.append(actionLabel, document.createTextNode(" "), datasetLabel);
    fieldset.appendChild(legend);

    const dropdown_container = document.createElement("div");
    dropdown_container.id = `${table_name}-${column.column_name}-input`;
    dropdown_container.dataset.testid = buildFieldTestId(column.column_name);
    dropdown_container.style.marginBottom = "10px";

    const hidden_input = document.createElement("input");
    hidden_input.type = "hidden";
    hidden_input.name = column.column_name;
    hidden_input.dataset.testid = `form-hidden-${column.column_name}`;
    fieldset.appendChild(hidden_input);

    // Luo dropdown ja tallenna instanssi, jotta se voidaan päivityksen jälkeen
    // täyttää haetuilla arvoilla
    const mapOptions = (options = []) => {
        const chosenLanguage = getLanguageWithBrowserFallback();
        return options.map((opt) => {
            const value = String(opt.value ?? "");
            const label = resolveDatasetDisplayValue(
                opt.label,
                null,
                chosenLanguage
            ) || value;
            return {
                value,
                label: `${label} · #${value}`,
                searchTerms: [value, label, String(opt.label ?? "")],
            };
        }).filter((option) => option.value);
    };
    const foreignValueColumn = column.foreign_column_name || "id";
    const dropdownInstance = createMultiselectDropdown({
        containerElement: dropdown_container,
        portalElement: document.getElementById("custom_modal_overlay") || document.body,
        options: [],
        placeholder: getTranslationForKey("choose_from_existing") || "Choose from existing…",
        searchPlaceholder: getTranslationForKey("search_by_name_or_id") || "Search by name or ID…",
        useSearch: true,
        allowExclude: false,
        maxSelections: 1,
        selectedCountLabel: getTranslationForKey("selected") || "selected",
        noResultsLabel: getTranslationForKey("no_results") || "No results",
        clearLabel: getTranslationForKey("clear_selection") || "Clear selection",
        onSearch: async (searchText) => mapOptions(await fetchLinkableRows(
            foreignDatasetName,
            foreignValueColumn,
            { search: searchText }
        )),
        onChange: ({ includeValues }) => {
            const value = includeValues.at(-1) || "";
            hidden_input.value = value;
            modal_form_state[column.column_name] = value;
        },
    });

    // Hae data
    fetchLinkableRows(foreignDatasetName, foreignValueColumn)
        .then((options) => {
            if (!Array.isArray(options)) return;
            // Päivitä dropdown nyt kun data on saatu
            dropdownInstance.setOptions(mapOptions(options));
        })
        .catch((err) => {
            console.warn(
                `virhe haettaessa dataa taulusta ${foreignDatasetName}:`,
                err
            );
        });

    fieldset.appendChild(dropdown_container);
    form.appendChild(fieldset);
    return fieldset;
}

export function buildRegularField(form, table_name, column, modal_form_state) {
    const label = document.createElement("label");
    // label.textContent = column.column_name;
    label.dataset.langKey = column.column_name;
    label.htmlFor = `${table_name}-${column.column_name}-input`;
    label.style.margin = "10px 0 5px";

    const data_type_lower = column.data_type.toLowerCase();

    if (column.is_multilingual === true) {
        buildMultilingualTextareaGroup(form, {
            tableName: table_name,
            column,
            initialValue: modal_form_state[column.column_name] || "",
            fieldName: column.column_name,
            onValueChange: (value) => {
                modal_form_state[column.column_name] = value;
            },
        });
        return;
    }

    // Esimerkki: geometry/position
    if (
        data_type_lower.includes("geometry") &&
        column.column_name.toLowerCase() === "position"
    ) {
        buildGeometryField(form, column, modal_form_state);
        return;
    }

    if (
        data_type_lower === "text" ||
        data_type_lower.includes("varchar") ||
        data_type_lower.startsWith("character varying") ||
        data_type_lower === "jsonb"
    ) {
        const textarea = document.createElement("textarea");
        textarea.name = column.column_name;
        textarea.id = `${table_name}-${column.column_name}-input`;
        textarea.dataset.testid = buildFieldTestId(column.column_name);
        textarea.required = column.is_nullable.toLowerCase() === "no";
        textarea.rows = 1;
        textarea.classList.add("auto_resize_textarea");
        textarea.style.lineHeight = "1.2em";
        textarea.style.minHeight = "2em";
        textarea.style.padding = "4px 6px";
        textarea.style.border = "1px solid var(--border_color)";
        textarea.style.borderRadius = "4px";
        textarea.style.height = "auto";
        textarea.value = modal_form_state[column.column_name] || "";
        textarea.style.height = textarea.scrollHeight + "px";
        textarea.dispatchEvent(new Event("input"));

        textarea.addEventListener("input", (e) => {
            modal_form_state[column.column_name] = e.target.value;
        });

        form.appendChild(label);
        form.appendChild(textarea);
    } else {
        const input = document.createElement("input");
        input.type = getInputType(column.data_type);
        input.id = `${table_name}-${column.column_name}-input`;
        input.name = column.column_name;
        input.dataset.testid = buildFieldTestId(column.column_name);
        input.required = column.is_nullable.toLowerCase() === "no";
        input.style.padding = "8px";
        input.style.border = "1px solid var(--border_color)";
        input.style.borderRadius = "4px";

        if (modal_form_state[column.column_name]) {
            input.value = modal_form_state[column.column_name];
        }

        input.addEventListener("input", (e) => {
            modal_form_state[column.column_name] = e.target.value;
        });

        form.appendChild(label);
        form.appendChild(input);
    }
}
