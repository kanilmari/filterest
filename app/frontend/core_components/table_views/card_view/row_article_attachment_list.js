// row_article_attachment_list.js
// Attachment list + inline upload actions for the article view.
// Bridges attachment child rows, upload permissions, and storage links inside the article.
// Exists to make the new attachment-linking contract usable for end users, not only admins.

import {
    buildAcceptAttribute,
    buildAttachmentMeta,
    buildAttachmentUploadMeta,
    classifyAttachmentKind,
    filterAttachmentRows,
    filterUploadableAttachmentFiles,
    resolveAttachmentDescription,
    resolveAttachmentDisplayName,
    resolveAttachmentDownloadName,
    resolveAttachmentKind,
    resolveAttachmentOriginalName,
} from "./row_article_attachment_metadata.js";
import {
    buildPdfThumbnail,
    canPreviewAttachment,
    createAttachmentPreviewPanel,
} from "./row_article_attachment_preview.js";
// Preserve the public attachment helper imports used by existing callers and specs.
export {
    buildAcceptAttribute,
    classifyAttachmentKind,
    filterAttachmentRows,
    filterUploadableAttachmentFiles,
    formatAttachmentSize,
    resolveAttachmentDescription,
    resolveAttachmentDisplayName,
    resolveAttachmentDownloadName,
    resolveAttachmentKind,
    resolveAttachmentOriginalName,
} from "./row_article_attachment_metadata.js";
export { buildPdfPreviewSrc, buildPdfThumbnailSrc, canPreviewAttachment } from "./row_article_attachment_preview.js";

import { endpoint_router } from "../../endpoints/endpoint_router.js";
import {
    hasDatasetPermission,
    primeDatasetPermissions,
} from "../../route_permission_checker.js";
import { resolveImagePath } from "./row_article_content_builder_helpers.js";
import { getTranslationForKey } from "../../lang/translation_handler.js";
import {
    showErrorToast,
    showSuccessToast,
    showWarningToast,
} from "../../../reusable_components/notifications/toast_notification_printer.js";
import { showConfirmModal } from "../../../reusable_components/modal/confirm_modal_builder.js";

/**
 * Builds the attachment section for an article view.
 *
 * @param {string} parentTableName
 * @param {number|string} parentRowId
 * @param {Object|null} childTableData
 * @param {() => Promise<void>|void} onAttachmentChanged
 * @param {{ linkingStatus?: object|null }} [options]
 * @returns {Promise<HTMLElement|null>}
 */
export async function buildRowArticleAttachmentList(parentTableName, parentRowId, childTableData, onAttachmentChanged, options = {}) {
    const hasProvidedLinkingStatus = Object.prototype.hasOwnProperty.call(options, "linkingStatus");
    const attachmentLinking = hasProvidedLinkingStatus
        ? options.linkingStatus
        : await fetchAttachmentLinking(parentTableName);
    const rows = filterAttachmentRows(
        childTableData?.rows || [],
        attachmentLinking?.asset_kinds
    );
    const attachmentEnabled = attachmentLinking?.enabled === true;

    if (!attachmentEnabled && rows.length === 0) {
        return null;
    }

    const childDataset = childTableData?.dataset || attachmentLinking?.child_table || "";
    const fkColumn = childTableData?.column
        || attachmentLinking?.foreign_key_column
        || (childDataset ? `${parentTableName}_id` : "");
    if (childDataset) {
        void primeDatasetPermissions(childDataset, [
            "/api/add-row-multipart",
            "/api/delete-rows",
            "/api/update-row",
        ]);
    }
    const [
        canUpload,
        canDelete,
        canEditMetadata,
    ] = childDataset
        ? await Promise.all([
            attachmentEnabled && Boolean(fkColumn)
                ? hasDatasetPermission("/api/add-row-multipart", childDataset)
                : Promise.resolve(false),
            rows.length > 0
                ? hasDatasetPermission("/api/delete-rows", childDataset)
                : Promise.resolve(false),
            rows.length > 0
                ? hasDatasetPermission("/api/update-row", childDataset)
                : Promise.resolve(false),
        ])
        : [false, false, false];

    const section = document.createElement("section");
    section.classList.add("big_card_attachment_list", "row_article_attachment_list");
    section.dataset.testid = "big-card-attachments";
    if (canUpload) {
        section.classList.add("is-uploadable");
    }

    const header = document.createElement("div");
    header.classList.add("big_card_attachment_header");

    const titleBlock = document.createElement("div");
    titleBlock.classList.add("big_card_attachment_title_block");

    const title = document.createElement("h2");
    title.classList.add("big_card_attachment_title");
    title.textContent = getTranslationForKey("attachments") || "Liitteet";
    titleBlock.appendChild(title);

    const countBadge = document.createElement("span");
    countBadge.classList.add("big_card_attachment_count");
    countBadge.dataset.testid = "big-card-attachments-count";
    countBadge.textContent = String(rows.length);
    titleBlock.appendChild(countBadge);
    header.appendChild(titleBlock);

    const actions = document.createElement("div");
    actions.classList.add("big_card_attachment_header_actions");

    const maxSizeMB = Number(attachmentLinking?.max_file_size_mb || 0);
    const allowedFileTypes = Array.isArray(attachmentLinking?.allowed_file_types)
        ? attachmentLinking.allowed_file_types
        : [];

    const uploadAttachments = async (files = []) => {
        const { acceptedFiles, rejectedBySize, rejectedByType } = filterUploadableAttachmentFiles(files, {
            allowedFileTypes,
            maxFileSizeMB: maxSizeMB,
        });

        if (acceptedFiles.length === 0) {
            if (rejectedBySize.length > 0) {
                showWarningToast(
                    getTranslationForKey("max_file_size")
                    || `Tiedoston maksimikoko on ${maxSizeMB} MB.`
                );
            } else if (rejectedByType.length > 0) {
                showWarningToast(
                    getTranslationForKey("unsupported_file_type")
                    || "Valittu tiedostotyyppi ei ole sallittu."
                );
            }
            return;
        }

        if (rejectedBySize.length > 0) {
            showWarningToast(
                getTranslationForKey("max_file_size")
                || `Osa tiedostoista ohitettiin, koska maksimikoko on ${maxSizeMB} MB.`
            );
        } else if (rejectedByType.length > 0) {
            showWarningToast(
                getTranslationForKey("unsupported_file_type")
                || "Osa tiedostoista ohitettiin, koska tiedostotyyppi ei ole sallittu."
            );
        }

        uploadButton.disabled = true;
        uploadButton.textContent = acceptedFiles.length > 1 ? "Lisätään liitteitä..." : "Lisätään liite...";
        section.classList.add("is-uploading");
        try {
            for (const file of acceptedFiles) {
                await uploadAttachmentFile({
                    file,
                    childDataset,
                    fkColumn,
                    parentRowId,
                });
            }
            showSuccessToast(
                acceptedFiles.length === 1
                    ? (getTranslationForKey("save_success") || "Liite lisätty.")
                    : `${acceptedFiles.length} ${(getTranslationForKey("attachments") || "liitettä").toLowerCase()} lisätty.`
            );
            if (onAttachmentChanged) {
                await onAttachmentChanged();
            }
        } catch (err) {
            console.warn("attachment upload failed:", err?.message || err);
            showErrorToast(getTranslationForKey("save_failed") || "Liitteen lisäys ei onnistunut.");
        } finally {
            section.classList.remove("is-uploading");
            uploadButton.disabled = false;
            uploadButton.textContent = getTranslationForKey("add_attachment") || "Lisää liite";
        }
    };

    let uploadButton = null;
    let uploadSurface = null;
    if (canUpload) {
        uploadButton = document.createElement("button");
        uploadButton.type = "button";
        uploadButton.classList.add("fw-btn", "big_card_attachment_add");
        uploadButton.dataset.testid = "big-card-attachments-add";
        uploadButton.textContent = getTranslationForKey("add_attachment") || "Lisää liite";

        const input = document.createElement("input");
        input.type = "file";
        input.multiple = true;
        input.hidden = true;
        input.dataset.testid = "big-card-attachments-input";
        input.accept = buildAcceptAttribute(allowedFileTypes);

        input.addEventListener("change", async () => {
            const files = Array.from(input.files || []);
            input.value = "";
            if (files.length === 0) {
                return;
            }
            await uploadAttachments(files);
        });

        uploadButton.addEventListener("click", () => input.click());
        actions.append(uploadButton, input);

        uploadSurface = document.createElement("button");
        uploadSurface.type = "button";
        uploadSurface.classList.add("big_card_attachment_dropzone");
        uploadSurface.dataset.testid = "big-card-attachments-dropzone";
        uploadSurface.textContent = rows.length === 0
            ? "Pudota liitteet tähän tai valitse tiedostot"
            : "Raahaa lisää liitteitä tähän";
        uploadSurface.addEventListener("click", () => input.click());

        const uploadMeta = document.createElement("span");
        uploadMeta.classList.add("big_card_attachment_dropzone_meta");
        uploadMeta.textContent = buildAttachmentUploadMeta({
            allowedFileTypes,
            maxFileSizeMB: maxSizeMB,
        });
        uploadSurface.appendChild(uploadMeta);

        uploadSurface.addEventListener("dragover", (event) => {
            event.preventDefault();
            uploadSurface.classList.add("is-drag-over");
        });
        uploadSurface.addEventListener("dragleave", (event) => {
            if (!uploadSurface.contains(event.relatedTarget)) {
                uploadSurface.classList.remove("is-drag-over");
            }
        });
        uploadSurface.addEventListener("drop", async (event) => {
            event.preventDefault();
            uploadSurface.classList.remove("is-drag-over");
            const files = Array.from(event.dataTransfer?.files || []);
            await uploadAttachments(files);
        });
    }

    header.appendChild(actions);
    section.appendChild(header);
    if (uploadSurface) {
        section.appendChild(uploadSurface);
    }

    const items = document.createElement("div");
    items.classList.add("big_card_attachment_items");
    const previewPanel = createAttachmentPreviewPanel();

    if (rows.length === 0) {
        const empty = document.createElement("div");
        empty.classList.add("big_card_attachment_empty");
        empty.dataset.testid = "big-card-attachments-empty";
        empty.textContent = canUpload
            ? "Ei liitteitä vielä. Pudota tiedostot tähän tai valitse ne napista."
            : (getTranslationForKey("no_attachments") || "Ei liitteitä");
        items.appendChild(empty);
        section.appendChild(items);
        section.appendChild(previewPanel.element);
        return section;
    }

    rows.forEach((row, index) => {
        items.appendChild(buildAttachmentRow({
            row,
            rowIndex: index,
            childDataset,
            canDelete,
            canEditMetadata,
            onAttachmentChanged,
            onPreviewRequested: ({ row: previewRow, href, triggerButton }) => {
                previewPanel.toggle({ row: previewRow, href, triggerButton });
            },
        }));
    });

    section.appendChild(items);
    section.appendChild(previewPanel.element);
    return section;
}

async function uploadAttachmentFile({ file, childDataset, fkColumn, parentRowId }) {
    const formData = new FormData();
    formData.append("jsonPayload", JSON.stringify({
        [fkColumn]: parentRowId,
        filename: file.name,
        original_name: file.name,
        mime_type: file.type || "",
        size_bytes: file.size,
        asset_kind: classifyAttachmentKind(file.name, file.type),
    }));
    formData.append("file_child_0", file);

    await endpoint_router("addRowMultipart", {
        method: "POST",
        url_params: `?dataset=${childDataset}`,
        body_data: formData,
    });
}

async function fetchAttachmentLinking(parentTableName) {
    try {
        const payload = await endpoint_router("assetLinkingStatus", {
            url_params: `?table=${encodeURIComponent(parentTableName)}`,
        });
        return Array.isArray(payload?.attachment_asset_linkings)
            ? payload.attachment_asset_linkings[0] || null
            : null;
    } catch (err) {
        console.warn("attachment linking status fetch failed:", err?.message || err);
        return null;
    }
}

function buildAttachmentRow({ row, rowIndex, childDataset, canDelete, canEditMetadata, onAttachmentChanged, onPreviewRequested }) {
    const item = document.createElement("article");
    item.classList.add("big_card_attachment_item");
    item.dataset.testid = `big-card-attachment-item-${rowIndex}`;
    const href = row?.filename ? resolveImagePath(String(row.filename)) : "";
    const previewable = canPreviewAttachment(row, href);

    if (previewable) {
        item.classList.add("has-pdf-thumbnail");
        item.appendChild(buildPdfThumbnail({
            row,
            rowIndex,
            href,
            onPreviewRequested,
        }));
    }

    const details = document.createElement("div");
    details.classList.add("big_card_attachment_details");

    const topLine = document.createElement("div");
    topLine.classList.add("big_card_attachment_topline");

    const kind = document.createElement("span");
    kind.classList.add("big_card_attachment_kind");
    kind.textContent = (resolveAttachmentKind(row) || "file").toUpperCase();
    topLine.appendChild(kind);

    const name = document.createElement("a");
    name.classList.add("big_card_attachment_name");
    name.dataset.testid = `big-card-attachment-open-${rowIndex}`;
    name.textContent = resolveAttachmentDisplayName(row);
    if (href) {
        name.href = href;
        name.target = "_blank";
        name.rel = "noopener";
    } else {
        name.href = "#";
        name.addEventListener("click", (event) => event.preventDefault());
    }
    topLine.appendChild(name);

    details.appendChild(topLine);

    const meta = document.createElement("div");
    meta.classList.add("big_card_attachment_meta");
    meta.textContent = buildAttachmentMeta(row);
    details.appendChild(meta);

    const descriptionText = resolveAttachmentDescription(row);
    if (descriptionText) {
        const description = document.createElement("p");
        description.classList.add("big_card_attachment_description");
        description.textContent = descriptionText;
        details.appendChild(description);
    }

    const actionBar = document.createElement("div");
    actionBar.classList.add("big_card_attachment_actions");

    if (href) {
        if (previewable) {
            const preview = document.createElement("button");
            preview.type = "button";
            preview.classList.add("fw-btn", "fw-btn--ghost", "big_card_attachment_preview");
            preview.dataset.testid = `big-card-attachment-preview-${rowIndex}`;
            preview.textContent = getTranslationForKey("preview") || "Esikatsele";
            preview.addEventListener("click", () => {
                onPreviewRequested?.({
                    row,
                    href,
                    triggerButton: preview,
                });
            });
            actionBar.appendChild(preview);
        }

        const open = document.createElement("a");
        open.classList.add("fw-btn", "fw-btn--ghost", "big_card_attachment_open");
        open.dataset.testid = `big-card-attachment-open-button-${rowIndex}`;
        open.textContent = getTranslationForKey("open") || "Avaa";
        open.href = href;
        open.target = "_blank";
        open.rel = "noopener";
        actionBar.appendChild(open);

        const download = document.createElement("a");
        download.classList.add("fw-btn", "fw-btn--ghost", "big_card_attachment_download");
        download.dataset.testid = `big-card-attachment-download-${rowIndex}`;
        download.textContent = getTranslationForKey("download") || "Lataa";
        download.href = href;
        download.download = resolveAttachmentDownloadName(row);
        actionBar.appendChild(download);
    }

    const editorController = canEditMetadata && row?.id != null && childDataset
        ? createAttachmentMetadataEditor({
            item,
            row,
            rowIndex,
            childDataset,
            onAttachmentChanged,
        })
        : null;

    if (editorController) {
        actionBar.appendChild(editorController.editButton);
    }

    if (canDelete && row?.id != null) {
        const remove = document.createElement("button");
        remove.type = "button";
        remove.classList.add("fw-btn", "fw-btn--ghost", "big_card_attachment_delete");
        remove.dataset.testid = `big-card-attachment-delete-${rowIndex}`;
        remove.textContent = getTranslationForKey("delete") || "Poista";
        remove.addEventListener("click", async () => {
            const itemName = resolveAttachmentDisplayName(row);
            const ok = await showConfirmModal({
                titleLangKey: "delete_confirm_title",
                titlePlainText: "Vahvista poisto",
                messageLangKey: "confirm_delete_attachment",
                messagePlainText: "Delete this attachment?",
                confirmLangKey: "delete",
                confirmText: "Poista",
                cancelLangKey: "dont_delete",
                cancelText: "Älä poista",
                isDanger: true,
                itemNames: [itemName],
            });
            if (!ok) return;

            try {
                remove.disabled = true;
                item.classList.add("is-removing");
                await endpoint_router("deleteRows", {
                    method: "POST",
                    url_params: `?dataset=${childDataset}`,
                    body_data: { ids: [row.id] },
                });
                showSuccessToast(getTranslationForKey("delete_success") || "Liite poistettu.");
                if (onAttachmentChanged) {
                    await onAttachmentChanged();
                }
            } catch (err) {
                console.warn("attachment delete failed:", err?.message || err);
                showErrorToast(getTranslationForKey("delete_failed") || "Liitteen poisto ei onnistunut.");
            } finally {
                item.classList.remove("is-removing");
                remove.disabled = false;
            }
        });
        actionBar.appendChild(remove);
    }

    item.append(details, actionBar);
    if (editorController) {
        item.appendChild(editorController.editor);
    }
    return item;
}

function createAttachmentMetadataEditor({ item, row, rowIndex, childDataset, onAttachmentChanged }) {
    const editButton = document.createElement("button");
    editButton.type = "button";
    editButton.classList.add("fw-btn", "fw-btn--ghost", "big_card_attachment_edit");
    editButton.dataset.testid = `big-card-attachment-edit-${rowIndex}`;
    editButton.textContent = getTranslationForKey("edit") || "Muokkaa";

    const editor = document.createElement("form");
    editor.classList.add("big_card_attachment_editor");
    editor.dataset.testid = `big-card-attachment-editor-${rowIndex}`;
    editor.hidden = true;

    const titleLabel = document.createElement("label");
    titleLabel.classList.add("big_card_attachment_editor_field");
    const titleCaption = document.createElement("span");
    titleCaption.classList.add("big_card_attachment_editor_label");
    titleCaption.textContent = getTranslationForKey("title") || "Otsikko";
    const titleInput = document.createElement("input");
    titleInput.type = "text";
    titleInput.classList.add("big_card_attachment_editor_input");
    titleInput.dataset.testid = `big-card-attachment-title-input-${rowIndex}`;
    titleInput.value = String(row?.title || "");
    titleLabel.append(titleCaption, titleInput);

    const descriptionLabel = document.createElement("label");
    descriptionLabel.classList.add("big_card_attachment_editor_field");
    const descriptionCaption = document.createElement("span");
    descriptionCaption.classList.add("big_card_attachment_editor_label");
    descriptionCaption.textContent = getTranslationForKey("description") || "Kuvaus";
    const descriptionInput = document.createElement("textarea");
    descriptionInput.classList.add("big_card_attachment_editor_textarea");
    descriptionInput.dataset.testid = `big-card-attachment-description-input-${rowIndex}`;
    descriptionInput.rows = 3;
    descriptionInput.value = String(row?.description || "");
    descriptionLabel.append(descriptionCaption, descriptionInput);

    const helper = document.createElement("p");
    helper.classList.add("big_card_attachment_editor_helper");
    helper.textContent = resolveAttachmentOriginalName(row)
        ? `Tiedoston nimi: ${resolveAttachmentOriginalName(row)}`
        : "Muokkaa liitteen otsikkoa ja kuvausta.";

    const actionRow = document.createElement("div");
    actionRow.classList.add("big_card_attachment_editor_actions");

    const saveButton = document.createElement("button");
    saveButton.type = "submit";
    saveButton.classList.add("fw-btn", "big_card_attachment_editor_save");
    saveButton.dataset.testid = `big-card-attachment-save-${rowIndex}`;
    saveButton.textContent = getTranslationForKey("save") || "Tallenna";

    const cancelButton = document.createElement("button");
    cancelButton.type = "button";
    cancelButton.classList.add("fw-btn", "fw-btn--ghost", "big_card_attachment_editor_cancel");
    cancelButton.dataset.testid = `big-card-attachment-cancel-${rowIndex}`;
    cancelButton.textContent = getTranslationForKey("cancel_changes") || "Peruuta muutokset";

    actionRow.append(saveButton, cancelButton);
    editor.append(titleLabel, descriptionLabel, helper, actionRow);

    const openEditor = () => {
        editor.hidden = false;
        item.classList.add("is-editing");
        editButton.disabled = true;
        titleInput.focus();
        titleInput.select();
    };

    const closeEditor = () => {
        editor.hidden = true;
        item.classList.remove("is-editing");
        editButton.disabled = false;
        titleInput.value = String(row?.title || "");
        descriptionInput.value = String(row?.description || "");
    };

    cancelButton.addEventListener("click", closeEditor);
    editButton.addEventListener("click", openEditor);

    editor.addEventListener("submit", async (event) => {
        event.preventDefault();

        const nextTitle = titleInput.value.trim();
        const nextDescription = descriptionInput.value.trim();
        const currentTitle = String(row?.title || "").trim();
        const currentDescription = String(row?.description || "").trim();

        const updates = [];
        if (nextTitle !== currentTitle) {
            updates.push({ column: "title", value: nextTitle });
        }
        if (nextDescription !== currentDescription) {
            updates.push({ column: "description", value: nextDescription });
        }
        if (updates.length === 0) {
            closeEditor();
            return;
        }

        saveButton.disabled = true;
        cancelButton.disabled = true;
        item.classList.add("is-saving");
        try {
            await endpoint_router("updateRow", {
                method: "POST",
                url_params: `?dataset=${childDataset}`,
                body_data: {
                    id: row.id,
                    updates: updates.map((update) => ({
                        column: update.column,
                        value: update.value,
                    })),
                },
            });
            showSuccessToast(getTranslationForKey("save_success") || "Liite päivitetty.");
            row.title = nextTitle;
            row.description = nextDescription;
            closeEditor();
            if (onAttachmentChanged) {
                await onAttachmentChanged();
            }
        } catch (err) {
            console.warn("attachment update failed:", err?.message || err);
            showErrorToast(getTranslationForKey("save_failed") || "Liitteen päivitys ei onnistunut.");
        } finally {
            item.classList.remove("is-saving");
            saveButton.disabled = false;
            cancelButton.disabled = false;
        }
    });

    return { editButton, editor };
}
