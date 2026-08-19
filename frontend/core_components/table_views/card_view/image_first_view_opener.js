// image_first_view_opener.js
// Opens a standalone image-led article without changing the ordinary article view.
// Bridges the existing image modal, row content builder, and already-visible result cards.
// Exists so every real content image can lead into a full-height media view by default.

import { parseRoleString } from "./card_field_formatter.js";
import { openImageModalContent } from "./card_image_modal.js";
import { buildRowArticleContent } from "./big_card_content_builder.js";
import { resolveRowArticleDataTypes } from "./row_article_data_types_resolver.js";
import {
    buildCreationSeed,
    sortColumnsByRole,
} from "./row_article_opener_helpers.js";
import { resolveImagePath } from "./row_article_content_builder_helpers.js";
import { buildRowArticleImageFirstStage } from "./row_article_image_first_stage.js";
import {
    buildRowArticleRowNavigation,
    placeRowArticleDetails,
} from "./row_article_presentation.js";
import { resolveRowArticleImageRows } from "./row_article_image_rows.js";
import {
    resolveRowArticleDynamicAssetChildren,
    resolveRowArticleImageGalleryChild,
    resolveRowArticleParentImageRows,
} from "./row_article_asset_resolver.js";
import { createRowArticleLoadSession } from "./row_article_load_session.js";
import { hasRoutePermission } from "../../route_permission_checker.js";
import { fetchCurrentUserProfile } from "../../user_tools/current_user_profile_fetcher.js";
import { getTranslationForKey } from "../../lang/translation_handler.js";
import {
    enable_experimental_row_article_row_navigation,
    image_first_view_details_position,
} from "../../../ui_config.js";

function resolveImageAltText(row = {}) {
    return [row?.original_name, row?.title, row?.filename]
        .find((value) => typeof value === "string" && value.trim() !== "")
        ?.trim() || "";
}

function normalizedImagePath(value = "") {
    const resolved = resolveImagePath(String(value || "").trim());
    try {
        return new URL(resolved, window.location.origin).pathname;
    } catch {
        return resolved;
    }
}

function resolveActiveImageRow(rows, imageSrc, requestedRow) {
    if (requestedRow && rows.includes(requestedRow)) {
        return requestedRow;
    }
    const requestedPath = normalizedImagePath(requestedRow?.filename || imageSrc);
    return rows.find((row) => normalizedImagePath(row?.filename) === requestedPath)
        || rows[0]
        || null;
}

function resolveHeaderInitial(rowItem, sortedColumns, dataTypes) {
    for (const column of sortedColumns) {
        const { baseRoles } = parseRoleString(dataTypes[column]?.card_element || "");
        if (!baseRoles.includes("header")) {
            continue;
        }
        const value = String(rowItem?.[column] ?? "").trim();
        if (value) {
            return value[0];
        }
    }
    return "";
}

async function resolveImageRowsForView({
    rowItem,
    tableName,
    imageRoleColumns,
    imageRows,
    imageSrc,
}) {
    const parentRows = resolveRowArticleParentImageRows(rowItem, imageRoleColumns);
    if (Array.isArray(imageRows) && imageRows.length > 0) {
        return resolveRowArticleImageRows(imageRows, parentRows);
    }

    let childRows = [];
    if (rowItem?.id != null && tableName) {
        try {
            const loadSession = createRowArticleLoadSession({
                tableName,
                rowId: rowItem.id,
                canFetchLinkingStatus: hasRoutePermission("/api/asset-linking/status"),
            });
            const [dynamicChildren, imageLinking] = await Promise.all([
                loadSession.fetchDynamicChildren(),
                loadSession.fetchImageLinking(),
            ]);
            const { imagesChild, assetsChild } = resolveRowArticleDynamicAssetChildren(
                dynamicChildren?.child_tables || [],
            );
            const imageChild = resolveRowArticleImageGalleryChild(
                tableName,
                imageRoleColumns.length > 0,
                imageLinking,
                imagesChild,
                assetsChild,
            );
            childRows = imageChild?.rows || [];
        } catch (error) {
            console.warn("image-first media lookup failed", error?.message || error);
        }
    }

    const fallbackRows = [...parentRows];
    if (imageSrc) {
        fallbackRows.unshift({
            asset_kind: "image",
            filename: imageSrc,
            is_primary: true,
            is_image_first_fallback: true,
        });
    }
    return resolveRowArticleImageRows(childRows, fallbackRows);
}

function resolveTargetCardImage(targetCard) {
    const image = targetCard?.querySelector?.(
        ".card_image [data-image-first-src], .card_image img",
    );
    return image?.dataset?.imageFirstSrc || image?.getAttribute?.("src") || "";
}

/**
 * Opens an always-available image-first view for one row and active image.
 * Ordinary article state is neither read nor changed by this view.
 */
export async function openImageFirstView({
    imageSrc = "",
    imageRows = null,
    activeImageRow = null,
    rowItem = null,
    tableName = "",
    selectedCard = null,
} = {}) {
    if (!rowItem || typeof rowItem !== "object" || !tableName) {
        return null;
    }

    const dataTypes = resolveRowArticleDataTypes(tableName, selectedCard);
    const sortedColumns = sortColumnsByRole(Object.keys(rowItem), dataTypes);
    const imageRoleColumns = sortedColumns.filter((column) =>
        parseRoleString(dataTypes[column]?.card_element || "").baseRoles.includes("image")
    );
    const [resolvedRows, currentUserProfile] = await Promise.all([
        resolveImageRowsForView({
            rowItem,
            tableName,
            imageRoleColumns,
            imageRows,
            imageSrc,
        }),
        fetchCurrentUserProfile().catch(() => null),
    ]);
    if (resolvedRows.length === 0) {
        return null;
    }

    let currentImageRow = resolveActiveImageRow(
        resolvedRows,
        imageSrc,
        activeImageRow,
    );
    const imageEntries = resolvedRows.map((row, index) => ({ row, index }));
    let closeImageFirstView = null;
    const stage = buildRowArticleImageFirstStage({
        imageEntries,
        getActiveRow: () => currentImageRow,
        onSelectRow: (row) => {
            currentImageRow = row;
        },
        resolvePath: resolveImagePath,
        resolveAlt: resolveImageAltText,
        onBackdropActivate: () => closeImageFirstView?.(),
    });
    if (!stage) {
        return null;
    }

    const { rowArticleContentElement } = await buildRowArticleContent(
        rowItem,
        tableName,
        dataTypes,
        sortedColumns,
        buildCreationSeed(rowItem),
        resolveHeaderInitial(rowItem, sortedColumns, dataTypes),
        imageRoleColumns.length > 0,
        currentUserProfile?.user_id ?? null,
    );
    rowArticleContentElement
        .querySelectorAll(":scope > .big_card_image")
        .forEach((imageElement) => imageElement.remove());
    rowArticleContentElement.classList.add("image_first_view_article_content");
    placeRowArticleDetails(rowArticleContentElement, image_first_view_details_position);

    const shell = document.createElement("div");
    shell.classList.add("image_first_view");
    shell.dataset.testid = "image-first-view";

    if (enable_experimental_row_article_row_navigation) {
        const cardContainer = selectedCard?.closest?.(".card_container");
        const rowNavigation = buildRowArticleRowNavigation({
            cardContainer,
            currentRowId: rowItem.id,
            onNavigate: (targetRow, targetCard) => {
                void openImageFirstView({
                    imageSrc: resolveTargetCardImage(targetCard),
                    rowItem: targetRow,
                    tableName,
                    selectedCard: targetCard,
                });
            },
        });
        if (rowNavigation) {
            shell.appendChild(rowNavigation);
        }
    }

    shell.append(stage.element, rowArticleContentElement);
    const ariaLabel = getTranslationForKey("open_article") || "Open article";
    const modalResult = openImageModalContent({
        contentElement: shell,
        classNames: ["image_first_view_modal"],
        ariaLabel,
    });
    closeImageFirstView = modalResult?.close || null;
    stage.sync();
    return modalResult;
}
