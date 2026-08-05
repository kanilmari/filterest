// big_card_attachment_list.js
// Attachment list + inline upload actions for the big card view.
// Bridges attachment child rows, upload permissions, and storage links inside the modal.
// Exists to make the new attachment-linking contract usable for end users, not only admins.

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

const DEFAULT_ATTACHMENT_ASSET_KINDS = ["pdf", "document", "archive"];
const DOCUMENT_EXTENSIONS = new Set([
    "txt", "rtf", "doc", "docx", "odt", "csv", "xls", "xlsx", "ppt", "pptx",
]);
const ARCHIVE_EXTENSIONS = new Set([
    "zip", "rar", "7z", "tar", "gz", "tgz", "bz2", "xz",
]);

/**
 * Builds the attachment section for a big card.
 *
 * @param {string} parentTableName
 * @param {number|string} parentRowId
 * @param {Object|null} childTableData
 * @param {() => Promise<void>|void} onAttachmentChanged
 * @param {{ linkingStatus?: object|null }} [options]
 * @returns {Promise<HTMLElement|null>}
 */
export async function buildAttachmentList(parentTableName, parentRowId, childTableData, onAttachmentChanged, options = {}) {
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

    const title = document.createElement("h3");
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
                messagePlainText: `Poistetaanko liite "${itemName}"?`,
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
    cancelButton.textContent = getTranslationForKey("cancel") || "Peru";

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

function buildPdfThumbnail({ row, rowIndex, href, onPreviewRequested }) {
    const displayName = resolveAttachmentDisplayName(row);
    const thumbnail = document.createElement("button");
    thumbnail.type = "button";
    thumbnail.classList.add("big_card_attachment_thumbnail");
    thumbnail.dataset.testid = `big-card-pdf-thumbnail-${rowIndex}`;
    thumbnail.setAttribute("aria-label", `Esikatsele PDF: ${displayName}`);

    thumbnail.addEventListener("click", () => {
        onPreviewRequested?.({
            row,
            href,
            triggerButton: thumbnail,
        });
    });

    const badge = document.createElement("span");
    badge.classList.add("big_card_attachment_thumbnail_badge");
    badge.textContent = "PDF";
    thumbnail.appendChild(badge);

    const frame = document.createElement("iframe");
    frame.classList.add("big_card_attachment_thumbnail_frame");
    frame.dataset.testid = `big-card-pdf-thumbnail-frame-${rowIndex}`;
    frame.src = buildPdfThumbnailSrc(href);
    frame.title = `PDF thumbnail: ${displayName}`;
    frame.loading = "lazy";
    frame.tabIndex = -1;
    thumbnail.appendChild(frame);

    const label = document.createElement("span");
    label.classList.add("big_card_attachment_thumbnail_label");
    label.textContent = "Avaa esikatselu";
    thumbnail.appendChild(label);

    return thumbnail;
}

export function canPreviewAttachment(row = {}, href = "") {
    return Boolean(href) && resolveAttachmentKind(row) === "pdf";
}

export function buildPdfPreviewSrc(href = "") {
    const normalizedHref = String(href || "").trim();
    if (!normalizedHref) {
        return "";
    }

    if (!normalizedHref.includes("#")) {
        return `${normalizedHref}#toolbar=0&navpanes=0&view=FitH`;
    }

    if (normalizedHref.includes("toolbar=")) {
        return normalizedHref;
    }

    return `${normalizedHref}&toolbar=0&navpanes=0&view=FitH`;
}

export function buildPdfThumbnailSrc(href = "") {
    const previewSrc = buildPdfPreviewSrc(href);
    if (!previewSrc) {
        return "";
    }

    if (previewSrc.includes("#page=")) {
        return previewSrc;
    }

    if (previewSrc.includes("#")) {
        return `${previewSrc}&page=1`;
    }

    return `${previewSrc}#page=1`;
}

function createAttachmentPreviewPanel() {
    const element = document.createElement("section");
    element.classList.add("big_card_attachment_preview_panel");
    element.dataset.testid = "big-card-pdf-preview";
    element.hidden = true;

    let activeHref = "";
    let activeTriggerButton = null;

    const setActiveButton = (button) => {
        if (activeTriggerButton) {
            activeTriggerButton.classList.remove("is-active");
            activeTriggerButton.setAttribute("aria-pressed", "false");
        }
        activeTriggerButton = button || null;
        if (activeTriggerButton) {
            activeTriggerButton.classList.add("is-active");
            activeTriggerButton.setAttribute("aria-pressed", "true");
        }
    };

    const hide = () => {
        element.hidden = true;
        element.replaceChildren();
        activeHref = "";
        setActiveButton(null);
    };

    const show = ({ row, href, triggerButton }) => {
        const displayName = resolveAttachmentDisplayName(row);
        const frameSrc = buildPdfPreviewSrc(href);

        element.hidden = false;
        element.replaceChildren();
        activeHref = href;
        setActiveButton(triggerButton);

        const header = document.createElement("div");
        header.classList.add("big_card_attachment_preview_header");

        const titleBlock = document.createElement("div");
        titleBlock.classList.add("big_card_attachment_preview_title_block");

        const title = document.createElement("h4");
        title.classList.add("big_card_attachment_preview_title");
        title.textContent = displayName;
        titleBlock.appendChild(title);

        const meta = document.createElement("div");
        meta.classList.add("big_card_attachment_preview_meta");
        meta.textContent = buildAttachmentMeta(row);
        titleBlock.appendChild(meta);
        header.appendChild(titleBlock);

        const headerActions = document.createElement("div");
        headerActions.classList.add("big_card_attachment_preview_actions");

        const open = document.createElement("a");
        open.classList.add("fw-btn", "big_card_attachment_preview_open");
        open.dataset.testid = "big-card-pdf-preview-open";
        open.textContent = getTranslationForKey("open") || "Avaa";
        open.href = href;
        open.target = "_blank";
        open.rel = "noopener";

        const download = document.createElement("a");
        download.classList.add("fw-btn", "fw-btn--ghost", "big_card_attachment_preview_download");
        download.dataset.testid = "big-card-pdf-preview-download";
        download.textContent = getTranslationForKey("download") || "Lataa";
        download.href = href;
        download.download = resolveAttachmentDownloadName(row);

        const close = document.createElement("button");
        close.type = "button";
        close.classList.add("fw-btn", "fw-btn--ghost", "big_card_attachment_preview_close");
        close.dataset.testid = "big-card-pdf-preview-close";
        close.textContent = getTranslationForKey("close") || "Sulje";
        close.addEventListener("click", hide);

        headerActions.append(open, download, close);
        header.appendChild(headerActions);
        element.appendChild(header);

        const frame = document.createElement("iframe");
        frame.classList.add("big_card_attachment_preview_frame");
        frame.dataset.testid = "big-card-pdf-preview-frame";
        frame.src = frameSrc;
        frame.title = `PDF preview: ${displayName}`;
        frame.loading = "lazy";
        element.appendChild(frame);

        const hint = document.createElement("p");
        hint.classList.add("big_card_attachment_preview_hint");
        hint.textContent = "Jos esikatselu ei näy, avaa PDF uuteen välilehteen tai lataa se.";
        element.appendChild(hint);
    };

    return {
        element,
        hide,
        toggle({ row, href, triggerButton }) {
            if (!canPreviewAttachment(row, href)) {
                return;
            }
            if (!element.hidden && activeHref === href) {
                hide();
                return;
            }
            show({ row, href, triggerButton });
        },
    };
}

export function filterAttachmentRows(rows = [], allowedKinds = DEFAULT_ATTACHMENT_ASSET_KINDS) {
    const allowed = new Set(
        (Array.isArray(allowedKinds) && allowedKinds.length > 0
            ? allowedKinds
            : DEFAULT_ATTACHMENT_ASSET_KINDS
        ).map((value) => String(value).toLowerCase())
    );

    return rows.filter((row) => {
        const rawKind = row?.asset_kind == null ? "" : String(row.asset_kind).trim().toLowerCase();
        if (!rawKind) return true;
        return allowed.has(rawKind);
    }).sort(compareAttachmentRows);
}

export function classifyAttachmentKind(fileName = "", mimeType = "") {
    const ext = extractFileExtension(fileName);
    const normalizedMime = String(mimeType || "").toLowerCase();

    if (normalizedMime === "application/pdf" || ext === "pdf") {
        return "pdf";
    }
    if (ARCHIVE_EXTENSIONS.has(ext) || normalizedMime.includes("zip") || normalizedMime.includes("compressed")) {
        return "archive";
    }
    if (DOCUMENT_EXTENSIONS.has(ext) || normalizedMime.startsWith("text/") || normalizedMime.includes("document")) {
        return "document";
    }
    return "document";
}

export function resolveAttachmentKind(row = {}) {
    if (row?.asset_kind) {
        return String(row.asset_kind).trim().toLowerCase();
    }
    return classifyAttachmentKind(
        resolveAttachmentDisplayName(row),
        row?.mime_type || ""
    );
}

export function resolveAttachmentDisplayName(row = {}) {
    const preferred = [row?.title, row?.original_name, row?.filename];
    const found = preferred.find((value) => typeof value === "string" && value.trim() !== "");
    return found ? found.trim() : "attachment";
}

export function resolveAttachmentOriginalName(row = {}) {
    const preferred = [row?.original_name, row?.filename];
    const found = preferred.find((value) => typeof value === "string" && value.trim() !== "");
    return found ? found.trim() : "";
}

export function resolveAttachmentDescription(row = {}) {
    return typeof row?.description === "string" ? row.description.trim() : "";
}

export function resolveAttachmentDownloadName(row = {}) {
    const displayName = resolveAttachmentDisplayName(row);
    const originalName = resolveAttachmentOriginalName(row);
    const originalExtension = extractFileExtension(originalName);

    if (!displayName || displayName === "attachment") {
        return originalName || displayName;
    }
    if (!originalExtension || hasFilenameExtension(displayName)) {
        return displayName;
    }
    return `${displayName}.${originalExtension}`;
}

export function formatAttachmentSize(sizeBytes) {
    const size = Number(sizeBytes);
    if (!Number.isFinite(size) || size <= 0) {
        return "";
    }
    if (size < 1024) {
        return `${size} B`;
    }
    if (size < 1024 * 1024) {
        return `${(size / 1024).toFixed(1)} KB`;
    }
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function buildAcceptAttribute(allowedFileTypes = []) {
    if (!Array.isArray(allowedFileTypes) || allowedFileTypes.length === 0) {
        return "";
    }
    return allowedFileTypes
        .map((ext) => String(ext).trim().replace(/^\./u, ""))
        .filter(Boolean)
        .map((ext) => `.${ext}`)
        .join(",");
}

export function filterUploadableAttachmentFiles(files = [], options = {}) {
    const normalizedFiles = Array.from(files || []).filter(Boolean);
    const allowedExtensions = new Set(extractAllowedFileExtensions(options.allowedFileTypes));
    const maxFileSizeMB = Number(options.maxFileSizeMB || 0);

    return normalizedFiles.reduce((acc, file) => {
        if (!matchesAllowedAttachmentFile(file, allowedExtensions)) {
            acc.rejectedByType.push(file);
            return acc;
        }
        if (maxFileSizeMB > 0 && file.size / (1024 * 1024) > maxFileSizeMB) {
            acc.rejectedBySize.push(file);
            return acc;
        }
        acc.acceptedFiles.push(file);
        return acc;
    }, {
        acceptedFiles: [],
        rejectedByType: [],
        rejectedBySize: [],
    });
}

function buildAttachmentMeta(row = {}) {
    const parts = [];
    const mimeType = typeof row?.mime_type === "string" ? row.mime_type.trim() : "";
    const formattedSize = formatAttachmentSize(row?.size_bytes);
    const originalName = resolveAttachmentOriginalName(row);
    const displayName = resolveAttachmentDisplayName(row);

    if (originalName && displayName && originalName !== displayName) parts.push(originalName);
    if (mimeType) parts.push(mimeType);
    if (formattedSize) parts.push(formattedSize);

    return parts.length > 0 ? parts.join(" · ") : "Tiedosto";
}

function buildAttachmentUploadMeta({ allowedFileTypes = [], maxFileSizeMB = 0 } = {}) {
    const parts = [];
    const allowed = Array.isArray(allowedFileTypes)
        ? allowedFileTypes
            .map((ext) => String(ext || "").trim().replace(/^\./u, "").toUpperCase())
            .filter(Boolean)
        : [];
    if (allowed.length > 0) {
        parts.push(allowed.join(", "));
    }
    if (maxFileSizeMB > 0) {
        parts.push(`max ${maxFileSizeMB} MB`);
    }
    return parts.join(" · ");
}

function extractFileExtension(fileName = "") {
    const trimmed = String(fileName || "").trim().toLowerCase();
    const parts = trimmed.split(".");
    return parts.length > 1 ? parts.pop() : "";
}

function hasFilenameExtension(fileName = "") {
    return extractFileExtension(fileName) !== "";
}

function extractAllowedFileExtensions(allowedFileTypes = []) {
    return Array.isArray(allowedFileTypes)
        ? allowedFileTypes
            .map((ext) => String(ext || "").trim().replace(/^\./u, "").toLowerCase())
            .filter(Boolean)
        : [];
}

function matchesAllowedAttachmentFile(file, allowedExtensions) {
    if (!(allowedExtensions instanceof Set) || allowedExtensions.size === 0) {
        return true;
    }

    const extension = extractFileExtension(file?.name || "");
    return Boolean(extension) && allowedExtensions.has(extension);
}

function compareAttachmentRows(left = {}, right = {}) {
    const sortOrderDelta = normalizeAttachmentSortOrder(left?.sort_order) - normalizeAttachmentSortOrder(right?.sort_order);
    if (sortOrderDelta !== 0) {
        return sortOrderDelta;
    }

    const createdDelta = normalizeAttachmentTimestamp(left?.created) - normalizeAttachmentTimestamp(right?.created);
    if (createdDelta !== 0) {
        return createdDelta;
    }

    const idDelta = normalizeAttachmentNumericID(left?.id) - normalizeAttachmentNumericID(right?.id);
    if (idDelta !== 0) {
        return idDelta;
    }

    return resolveAttachmentDisplayName(left).localeCompare(resolveAttachmentDisplayName(right));
}

function normalizeAttachmentSortOrder(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
}

function normalizeAttachmentTimestamp(value) {
    if (typeof value === "number" && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === "string" && value.trim() !== "") {
        const parsed = Date.parse(value);
        if (Number.isFinite(parsed)) {
            return parsed;
        }
    }
    return Number.MAX_SAFE_INTEGER;
}

function normalizeAttachmentNumericID(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
}

export const buildRowArticleAttachmentList = buildAttachmentList;
