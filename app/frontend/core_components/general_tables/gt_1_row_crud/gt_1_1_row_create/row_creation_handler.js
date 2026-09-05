// row_creation_handler.js
// Opens and orchestrates the add-row modal, fetching schema and wiring form submission.
// Bridges row_api_fetcher, row_form_builder, and row_submission_handler into a single flow.
// Exists to keep row-creation orchestration separate from individual build and fetch concerns.

import {
    createModal,
    hideModal,
    showModal,
} from "../../../../reusable_components/modal/modal_builder.js";
import {
    fetchColumnsInfo,
    fetchOneToManyRelations,
    fetchManyToManyInfos,
    getDatasetNameByUID
} from "./row_api_fetcher.js";
import { buildMainForm } from "./row_form_builder.js";
import { appendFormActions } from "./row_submission_handler.js";
import { relationHasEnabledFileUpload } from "./row_existing_relation_builder.js";
import { showWarningToast } from "../../../../reusable_components/notifications/toast_notification_printer.js";
import { getTranslationForKey } from "../../../lang/translation_handler.js";
import { initializeFormSectionNavigator } from "../../../../reusable_components/form_section_navigator/form_section_navigator.js";

// Säilytetään lomakkeen tilaa globaalisti (tässä moduulissa)
let modal_form_state = {};

function clearState() {
    modal_form_state = {};
}

// Auto-resize logiikka kaikille textareille
document.addEventListener("input", (event) => {
    if (event.target.classList.contains("auto_resize_textarea")) {
        event.target.style.height = "auto";
        event.target.style.height = event.target.scrollHeight + "px";
    }
});

/**
 * -----------------------------------------------
 *   OHJAUSFUNKTIO: avaa rivinlisäyslomakkeen
 * -----------------------------------------------
 */
export async function open_add_row_modal(table_uid, table_name) {
    const datasetName = table_name || getDatasetNameByUID(table_uid);
    const modalWidth = "min(850px, calc(100vw - 32px))";
    const loadingStatus = document.createElement("p");
    loadingStatus.dataset.langKey = "loading";
    loadingStatus.textContent = "Loading…";
    loadingStatus.setAttribute("role", "status");
    createModal({
        titleDataLangKey: `add_row_${datasetName}`,
        titleDataLangKeyFallback: "add_row",
        contentElements: [loadingStatus],
        width: modalWidth,
    });
    showModal();

    try {
        // Start the expensive schema read immediately. Relation metadata is
        // cheap; as soon as it arrives, preload only asset-child schemas in
        // parallel with the main schema. Ordinary related datasets no longer
        // need their create schemas because this form only links their rows.
        const columnsRequest = fetchColumnsInfo(table_uid);
        let [oneToManyRelations, manyToManyInfos] = await Promise.all([
            fetchOneToManyRelations(table_uid),
            fetchManyToManyInfos(table_uid),
        ]);
        if (!oneToManyRelations) oneToManyRelations = [];
        if (!manyToManyInfos) manyToManyInfos = [];

        const assetTableUIDs = Array.from(new Set(
            oneToManyRelations
                .filter(relationHasEnabledFileUpload)
                .map((relation) => String(relation.source_table_uid || ""))
                .filter(Boolean)
        ));
        const assetColumnsRequest = Promise.all(assetTableUIDs.map(async (assetTableUID) => [
            assetTableUID,
            await fetchColumnsInfo(assetTableUID),
        ]));
        const [columns_info, assetColumnEntries] = await Promise.all([
            columnsRequest,
            assetColumnsRequest,
        ]);
        const assetColumnsByTableUID = new Map(assetColumnEntries);

        if (!columns_info || columns_info.length === 0) {
            console.warn("No column information received.");
            showWarningToast(
                getTranslationForKey("no_columns_available")
                || "No columns are available for this table."
            );
            hideModal();
            return;
        }

        // 2) Ei enää frontin filtteröintiä – käytetään sellaisenaan backendistä saatuja sarakkeita
        const columns = columns_info;
        if (!columns || columns.length === 0) {
            console.warn("No columns available to display in the modal.");
            showWarningToast(
                getTranslationForKey("no_columns_to_add")
                || "There are no columns available to add."
            );
            hideModal();
            return;
        }

        // 3) Rakennetaan lomake
        const form = await buildMainForm(
            datasetName,
            columns,
            oneToManyRelations,
            manyToManyInfos,
            modal_form_state,
            assetColumnsByTableUID
        );

        // 4) Lomakkeen loppuun painikkeet ja submit
        appendFormActions(form, table_uid, columns, modal_form_state, clearState);
        initializeFormSectionNavigator(form);

        // 5) Korvataan lataustila valmiilla lomakkeella.
        createModal({
            titleDataLangKey: `add_row_${datasetName}`,
            titleDataLangKeyFallback: "add_row",
            contentElements: [form],
            width: modalWidth,
        });
        showModal();
    } catch (error) {
        hideModal();
        console.warn("virhe rivinlisäyslomakkeen lataamisessa:", error);
        showWarningToast(
            getTranslationForKey("failed_to_load")
            || "The add-row form could not be loaded."
        );
    }
}
