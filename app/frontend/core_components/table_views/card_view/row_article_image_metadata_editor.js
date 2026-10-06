// row_article_image_metadata_editor.js
// Builds inline title and description controls for the article's active image.
// Bridges shared-asset rows, add-row language metadata, and batched row updates.
// Exists to edit translations without exposing their stored language-map structure.

import { endpoint_router } from "../../endpoints/endpoint_router.js";
import { getTranslationForKey } from "../../lang/translation_handler.js";
import { getTableSpec } from "../../state_stores/table_specs_reader.js";
import { fetchColumnsInfo } from "../../general_tables/gt_1_row_crud/gt_1_1_row_create/row_api_fetcher.js";
import { buildMultilingualTextareaGroup } from "../../general_tables/gt_1_row_crud/gt_1_1_row_create/row_multilingual_input_builder.js";
import {
    showErrorToast,
    showSuccessToast,
} from "../../../reusable_components/notifications/toast_notification_printer.js";

/** Builds the shared-asset image editor, reusing add-row metadata and language controls. */
export function createImageMetadataEditor({ childDataset, columnTypes = {}, onRefresh }) {
    const wrapper = document.createElement("div");
    wrapper.classList.add("big_card_image_editor_shell");
    wrapper.dataset.testid = "big-card-image-editor-shell";

    const toggleButton = document.createElement("button");
    toggleButton.type = "button";
    toggleButton.classList.add("fw-btn", "fw-btn--ghost", "big_card_image_editor_toggle");
    toggleButton.dataset.testid = "big-card-image-editor-toggle";

    const section = document.createElement("section");
    section.classList.add("big_card_image_editor");
    section.dataset.testid = "big-card-image-editor";
    section.hidden = true;

    const heading = document.createElement("h4");
    heading.classList.add("big_card_image_editor_title");
    heading.textContent = getTranslationForKey("edit") || "Muokkaa";

    const form = document.createElement("form");
    form.classList.add("big_card_image_editor_form");

    const titleLabel = document.createElement("label");
    titleLabel.classList.add("big_card_image_editor_field");
    const titleCaption = document.createElement("span");
    titleCaption.classList.add("big_card_image_editor_label");
    titleCaption.textContent = getTranslationForKey("title") || "Otsikko";
    const titleInput = document.createElement("input");
    titleInput.type = "text";
    titleInput.classList.add("big_card_image_editor_input");
    titleInput.dataset.testid = "big-card-image-title-input";
    titleLabel.append(titleCaption, titleInput);

    const descriptionLabel = document.createElement("label");
    descriptionLabel.classList.add("big_card_image_editor_field");
    const descriptionCaption = document.createElement("span");
    descriptionCaption.classList.add("big_card_image_editor_label");
    descriptionCaption.textContent = getTranslationForKey("description") || "Kuvaus";
    const descriptionInput = document.createElement("textarea");
    descriptionInput.classList.add("big_card_image_editor_textarea");
    descriptionInput.dataset.testid = "big-card-image-description-input";
    descriptionInput.rows = 3;
    descriptionLabel.append(descriptionCaption, descriptionInput);

    const helper = document.createElement("p");
    helper.classList.add("big_card_image_editor_helper");

    const actionRow = document.createElement("div");
    actionRow.classList.add("big_card_image_editor_actions");

    const saveButton = document.createElement("button");
    saveButton.type = "submit";
    saveButton.classList.add("fw-btn", "big_card_image_editor_save");
    saveButton.dataset.testid = "big-card-image-save";
    saveButton.textContent = getTranslationForKey("save") || "Tallenna";

    const resetButton = document.createElement("button");
    resetButton.type = "button";
    resetButton.classList.add("fw-btn", "fw-btn--ghost", "big_card_image_editor_reset");
    resetButton.dataset.testid = "big-card-image-reset";
    resetButton.textContent = getTranslationForKey("cancel") || "Peru";

    actionRow.append(saveButton, resetButton);
    form.append(titleLabel, descriptionLabel, helper, actionRow);
    section.append(heading, form);
    wrapper.append(toggleButton, section);

    let currentRow = null;
    let isEditorOpen = false;
    const fields = [
        { columnName: "title", input: titleInput, label: titleLabel, caption: titleCaption },
        { columnName: "description", input: descriptionInput, label: descriptionLabel, caption: descriptionCaption },
    ];
    const multilingualFields = fields.filter((field) => columnTypes[field.columnName]?.is_multilingual === true);
    let isMetadataReady = multilingualFields.length === 0;
    let metadataLoadFailed = false;
    multilingualFields.forEach((field) => { field.label.classList.add("hidden"); });

    const syncEditorVisibility = () => {
        const hasRow = Boolean(currentRow);
        toggleButton.hidden = !hasRow;
        toggleButton.disabled = !hasRow;
        toggleButton.textContent = isEditorOpen
            ? "Piilota kuvatiedot"
            : "Muokkaa kuvatietoja";
        toggleButton.setAttribute("aria-expanded", isEditorOpen && hasRow ? "true" : "false");
        section.hidden = !hasRow || !isEditorOpen;
    };

    const syncInputsFromCurrentRow = () => {
        fields.forEach((field) => {
            field.input.disabled = !isMetadataReady;
            const value = currentRow?.[field.columnName] || "";
            if (field.multilingualControl) {
                field.currentValue = field.multilingualControl.setValue(value);
            } else {
                field.input.value = String(value);
                field.currentValue = field.input.value.trim();
            }
        });
        if (!currentRow) {
            isEditorOpen = false;
            helper.textContent = "";
            saveButton.disabled = true;
            resetButton.disabled = true;
            syncEditorVisibility();
            return;
        }

        helper.textContent = String(currentRow?.original_name || currentRow?.filename || "").trim()
            ? `Tiedoston nimi: ${String(currentRow.original_name || currentRow.filename).trim()}`
            : "Muokkaa kuvan otsikkoa ja kuvausta.";
        if (!isMetadataReady) {
            helper.textContent = metadataLoadFailed
                ? getTranslationForKey("failed_to_load", { fallback: "The image details could not be loaded." })
                : getTranslationForKey("loading", { fallback: "Loading…" });
        }
        saveButton.disabled = !isMetadataReady;
        resetButton.disabled = !isMetadataReady;
        syncEditorVisibility();
    };

    if (multilingualFields.length > 0) {
        // The add-row schema owns the active language list; related-row types
        // only identify which image fields need that same multilingual control.
        const tableUID = getTableSpec(childDataset)?.table_uid;
        const columnsRequest = tableUID ? fetchColumnsInfo(tableUID) : Promise.resolve(null);
        columnsRequest.then((columns) => {
            for (const field of multilingualFields) {
                const column = columns?.find((entry) => entry.column_name === field.columnName);
                if (!column || column.is_multilingual !== true) {
                    throw new Error(`Multilingual image column metadata is unavailable for ${field.columnName}.`);
                }
                const control = buildMultilingualTextareaGroup(document.createElement("div"), {
                    tableName: childDataset,
                    column,
                    idPrefix: `image-${childDataset}-${field.columnName}`,
                    allowPartialTranslations: true,
                    legacyValueToDefaultLanguage: true,
                });
                control.group.classList.add("big_card_image_editor_field", "big_card_image_editor_multilingual");
                const legend = control.group.querySelector("legend");
                legend.classList.add("big_card_image_editor_label");
                legend.textContent = getTranslationForKey(field.columnName, { fallback: field.caption.textContent });
                control.textareas.forEach((textarea) => {
                    textarea.classList.add("big_card_image_editor_textarea");
                    textarea.dataset.testid = `big-card-image-${field.columnName}-input-${textarea.dataset.languageCode}`;
                });
                field.label.replaceWith(control.group);
                field.multilingualControl = control;
            }
            isMetadataReady = true;
            syncInputsFromCurrentRow();
        }).catch((err) => {
            console.warn("image multilingual metadata load failed:", err?.message || err);
            metadataLoadFailed = true;
            syncInputsFromCurrentRow();
        });
    }

    toggleButton.addEventListener("click", () => {
        if (!currentRow) {
            return;
        }
        isEditorOpen = !isEditorOpen;
        syncEditorVisibility();
    });

    resetButton.addEventListener("click", syncInputsFromCurrentRow);

    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (!currentRow?.id || !isMetadataReady) {
            return;
        }

        const values = fields.map((field) => ({
            column: field.columnName,
            value: field.multilingualControl
                ? field.multilingualControl.syncValue({ emit: false })
                : field.input.value.trim(),
        }));
        const updates = values.filter((update, index) => update.value !== fields[index].currentValue);
        if (updates.length === 0) {
            return;
        }

        saveButton.disabled = true;
        resetButton.disabled = true;
        section.classList.add("is-saving");
        try {
            await endpoint_router("updateRow", {
                method: "POST",
                url_params: `?dataset=${childDataset}`,
                body_data: {
                    id: currentRow.id,
                    updates,
                },
            });
            values.forEach(({ column, value }) => { currentRow[column] = value; });
            showSuccessToast(getTranslationForKey("save_success") || "Kuva päivitetty.");
            await onRefresh();
        } catch (err) {
            console.warn("image metadata update failed:", err?.message || err);
            showErrorToast(getTranslationForKey("save_failed") || "Kuvan päivitys ei onnistunut.");
        } finally {
            section.classList.remove("is-saving");
            syncInputsFromCurrentRow();
        }
    });

    return {
        element: wrapper,
        focus() {
            if (!currentRow) {
                return;
            }
            isEditorOpen = true;
            syncEditorVisibility();
            const firstInput = fields[0].multilingualControl?.textareas[0] || titleInput;
            firstInput.focus();
            firstInput.select();
        },
        loadRow(nextRow) {
            currentRow = nextRow || null;
            syncInputsFromCurrentRow();
        },
    };
}
