// big_card_image_gallery.js
// Thumbnail gallery with inline upload and on-demand previews for big card view.
// Bridges child table image rows, upload placeholders, and the add-row-multipart API.
// Exists to display and manage images attached to a parent row inside the big card modal.

import { createImageUploadPlaceholder } from "./big_card_image_upload.js";
import { openImageModal } from "./card_image_modal.js";
import { resolveImagePath } from "./row_article_content_builder_helpers.js";
import { endpoint_router } from "../../endpoints/endpoint_router.js";
import { getTranslationForKey } from "../../lang/translation_handler.js";
import { showConfirmModal } from "../../../reusable_components/modal/confirm_modal_builder.js";
import {
    showErrorToast,
    showSuccessToast,
} from "../../../reusable_components/notifications/toast_notification_printer.js";

const VISIBLE_THUMBNAIL_COUNT = 5;

/**
 * Builds the image gallery section for a big card.
 *
 * @param {string} parentTableName - parent table, e.g. "dev_agent_tasks"
 * @param {number|string} parentRowId - parent row id
 * @param {Object|null} childTableData - child entry from fetchDynamicChildren (has .rows, .dataset, .column) or null
 * @param {() => void} onImageAdded - callback after successful upload (caller should refresh gallery)
 * @param {{ canUpload?: boolean, canDelete?: boolean, canSetPrimary?: boolean, canEditMetadata?: boolean, parentImageRows?: Object[] }} [options]
 * @returns {HTMLElement}
 */
export function buildImageGallery(parentTableName, parentRowId, childTableData, onImageAdded, options = {}) {
    const container = document.createElement("div");
    container.classList.add("big_card_image_gallery", "row_article_image_gallery");

    const rows = resolveImageRows(
        childTableData?.rows || [],
        options.parentImageRows || [],
    );
    const childDataset = childTableData?.dataset || "";
    const childColumn = childTableData?.column || "";
    const canUpload = canUploadImageToChildDataset(childTableData)
        && (Object.prototype.hasOwnProperty.call(options, "canUpload")
            ? options.canUpload === true
            : true);
    const canDelete = Boolean(childDataset)
        && (Object.prototype.hasOwnProperty.call(options, "canDelete")
            ? options.canDelete === true
            : false);
    const canSetPrimary = Boolean(childDataset)
        && (Object.prototype.hasOwnProperty.call(options, "canSetPrimary")
            ? options.canSetPrimary === true
            : false);
    const canEditMetadata = Boolean(childDataset)
        && usesSharedAssetChildDataset(childTableData)
        && (Object.prototype.hasOwnProperty.call(options, "canEditMetadata")
            ? options.canEditMetadata === true
            : false);

    const contextMenu = document.createElement("div");
    contextMenu.classList.add("big_card_thumbnail_context_menu");
    contextMenu.dataset.testid = "big-card-image-context-menu";
    container.appendChild(contextMenu);
    let contextMenuAbortController = null;

    const closeContextMenu = () => {
        contextMenu.classList.remove("is-visible");
        contextMenu.replaceChildren();
        contextMenuAbortController?.abort();
        contextMenuAbortController = null;
    };

    const refreshGallery = async () => {
        closeContextMenu();
        if (onImageAdded) {
            await onImageAdded();
        }
    };

    // ── Upload handler ───────────────────────────
    // Insert directly into the resolved child asset table (not via addRowMultipart
    // on the parent, which would create a new parent row).
    const imagesTable = childDataset;
    const fkColumn = childColumn;

    const uploadImage = async (file) => {
        if (!canUpload) {
            console.warn("image upload skipped because no child asset relation was resolved");
            return;
        }
        const formData = new FormData();
        const payload = {
            [fkColumn]: parentRowId,
        };
        if (usesSharedAssetChildDataset(childTableData)) {
            payload.asset_kind = "image";
            payload.original_name = file.name;
            payload.mime_type = file.type || "";
            payload.size_bytes = file.size;
            payload.title = file.name;
        }
        formData.append("jsonPayload", JSON.stringify(payload));
        formData.append("file_child_0", file);

        await endpoint_router("addRowMultipart", {
            method: "POST",
            url_params: `?dataset=${imagesTable}`,
            body_data: formData,
        });
    };

    const uploadImages = async (files = []) => {
        const imageFiles = Array.from(files).filter((file) => file);
        if (imageFiles.length === 0) {
            return;
        }

        container.classList.add("is-uploading");
        try {
            for (const file of imageFiles) {
                // Sequential uploads keep refresh/error handling predictable.
                await uploadImage(file);
            }
            await refreshGallery();
            showSuccessToast(
                imageFiles.length === 1
                    ? (getTranslationForKey("save_success") || "Kuva lisätty.")
                    : `${imageFiles.length} ${(getTranslationForKey("images") || "kuvaa").toLowerCase()} lisätty.`
            );
        } catch (err) {
            console.error("image upload failed:", err.message || err);
            showErrorToast(getTranslationForKey("save_failed") || "Kuvan lisäys ei onnistunut.");
        } finally {
            container.classList.remove("is-uploading");
        }
    };

    const metadataEditor = canEditMetadata
        ? createImageMetadataEditor({
            childDataset,
            onRefresh: refreshGallery,
        })
        : null;

    const imageEntries = rows
        .map((row, idx) => ({ row, idx }))
        .filter(({ row }) => typeof row?.filename === "string" && row.filename.trim() !== "");

    let activeImageRow = imageEntries[0]?.row || null;
    const syncActiveImageRow = (row) => {
        activeImageRow = row || null;
        metadataEditor?.loadRow(activeImageRow);
    };
    syncActiveImageRow(activeImageRow);

    const appendImageActionButtons = (host, row, idx) => {
        if (canSetPrimary && row?.id != null) {
            const primaryButton = document.createElement("button");
            primaryButton.type = "button";
            primaryButton.classList.add("big_card_thumbnail_primary", "fw-btn", "fw-btn--ghost");
            if (rowIsPrimary(row)) {
                primaryButton.classList.add("is-primary");
            }
            primaryButton.dataset.testid = `big-card-image-primary-${idx}`;
            primaryButton.textContent = rowIsPrimary(row) ? "★" : "☆";
            primaryButton.title = rowIsPrimary(row)
                ? (getTranslationForKey("default_image") || "Oletuskuva")
                : (getTranslationForKey("set_as_default_image") || "Tee oletuskuvaksi");
            primaryButton.disabled = rowIsPrimary(row);
            primaryButton.addEventListener("click", async (event) => {
                event.stopPropagation();
                if (rowIsPrimary(row)) {
                    return;
                }
                await setImageAsPrimary({
                    targetRow: row,
                    allRows: rows,
                    childDataset,
                    triggerButton: primaryButton,
                    onRefresh: refreshGallery,
                });
            });
            host.appendChild(primaryButton);
        }

        if (canDelete && row?.id != null) {
            const deleteButton = document.createElement("button");
            deleteButton.type = "button";
            deleteButton.classList.add("big_card_thumbnail_delete", "fw-btn", "fw-btn--ghost");
            deleteButton.dataset.testid = `big-card-image-delete-${idx}`;
            deleteButton.textContent = "×";
            deleteButton.title = getTranslationForKey("delete") || "Poista";
            deleteButton.setAttribute("aria-label", getTranslationForKey("delete") || "Poista");
            deleteButton.addEventListener("click", async (event) => {
                event.stopPropagation();
                await deleteImageRow({
                    row,
                    childDataset,
                    triggerButton: deleteButton,
                    onRefresh: refreshGallery,
                });
            });
            host.appendChild(deleteButton);
        }
    };

    const attachImageContextMenu = (host, row, activateRow) => {
        if (!(canDelete || canSetPrimary || canEditMetadata)) {
            return;
        }
        host.addEventListener("contextmenu", (event) => {
            event.preventDefault();
            event.stopPropagation();

            closeContextMenu();
            if (canSetPrimary && row?.id != null && !rowIsPrimary(row)) {
                const setPrimaryButton = document.createElement("button");
                setPrimaryButton.type = "button";
                setPrimaryButton.classList.add("big_card_thumbnail_context_action");
                setPrimaryButton.dataset.testid = "big-card-image-menu-primary";
                setPrimaryButton.textContent = getTranslationForKey("set_as_default_image") || "Tee oletuskuvaksi";
                setPrimaryButton.addEventListener("click", async (clickEvent) => {
                    clickEvent.stopPropagation();
                    await setImageAsPrimary({
                        targetRow: row,
                        allRows: rows,
                        childDataset,
                        triggerButton: setPrimaryButton,
                        onRefresh: refreshGallery,
                    });
                });
                contextMenu.appendChild(setPrimaryButton);
            }

            if (canDelete && row?.id != null) {
                const deleteMenuButton = document.createElement("button");
                deleteMenuButton.type = "button";
                deleteMenuButton.classList.add("big_card_thumbnail_context_action", "danger");
                deleteMenuButton.dataset.testid = "big-card-image-menu-delete";
                deleteMenuButton.textContent = getTranslationForKey("delete") || "Poista";
                deleteMenuButton.addEventListener("click", async (clickEvent) => {
                    clickEvent.stopPropagation();
                    await deleteImageRow({
                        row,
                        childDataset,
                        triggerButton: deleteMenuButton,
                        onRefresh: refreshGallery,
                    });
                });
                contextMenu.appendChild(deleteMenuButton);
            }

            if (canEditMetadata && row?.id != null) {
                const editMenuButton = document.createElement("button");
                editMenuButton.type = "button";
                editMenuButton.classList.add("big_card_thumbnail_context_action");
                editMenuButton.dataset.testid = "big-card-image-menu-edit";
                editMenuButton.textContent = getTranslationForKey("edit") || "Muokkaa";
                editMenuButton.addEventListener("click", (clickEvent) => {
                    clickEvent.stopPropagation();
                    activateRow();
                    metadataEditor?.focus();
                    closeContextMenu();
                });
                contextMenu.appendChild(editMenuButton);
            }

            if (contextMenu.childElementCount === 0) {
                return;
            }

            contextMenu.style.left = `${event.clientX}px`;
            contextMenu.style.top = `${event.clientY}px`;
            contextMenu.classList.add("is-visible");

            contextMenuAbortController = new AbortController();
            const closeOnOutsidePointer = (pointerEvent) => {
                if (!contextMenu.contains(pointerEvent.target)) {
                    closeContextMenu();
                }
            };
            const closeOnEscape = (keyEvent) => {
                if (keyEvent.key === "Escape") {
                    closeContextMenu();
                }
            };
            window.setTimeout(() => {
                if (!contextMenuAbortController) {
                    return;
                }
                document.addEventListener("pointerdown", closeOnOutsidePointer, {
                    capture: true,
                    signal: contextMenuAbortController.signal,
                });
                document.addEventListener("keydown", closeOnEscape, {
                    signal: contextMenuAbortController.signal,
                });
            }, 0);
        });
    };

    // ── Thumbnail row ────────────────────────────
    const thumbRow = document.createElement("div");
    thumbRow.classList.add("big_card_thumbnail_row");
    let carouselStartIndex = 0;
    let updateActiveThumbnailState = () => {};

    const setCarouselStartIndex = (nextStartIndex) => {
        const maxStartIndex = Math.max(0, imageEntries.length - VISIBLE_THUMBNAIL_COUNT);
        carouselStartIndex = Math.min(Math.max(0, nextStartIndex), maxStartIndex);
        renderThumbnailRow();
    };

    const buildCarouselButton = (direction) => {
        const button = document.createElement("button");
        button.type = "button";
        button.classList.add("big_card_thumbnail_carousel_button", "fw-btn", "fw-btn--ghost");
        button.dataset.testid = direction === "previous"
            ? "big-card-image-carousel-previous"
            : "big-card-image-carousel-next";
        button.textContent = direction === "previous" ? "‹" : "›";
        button.title = direction === "previous"
            ? (getTranslationForKey("previous") || "Edelliset")
            : (getTranslationForKey("next") || "Seuraavat");
        button.setAttribute("aria-label", button.title);
        button.disabled = direction === "previous"
            ? carouselStartIndex === 0
            : carouselStartIndex >= Math.max(0, imageEntries.length - VISIBLE_THUMBNAIL_COUNT);
        button.addEventListener("click", (event) => {
            event.stopPropagation();
            const delta = direction === "previous" ? -VISIBLE_THUMBNAIL_COUNT : VISIBLE_THUMBNAIL_COUNT;
            setCarouselStartIndex(carouselStartIndex + delta);
        });
        return button;
    };

    const buildThumbnailItem = ({ row, idx }) => {
        const thumbItem = document.createElement("div");
        thumbItem.classList.add("big_card_thumbnail_item");
        thumbItem.dataset.testid = `big-card-image-item-${idx}`;

        const thumb = document.createElement("img");
        thumb.src = resolveImagePath(row.filename);
        thumb.alt = resolveImageAltText(row);
        thumb.classList.add("big_card_thumbnail", "saturate_on_hover");
        thumb.dataset.testid = `big-card-image-thumb-${idx}`;
        thumb.dataset.imageIndex = String(idx);
        thumb.tabIndex = 0;
        if (imageRowsMatch(row, activeImageRow)) {
            thumb.classList.add("active_thumb");
        }

        const selectThumbnail = () => {
            syncActiveImageRow(row);
            updateActiveThumbnailState();
        };
        const openThumbnailPreview = () => {
            selectThumbnail();
            openImageModal(resolveImagePath(row.filename));
        };

        thumb.addEventListener("click", openThumbnailPreview);
        thumb.addEventListener("keydown", (event) => {
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                openThumbnailPreview();
            }
        });

        thumbItem.appendChild(thumb);
        appendImageActionButtons(thumbItem, row, idx);
        attachImageContextMenu(thumbItem, row, selectThumbnail);
        return thumbItem;
    };

    function renderThumbnailRow() {
        thumbRow.replaceChildren();

        if (canUpload) {
            thumbRow.appendChild(
                createImageUploadPlaceholder({
                    size: "small",
                    multiple: true,
                    onFilesSelected: uploadImages,
                })
            );
        } else if (imageEntries.length === 0) {
            thumbRow.appendChild(buildDisabledThumbnailPlaceholder());
        }

        const needsCarousel = imageEntries.length > VISIBLE_THUMBNAIL_COUNT;
        if (needsCarousel) {
            thumbRow.appendChild(buildCarouselButton("previous"));
        }

        const strip = document.createElement("div");
        strip.classList.add("big_card_thumbnail_strip");
        const visibleEntries = imageEntries.slice(
            carouselStartIndex,
            carouselStartIndex + VISIBLE_THUMBNAIL_COUNT
        );
        visibleEntries.forEach((entry) => {
            strip.appendChild(buildThumbnailItem(entry));
        });
        thumbRow.appendChild(strip);

        if (needsCarousel) {
            thumbRow.appendChild(buildCarouselButton("next"));
        }

        updateActiveThumbnailState = () => {
            thumbRow.querySelectorAll(".big_card_thumbnail").forEach((thumb) => {
                const thumbIndex = Number(thumb.dataset.imageIndex);
                const entry = imageEntries.find(({ idx }) => idx === thumbIndex);
                thumb.classList.toggle("active_thumb", imageRowsMatch(entry?.row, activeImageRow));
            });
        };
    }

    renderThumbnailRow();
    container.appendChild(thumbRow);

    if (metadataEditor) {
        container.appendChild(metadataEditor.element);
    }

    return container;
}

export function resolveImageRows(rows, supplementaryRows = []) {
    const canonicalRows = Array.isArray(rows) ? rows : [];
    const fallbackRows = Array.isArray(supplementaryRows) ? supplementaryRows : [];
    const seenPaths = new Set();

    return [...canonicalRows, ...fallbackRows]
        .filter((row) => {
            const assetKind = String(row?.asset_kind || "").toLowerCase();
            const hasFilename = typeof row?.filename === "string" && row.filename.trim() !== "";
            if (!hasFilename || !(assetKind === "image" || assetKind === "")) {
                return false;
            }

            const resolvedPath = resolveImagePath(row.filename.trim());
            if (seenPaths.has(resolvedPath)) {
                return false;
            }
            seenPaths.add(resolvedPath);
            return true;
        })
        .sort(compareImageRowsByPriority);
}

export function canUploadImageToChildDataset(childTableData) {
    return Boolean(
        String(childTableData?.dataset || "").trim()
        && String(childTableData?.column || "").trim()
    );
}

export const buildRowArticleImageGallery = buildImageGallery;
export const resolveRowArticleImageRows = resolveImageRows;
export const canUploadImageToRowArticleChildDataset = canUploadImageToChildDataset;

function buildDisabledThumbnailPlaceholder() {
    const placeholder = document.createElement("div");
    placeholder.classList.add("image_upload_placeholder", "small");
    placeholder.dataset.testid = "big-card-image-upload-disabled";
    placeholder.title = "Image upload is unavailable until image linking resolves a child relation.";

    const icon = document.createElement("span");
    icon.classList.add("upload_icon");
    icon.textContent = "+";
    placeholder.appendChild(icon);
    return placeholder;
}

function imageRowsMatch(left, right) {
    if (!left || !right) {
        return false;
    }
    if (left.id != null || right.id != null) {
        return String(left.id) === String(right.id);
    }
    return String(left.filename || "") === String(right.filename || "");
}

function usesSharedAssetChildDataset(childTableData) {
    return String(childTableData?.relation_kind || "").trim().toLowerCase() === "shared_asset";
}

function resolveImageAltText(row = {}) {
    const preferredText = [
        row?.original_name,
        row?.title,
        row?.filename,
    ].find((value) => typeof value === "string" && value.trim() !== "");
    return preferredText ? preferredText.trim() : "";
}

function compareImageRowsByPriority(left, right) {
    const primaryDelta = Number(rowIsPrimary(right)) - Number(rowIsPrimary(left));
    if (primaryDelta !== 0) {
        return primaryDelta;
    }

    const leftSortOrder = normalizeSortOrder(left?.sort_order);
    const rightSortOrder = normalizeSortOrder(right?.sort_order);
    if (leftSortOrder !== rightSortOrder) {
        return leftSortOrder - rightSortOrder;
    }

    const leftCreated = normalizeCreatedValue(left?.created);
    const rightCreated = normalizeCreatedValue(right?.created);
    if (leftCreated !== rightCreated) {
        return leftCreated.localeCompare(rightCreated);
    }

    return normalizeNumericId(left?.id) - normalizeNumericId(right?.id);
}

function rowIsPrimary(row) {
    return row?.is_primary === true || row?.is_primary === 1 || row?.is_primary === "true";
}

function normalizeSortOrder(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : Number.MAX_SAFE_INTEGER;
}

function normalizeCreatedValue(value) {
    return value == null ? "" : String(value);
}

function normalizeNumericId(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : Number.MAX_SAFE_INTEGER;
}

async function deleteImageRow({ row, childDataset, triggerButton, onRefresh }) {
    const itemName = String(row.original_name || row.title || row.filename || "").trim() || "image";
    const ok = await showConfirmModal({
        titleLangKey: "delete_confirm_title",
        titlePlainText: "Vahvista poisto",
        messagePlainText: `Poistetaanko kuva "${itemName}"?`,
        confirmLangKey: "delete",
        confirmText: "Poista",
        cancelLangKey: "dont_delete",
        cancelText: "Älä poista",
        isDanger: true,
        itemNames: [itemName],
    });
    if (!ok) {
        return;
    }

    triggerButton.disabled = true;
    try {
        await endpoint_router("deleteRows", {
            method: "POST",
            url_params: `?dataset=${childDataset}`,
            body_data: { ids: [row.id] },
        });
        showSuccessToast(getTranslationForKey("delete_success") || "Kuva poistettu.");
        await onRefresh();
    } catch (err) {
        console.warn("image delete failed:", err?.message || err);
        showErrorToast(getTranslationForKey("delete_failed") || "Kuvan poisto ei onnistunut.");
    } finally {
        triggerButton.disabled = false;
    }
}

async function setImageAsPrimary({ targetRow, allRows, childDataset, triggerButton, onRefresh }) {
    if (!targetRow?.id || rowIsPrimary(targetRow)) {
        return;
    }

    triggerButton.disabled = true;
    const currentPrimaryRows = allRows.filter((row) => row?.id != null && row.id !== targetRow.id && rowIsPrimary(row));

    try {
        await endpoint_router("updateRow", {
            method: "POST",
            url_params: `?dataset=${childDataset}`,
            body_data: {
                id: targetRow.id,
                column: "is_primary",
                value: true,
            },
        });

        for (const primaryRow of currentPrimaryRows) {
            await endpoint_router("updateRow", {
                method: "POST",
                url_params: `?dataset=${childDataset}`,
                body_data: {
                    id: primaryRow.id,
                    column: "is_primary",
                    value: false,
                },
            });
        }

        showSuccessToast(getTranslationForKey("save_success") || "Oletuskuva päivitetty.");
        await onRefresh();
    } catch (err) {
        console.warn("set primary image failed:", err?.message || err);
        showErrorToast(getTranslationForKey("save_failed") || "Oletuskuvan vaihto ei onnistunut.");
    } finally {
        triggerButton.disabled = false;
    }
}

function createImageMetadataEditor({ childDataset, onRefresh }) {
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
        if (!currentRow) {
            isEditorOpen = false;
            titleInput.value = "";
            descriptionInput.value = "";
            helper.textContent = "";
            saveButton.disabled = true;
            resetButton.disabled = true;
            syncEditorVisibility();
            return;
        }

        titleInput.value = String(currentRow?.title || "");
        descriptionInput.value = String(currentRow?.description || "");
        helper.textContent = String(currentRow?.original_name || currentRow?.filename || "").trim()
            ? `Tiedoston nimi: ${String(currentRow.original_name || currentRow.filename).trim()}`
            : "Muokkaa kuvan otsikkoa ja kuvausta.";
        saveButton.disabled = false;
        resetButton.disabled = false;
        syncEditorVisibility();
    };

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
        if (!currentRow?.id) {
            return;
        }

        const nextTitle = titleInput.value.trim();
        const nextDescription = descriptionInput.value.trim();
        const currentTitle = String(currentRow?.title || "").trim();
        const currentDescription = String(currentRow?.description || "").trim();

        const updates = [];
        if (nextTitle !== currentTitle) {
            updates.push({ column: "title", value: nextTitle });
        }
        if (nextDescription !== currentDescription) {
            updates.push({ column: "description", value: nextDescription });
        }
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
            currentRow.title = nextTitle;
            currentRow.description = nextDescription;
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
            titleInput.focus();
            titleInput.select();
        },
        loadRow(nextRow) {
            currentRow = nextRow || null;
            syncInputsFromCurrentRow();
        },
    };
}
