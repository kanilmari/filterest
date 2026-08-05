// row_form_builder.js
// Builds the main add-row form structure for dataset row creation.
// Bridges column metadata and relation metadata into the modal form DOM.
// Exists to centralize how row-creation inputs are assembled before submission.

import { buildForeignKeyField, buildRegularField } from "./row_input_builder.js";
import { buildOneToManySection, buildManyToManySection } from "./row_relation_builder.js";

const IMAGE_PROFILE_KEY = "image";
const ATTACHMENT_PROFILE_KEY = "attachment";

function createFormSection({ key, label, langKey }) {
    const section = document.createElement("section");
    section.className = "row-creation-form__section";
    section.dataset.formSection = "";
    section.dataset.sectionKey = key;
    section.dataset.sectionLabel = label;
    section.dataset.sectionLabelLangKey = langKey;
    return section;
}

function readUploadProfileKey(fieldset) {
    return String(fieldset.dataset.uploadProfile || "").trim().toLowerCase();
}

function readRelationDatasetLangKey(fieldset) {
    if (fieldset.dataset.relationDatasetLangKey) {
        return fieldset.dataset.relationDatasetLangKey;
    }
    const translatedLegendParts = Array.from(
        fieldset.querySelectorAll("legend [data-lang-key]")
    );
    return translatedLegendParts.at(-1)?.dataset.langKey || "details";
}

function relationPageLabel(fieldset) {
    const uploadProfileKey = readUploadProfileKey(fieldset);
    if (uploadProfileKey === IMAGE_PROFILE_KEY) {
        return {
            label: "Images",
            langKey: "row_article_section_images",
        };
    }
    if (uploadProfileKey === ATTACHMENT_PROFILE_KEY) {
        return {
            label: "Attachments",
            langKey: "row_article_section_attachments",
        };
    }

    const datasetLangKey = readRelationDatasetLangKey(fieldset);
    return {
        label: datasetLangKey,
        langKey: datasetLangKey,
    };
}

function appendRelationPages(form, relationContainer, startIndex = 0) {
    const relationFieldsets = Array.from(relationContainer.children);
    relationFieldsets.forEach((fieldset, index) => {
        if (!(fieldset instanceof HTMLFieldSetElement)) return;
        const pageLabel = relationPageLabel(fieldset);
        const section = createFormSection({
            key: `relation-${startIndex + index + 1}`,
            ...pageLabel,
        });
        fieldset.classList.add("row-creation-form__relation-fieldset");
        section.appendChild(fieldset);
        form.appendChild(section);
    });
    return startIndex + relationFieldsets.length;
}

/**
 * Builds a complete row-creation form before the modal is shown.
 * The first page owns base fields and every related element receives its own page.
 * Awaiting relation metadata keeps page order stable and prevents late DOM insertion.
 */
export async function buildMainForm(
    table_name,
    columns,
    oneToManyRelations,
    manyToManyInfos,
    modal_form_state
) {
    const form = document.createElement("form");
    form.id = "add_row_form";
    form.dataset.testid = "add-row-form";
    form.dataset.formSectionNavigator = "";
    form.dataset.formSectionNextLangKey = "next";
    form.dataset.formSectionNextLabel = "Next";
    form.classList.add("row-creation-form");

    const detailsSection = createFormSection({
        key: "details",
        label: "Details",
        langKey: "details",
    });
    form.appendChild(detailsSection);

    for (const column of columns) {
        if (column.foreign_table_name) {
            buildForeignKeyField(detailsSection, table_name, column, modal_form_state);
        } else {
            buildRegularField(detailsSection, table_name, column, modal_form_state);
        }
    }

    const oneToManyContainer = document.createElement("div");
    const manyToManyContainer = document.createElement("div");
    modal_form_state["_childRowsArray"] = [];
    modal_form_state["_manyToManyRows"] = [];
    await Promise.all([
        buildOneToManySection(
            oneToManyContainer,
            oneToManyRelations,
            modal_form_state
        ),
        buildManyToManySection(
            manyToManyContainer,
            manyToManyInfos,
            modal_form_state
        ),
    ]);
    const nextRelationIndex = appendRelationPages(form, oneToManyContainer);
    appendRelationPages(form, manyToManyContainer, nextRelationIndex);

    return form;
}
