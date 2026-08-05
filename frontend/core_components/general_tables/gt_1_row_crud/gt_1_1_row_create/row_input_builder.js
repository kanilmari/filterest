// row_input_builder.js
// Builds standard form inputs: text, number, date, and foreign key dropdowns.
// Between the row creation form and the DOM input elements.
// Exists to handle input field creation and FK data fetching for new rows.

import { createVanillaDropdown } from "../../../../reusable_components/vanilla_dropdown/vanilla_dropdown_builder.js";
import { fetchReferencedData } from "./row_api_fetcher.js";
import { buildGeometryField } from "./row_geometry_builder.js";
import { buildFieldTestId, getInputType } from "./row_input_builder_helpers.js";
import { getLanguageWithBrowserFallback } from "../../../state_stores/lang_preference_reader.js";
import { resolveDatasetDisplayValue } from "../../../table_views/dataset_value_localizer.js";

/** @deprecated Use getInputType from row_input_builder_helpers.js */
export const get_input_type = getInputType;

export function buildForeignKeyField(form, table_name, column, modal_form_state) {
    const label = document.createElement("label");
    // label.textContent = column.column_name;
    label.dataset.langKey = column.column_name;
    label.htmlFor = `${table_name}-${column.column_name}-input`;
    label.style.margin = "10px 0 5px";

    const dropdown_container = document.createElement("div");
    dropdown_container.id = `${table_name}-${column.column_name}-input`;
    dropdown_container.dataset.testid = buildFieldTestId(column.column_name);
    dropdown_container.style.marginBottom = "10px";

    const hidden_input = document.createElement("input");
    hidden_input.type = "hidden";
    hidden_input.name = column.column_name;
    hidden_input.dataset.testid = `form-hidden-${column.column_name}`;
    form.appendChild(hidden_input);

    // Luo dropdown ja tallenna instanssi, jotta se voidaan päivityksen jälkeen
    // täyttää haetuilla arvoilla
    const dropdownInstance = createVanillaDropdown({
        containerElement: dropdown_container,
        options: [],
        placeholder: "Valitse...",
        searchPlaceholder: "Hae...",
        showClearButton: true,
        useSearch: true,
        onChange: (val) => {
            hidden_input.value = val || "";
            modal_form_state[column.column_name] = val;
        },
    });

    // Hae data
    fetchReferencedData(column.foreign_table_name)
        .then((options) => {
            if (!Array.isArray(options)) return;
            const chosenLanguage = getLanguageWithBrowserFallback();
            const mapped_options = options.map((opt) => {
                const pk_column = Object.keys(opt).find(
                    (key) => key !== "display"
                );
                return {
                    value: opt[pk_column],
                    label: `${opt[pk_column]} - ${resolveDatasetDisplayValue(
                        opt["display"],
                        null,
                        chosenLanguage
                    )}`,
                };
            });
            // Päivitä dropdown nyt kun data on saatu
            dropdownInstance.setOptions(mapped_options);
        })
        .catch((err) => {
            console.warn(
                `virhe haettaessa dataa taulusta ${column.foreign_table_name}:`,
                err
            );
        });

    form.appendChild(label);
    form.appendChild(dropdown_container);
}

export function buildRegularField(form, table_name, column, modal_form_state) {
    const label = document.createElement("label");
    // label.textContent = column.column_name;
    label.dataset.langKey = column.column_name;
    label.htmlFor = `${table_name}-${column.column_name}-input`;
    label.style.margin = "10px 0 5px";

    const data_type_lower = column.data_type.toLowerCase();

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
