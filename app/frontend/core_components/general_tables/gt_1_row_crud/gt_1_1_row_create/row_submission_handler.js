// row_submission_handler.js
// Handles add-row form actions, submission flow, and success cleanup.
// Bridges modal UI events, endpoint submission, translations, and dataset refresh behavior.
// Exists to keep row-creation submit/cancel behavior out of the form-building layer.

import { mediaLibraryText } from "../../../../reusable_components/media_library_picker/media_library_picker.js";
import { getLanguageWithBrowserFallback } from "../../../state_stores/lang_preference_reader.js";
import { hideModal } from "../../../../reusable_components/modal/modal_builder.js";
import { refreshTableUnified } from "../gt_1_2_row_read/table_refresh_unified.js";
import { endpoint_router } from "../../../endpoints/endpoint_router.js";
import { getDatasetNameByUID } from "./row_api_fetcher.js";
import {
    showSuccessToast,
    showWarningToast,
} from "../../../../reusable_components/notifications/toast_notification_printer.js";
import { getTranslationForKey } from "../../../lang/translation_handler.js";
import { applySelectedFileMetadata, isSharedAssetChildState } from "./row_relation_builder.js";

/** Lisää lomakkeen alalaitaan Peruuta- ja Lisää-painikkeet */
export function appendFormActions(form, table_uid, columns, modal_form_state, clearStateCallback) {
    const form_actions = document.createElement("div");
    form_actions.classList.add("form-actions");

    const cancel_button = document.createElement("button");
    cancel_button.type = "button";
    // cancel_button.textContent = 'Peruuta';
    cancel_button.dataset.langKey = "cancel";
    cancel_button.dataset.testid = "btn-cancel-add-row";
    cancel_button.classList.add("cancel-button");
    cancel_button.addEventListener("click", hideModal);

    const submit_button = document.createElement("button");
    submit_button.type = "submit";
    // submit_button.textContent = 'Lisää';
    submit_button.dataset.langKey = "add";
    submit_button.dataset.testid = "btn-add-row-submit";
    submit_button.classList.add("submit-button");

    form_actions.appendChild(cancel_button);
    form_actions.appendChild(submit_button);
    const formSections = form.querySelectorAll(":scope > section[data-form-section]");
    const finalSection = formSections.item(formSections.length - 1);
    (finalSection || form).appendChild(form_actions);

    form.addEventListener("submit", async (e) => {
        e.preventDefault();
        if (!e.submitter || e.submitter !== submit_button) {
            return;
        }
        await submit_new_row(table_uid, form, columns, modal_form_state, clearStateCallback);
    });
}

/** Lomakkeen submit: lähetetään päärivi, asset-lapset ja olemassa olevien rivien liitokset. */
async function submit_new_row(table_uid, form, columns, modal_form_state, clearStateCallback) {
    const formData = new FormData();

    const mainData = {};
    columns.forEach((column) => {
        let value = form.elements[column.column_name]?.value ?? "";
        if (column.data_type.toLowerCase() === "boolean") {
            value = form.elements[column.column_name].checked;
        }
        mainData[column.column_name] = value;
    });

    const { childRowsToSend, childFiles } = collectChildRowsForSubmission(
        modal_form_state["_childRowsArray"]
    );
    if (childRowsToSend.length > 0) {
        mainData["_childRows"] = childRowsToSend;
    }

    const existingImages = collectExistingImagesForSubmission(modal_form_state["_childRowsArray"]);
    if (existingImages.length > 0) mainData._existingImages = existingImages;

    const existingLinks = collectExistingLinksForSubmission(
        modal_form_state._existingRelationLinks
    );
    if (existingLinks.length > 0) {
        mainData._existingLinks = existingLinks;
    }

    const mainDataJSON = JSON.stringify(mainData);
    formData.append("jsonPayload", mainDataJSON);

    childFiles.forEach((file, index) => {
        if (file) {
            formData.append(`file_child_${index}`, file);
        }
    });

    try {
        const datasetName = getDatasetNameByUID(table_uid);
        await endpoint_router('addRowMultipart', {
            method: 'POST',
            url_params: `?dataset=${datasetName}`,
            body_data: formData,
        });

        showSuccessToast(getTranslationForKey('row_added_successfully') || "Rivi lisätty onnistuneesti!");
        hideModal();
        if (clearStateCallback) clearStateCallback();

        // Uusi "refresh" unifyed-tavalla:
        await refreshTableUnified(datasetName, {
            offsetOverride: 0, // Aloitetaan nollasta, jotta uusi rivi näkyy ylhäältä
            skipUrlParams: true, // Ei huomioida URL-parametreja
        });
    } catch (error) {
        console.warn("virhe uuden rivin lisäämisessä (multipart):", error);
        const reuseError = String(error?.message || "").includes("media_reuse");
        showWarningToast(
            (reuseError ? mediaLibraryText("unavailable", getLanguageWithBrowserFallback, getTranslationForKey) : error?.message)
            || getTranslationForKey("failed_to_save")
            || "The row could not be saved. Check every required language."
        );
    }
}

export function collectChildRowsForSubmission(childRowsArray = []) {
    const childRowsToSend = [];
    const childFiles = [];

    if (!Array.isArray(childRowsArray) || childRowsArray.length === 0) {
        return { childRowsToSend, childFiles };
    }

    childRowsArray.forEach((child) => {
        if (!shouldSubmitChildRow(child)) {
            return;
        }

        expandChildRowsForSubmission(child).forEach((expandedChild) => {
            childRowsToSend.push(expandedChild);
            childFiles.push(expandedChild._actualFileObject || null);
        });
    });

    return { childRowsToSend, childFiles };
}

export function shouldSubmitChildRow(child) {
    if (!child || typeof child !== "object") {
        return false;
    }

    if (isSharedAssetChildState(child)) {
        if (Array.isArray(child._actualFileObjects)) {
            return child._actualFileObjects.length > 0;
        }
        return Boolean(child._actualFileObject);
    }
    if (child.ownedChildKind === "location") {
        return Object.values(child.data || {}).some(hasMeaningfulChildValue);
    }
    return false;
}

function hasMeaningfulChildValue(value) {
    if (value === null || value === undefined) return false;
    if (typeof value === "string") return value.trim() !== "";
    if (Array.isArray(value)) return value.some(hasMeaningfulChildValue);
    if (typeof value === "object") return Object.values(value).some(hasMeaningfulChildValue);
    return true;
}

export function collectExistingLinksForSubmission(existingRelationLinks = []) {
    if (!Array.isArray(existingRelationLinks)) return [];
    return existingRelationLinks.flatMap((relation) => {
        const relationId = Number(relation?.relationId);
        const rowIds = Array.from(new Set(
            (Array.isArray(relation?.rowIds) ? relation.rowIds : [])
                .map((rowId) => Number(rowId))
                .filter((rowId) => Number.isSafeInteger(rowId) && rowId > 0)
        ));
        if (!Number.isSafeInteger(relationId) || relationId <= 0 || rowIds.length === 0) {
            return [];
        }
        return [{
            relationKind: relation.relationKind,
            relationId,
            rowIds,
        }];
    });
}

function expandChildRowsForSubmission(child) {
    const selectedFiles = readSelectedFiles(child);
    if (selectedFiles.length === 0) {
        return [{ ...child }];
    }

    return selectedFiles.map((file) => {
        const safeChild = {
            ...child,
            data: {
                ...(child.data || {}),
            },
            _actualFileObject: file,
        };
        delete safeChild._actualFileObjects;
        applySelectedFileMetadata(safeChild, child.fileUploadSpec, file);
        return safeChild;
    });
}

function readSelectedFiles(child) {
    if (Array.isArray(child?._actualFileObjects) && child._actualFileObjects.length > 0) {
        return child._actualFileObjects.filter(Boolean);
    }
    if (child?._actualFileObject) {
        return [child._actualFileObject];
    }
    return [];
}


// Stored image selections are IDs only; no caller-provided path can bypass the
// server's source authorization and same-dataset audience check.
export function collectExistingImagesForSubmission(children = []) {
    if (!Array.isArray(children)) return [];
    return children.flatMap((child) => {
        const selected = child?._existingImage;
        if (!Number.isSafeInteger(selected?.relation_id) || selected.relation_id <= 0 ||
            !Number.isSafeInteger(selected?.source_row_id) || selected.source_row_id <= 0) return [];
        return [{ relation_id: selected.relation_id, source_row_id: selected.source_row_id }];
    });
}
