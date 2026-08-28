// row_geometry_builder.js
// DOM builders for geometry inputs and HERE address suggestion selection.
// Between row input/relation builders, endpoint_router geocoding, and form state.
// Exists to keep geometry field rendering separate from pure suggestion mapping.

import { endpoint_router } from "../../../endpoints/endpoint_router.js";
import { showWarningToast } from "../../../../reusable_components/notifications/toast_notification_printer.js";
import {
    GEOMETRY_FIELD_MAP,
    getSuggestionLabel,
    mapSuggestionToFields,
    toWKTPoint,
} from "./row_geometry_helpers.js";

/** Täyttää taustakenttiä valitun osoitteen lisätiedoilla */
export function fillAdditionalGeometryFields(form, suggestion, modal_form_state) {
    const mappedFields = mapSuggestionToFields(suggestion, GEOMETRY_FIELD_MAP);

    GEOMETRY_FIELD_MAP.forEach((fieldName) => {
        const field = form.querySelector(`[name="${fieldName}"]`);
        if (field) {
            const fieldValue = mappedFields[fieldName] ?? "";
            field.value = fieldValue;
            modal_form_state[fieldName] = fieldValue;
        }
    });
}

/** Geometriakentän HERE-validointi (päätaulun position) */
export function buildGeometryField(form, column, modal_form_state) {
    const label = document.createElement("label");
    // label.textContent = column.column_name;
    label.dataset.langKey = column.column_name;

    const container = document.createElement("div");
    container.style.display = "flex";
    container.style.flexDirection = "column";
    container.style.gap = "6px";

    const addrLabel = document.createElement("label");
    // addrLabel.textContent = 'Anna osoite (HERE-validointi)';
    addrLabel.dataset.langKey = "enter_address_here";

    const addrInput = document.createElement("input");
    addrInput.type = "text";
    addrInput.placeholder = "Esim. Mannerheimintie 10, Helsinki";

    const suggestionsDiv = document.createElement("div");
    suggestionsDiv.style.marginTop = "10px";

    const hiddenGeom = document.createElement("input");
    hiddenGeom.type = "hidden";
    hiddenGeom.name = column.column_name;
    hiddenGeom.value = modal_form_state[column.column_name] || "";

    const validateBtn = document.createElement("button");
    validateBtn.type = "button";
    // validateBtn.textContent = 'Validoi HEREllä';
    validateBtn.dataset.langKey = "validate";

    validateBtn.addEventListener("click", async () => {
        const addr = addrInput.value.trim();
        if (!addr) {
            showWarningToast("Syötä osoite ennen validointia");
            return;
        }
        try {
            const suggestions = await endpoint_router('geocodeAddress', {
                method: 'POST',
                body_data: { address: addr },
            });
            suggestionsDiv.replaceChildren();
            if (!Array.isArray(suggestions) || suggestions.length === 0) {
                suggestionsDiv.textContent = "Ei tuloksia.";
                return;
            }
            suggestions.slice(0, 5).forEach((sug) => {
                const suggestionLabel = getSuggestionLabel(sug);
                const div = document.createElement("div");
                div.style.padding = "4px";
                div.style.borderBottom = "1px solid #eee";
                div.style.cursor = "pointer";
                div.textContent = suggestionLabel;
                div.addEventListener("click", () => {
                    // Valitaan tämä
                    addrInput.value = suggestionLabel;
                    const wktPoint = toWKTPoint(sug.position);
                    if (wktPoint) {
                        hiddenGeom.value = wktPoint;
                    }

                    modal_form_state[column.column_name] = hiddenGeom.value;
                    fillAdditionalGeometryFields(form, sug, modal_form_state);
                    suggestionsDiv.replaceChildren();
                });
                suggestionsDiv.appendChild(div);
            });
        } catch (err) {
            console.warn("Geokoodausvirhe:", err);
        }
    });

    container.appendChild(addrLabel);
    container.appendChild(addrInput);
    container.appendChild(validateBtn);
    container.appendChild(suggestionsDiv);
    container.appendChild(hiddenGeom);

    form.appendChild(label);
    form.appendChild(container);
}

/** Lapsitaulun geometriakentän HERE-validointi */
export function buildChildGeometryField(fieldset, datasetName, column, childObjectState) {
    const label = document.createElement("label");
    // label.textContent = column.column_name;
    label.dataset.langKey = column.column_name;

    const container = document.createElement("div");
    container.style.display = "flex";
    container.style.flexDirection = "column";
    container.style.gap = "6px";

    const addrLabel = document.createElement("label");
    // addrLabel.textContent = 'Anna osoite (HERE-validointi)';
    addrLabel.dataset.langKey = "enter_address";

    const addrInput = document.createElement("input");
    addrInput.type = "text";
    addrInput.placeholder = "Esim. Mikonkatu 8, Helsinki";

    const suggestionsDiv = document.createElement("div");
    suggestionsDiv.style.marginTop = "10px";

    const hiddenGeom = document.createElement("input");
    hiddenGeom.type = "hidden";
    const geomId = `child-${datasetName}-${column.column_name}`;
    hiddenGeom.id = geomId;
    hiddenGeom.name = geomId;
    hiddenGeom.value = "";
    hiddenGeom.setAttribute("data-col-name", column.column_name);

    const validateBtn = document.createElement("button");
    validateBtn.type = "button";
    // validateBtn.textContent = 'Validoi';
    validateBtn.dataset.langKey = "validate";
    validateBtn.addEventListener("click", async () => {
        const addr = addrInput.value.trim();
        if (!addr) {
            showWarningToast("Syötä osoite ennen validointia");
            return;
        }
        try {
            const suggestions = await endpoint_router('geocodeAddress', {
                method: 'POST',
                body_data: { address: addr },
            });
            suggestionsDiv.replaceChildren();
            if (!Array.isArray(suggestions) || suggestions.length === 0) {
                suggestionsDiv.textContent = "Ei tuloksia.";
                return;
            }
            suggestions.slice(0, 5).forEach((sug) => {
                const suggestionLabel = getSuggestionLabel(sug);
                const div = document.createElement("div");
                div.style.padding = "4px";
                div.style.borderBottom = "1px solid #eee";
                div.style.cursor = "pointer";
                div.textContent = suggestionLabel;
                div.addEventListener("click", () => {
                    addrInput.value = suggestionLabel;
                    const wktPoint = toWKTPoint(sug.position);
                    if (wktPoint) {
                        hiddenGeom.value = wktPoint;
                    }
                    // Päivitetään tila
                    childObjectState.data[column.column_name] = hiddenGeom.value;
                    // Jos halutaan täyttää lapsen muita kenttiä, tarvittaisiin viittaus lapsen form-elementteihin
                    // Tässä yksinkertaistettu
                    suggestionsDiv.replaceChildren();
                });
                suggestionsDiv.appendChild(div);
            });
        } catch (err) {
            console.warn("[CHILD] Geokoodausvirhe:", err);
        }
    });

    container.appendChild(addrLabel);
    container.appendChild(addrInput);
    container.appendChild(validateBtn);
    container.appendChild(suggestionsDiv);
    container.appendChild(hiddenGeom);

    fieldset.appendChild(label);
    fieldset.appendChild(container);
}
