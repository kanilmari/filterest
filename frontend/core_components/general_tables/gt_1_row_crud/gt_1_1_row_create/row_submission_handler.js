// row_submission_handler.js
// Handles add-row form actions, submission flow, and success cleanup.
// Bridges modal UI events, endpoint submission, translations, and dataset refresh behavior.
// Exists to keep row-creation submit/cancel behavior out of the form-building layer.

import { hideModal } from "../../../../reusable_components/modal/modal_builder.js";
import { refreshTableUnified } from "../gt_1_2_row_read/table_refresh_unified.js";
import { endpoint_router } from "../../../endpoints/endpoint_router.js";
import { getDatasetNameByUID } from "./row_api_fetcher.js";
import { showSuccessToast } from "../../../../reusable_components/notifications/toast_notification_printer.js";
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

/** Lomakkeen submit: lähetetään pään data, lapsidatat ja M2M-liitokset backendille */
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

    let finalM2M = [];
    if (
        modal_form_state["_manyToManyRows"] &&
        modal_form_state["_manyToManyRows"].length > 0
    ) {
        for (let m2m of modal_form_state["_manyToManyRows"]) {
            const modeInputs = form.querySelectorAll(
                `input[name="${m2m.modeRadioName}"]`
            );
            let selectedMode = "existing";
            modeInputs.forEach((radio) => {
                if (radio.checked) {
                    selectedMode = radio.value;
                }
            });

            if (selectedMode === "existing") {
                const existingVal = m2m.existingHiddenInput.value;
                if (existingVal) {
                    finalM2M.push({
                        linkDatasetName: m2m.linkTableName,
                        mainDatasetFkColumn: m2m.mainTableFkColumn,
                        thirdDatasetName: m2m.thirdTableName,
                        thirdDatasetFkColumn: m2m.thirdTableFkColumn,
                        selectedValue: existingVal,
                        isNewRow: false,
                    });
                }
            } else {
                const newData = m2m.newRowState.data || {};
                if (Object.keys(newData).length > 0) {
                    finalM2M.push({
                        linkDatasetName: m2m.linkTableName,
                        mainDatasetFkColumn: m2m.mainTableFkColumn,
                        thirdDatasetName: m2m.thirdTableName,
                        thirdDatasetFkColumn: m2m.thirdTableFkColumn,
                        isNewRow: true,
                        newRowData: newData,
                    });
                }
            }
        }
    }
    if (finalM2M.length > 0) {
        mainData["_manyToMany"] = finalM2M;
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

    if (child._actualFileObject) {
        return true;
    }

    if (!child.data || typeof child.data !== "object") {
        return false;
    }

    return Object.values(child.data).some((value) => {
        if (value === null || value === undefined) {
            return false;
        }
        if (typeof value === "string") {
            return value.trim() !== "";
        }
        return true;
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
