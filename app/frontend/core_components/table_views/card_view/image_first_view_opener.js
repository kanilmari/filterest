// image_first_view_opener.js
// Opens a standalone image-led article without changing the ordinary article view.
// Bridges the existing image modal, row content builder, and already-visible result cards.
// Exists so every real content image can lead into a full-height media view by default.

import { loadRowArticleSectionDefaults } from "./row_article_section_defaults.js";

import { buildDatasetPath } from "../../navigation/nav_engine/dataset_aliases.js";
import { DATASET_PREFIX } from "../../navigation/nav_engine/query_params.js";
import { fetchDatasetData } from "../../endpoints/endpoint_data_fetcher.js";
import {
    authorizeImageFirstView, beginImageFirstViewOpen, attachImageFirstView,
    imageFirstViewDidClose, updateImageFirstViewImage,
} from "../../navigation/nav_engine/image_first_view_history.js";
import { parseRoleString } from "./card_field_formatter.js";
import {
    openImageModalContent,
    transitionImageFirstModalContent,
} from "./card_image_modal.js";
import { buildRowArticleContent } from "./row_article_content_builder.js";
import { resolveRowArticleDataTypes } from "./row_article_data_types_resolver.js";
import {
    buildCreationSeed,
    sortColumnsByRole,
} from "./row_article_opener_helpers.js";
import { resolveImagePath } from "./row_article_content_builder_helpers.js";
import {
    activateImageFirstStageTransitionMedia,
    buildRowArticleImageFirstStage,
} from "./row_article_image_first_stage.js";
import {
    buildRowArticleRowNavigation,
    placeRowArticleDetails,
} from "./row_article_presentation.js";
import {
    resolveRowArticleImageRows,
    resolveRowArticleMainImageRow,
    resolveRowArticlePictureIdentity,
} from "./row_article_image_rows.js";
import {
    resolveRowArticleDisplayedImageRows,
    resolveRowArticleImageGalleryChild,
    resolveRowArticleParentImageRows,
} from "./row_article_asset_resolver.js";
import { createRowArticleLoadSession } from "./row_article_load_session.js";
import { fetchCurrentUserProfile } from "../../user_tools/current_user_profile_fetcher.js";
import { getTranslationForKey } from "../../lang/translation_handler.js";
import {
    enable_experimental_row_article_row_navigation,
    image_first_view_details_position,
} from "../../../ui_config.js";
import { resolveDatasetDisplayValue } from "../dataset_value_localizer.js";

function resolveImageAltText(row = {}) {
    return [row?.original_name, row?.title, row?.filename]
        .find((value) => typeof value === "string" && value.trim() !== "")
        ?.trim() || "";
}

/**
 * Picks the picture the view opens on: one the viewer chose (a clicked thumbnail or
 * article image, the picture in the address) while the rows list it, otherwise the
 * main picture, the card's picture wherever the rows list it, otherwise the first row.
 */
function resolveActiveImageRow(rows, chosenRow, chosenSrc, cardPicture) {
    if (chosenRow && rows.includes(chosenRow)) {
        return chosenRow;
    }
    const chosenPicture = resolveRowArticlePictureIdentity(chosenRow?.filename || chosenSrc);
    return (chosenPicture && rows.find((row) => resolveRowArticlePictureIdentity(row?.filename) === chosenPicture))
        || resolveRowArticleMainImageRow(rows, cardPicture);
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

function resolveRowPresentationLabel(rowItem, sortedColumns, dataTypes) {
    for (const column of sortedColumns) {
        const { baseRoles } = parseRoleString(dataTypes[column]?.card_element || "");
        if (!baseRoles.includes("header")) {
            continue;
        }
        const value = resolveDatasetDisplayValue(
            rowItem?.[column],
            dataTypes?.[column] || null,
        ).trim();
        if (value) {
            return value;
        }
    }
    return "";
}

/**
 * Resolves the pictures the view shows ({ rows }), the picture the server says the card
 * shows ({ cardPicture }), and whether the opened image is the viewer's own choice
 * ({ openedImageChosen }) or only the picture the caller last knew for the row.
 */
async function resolveImageRowsForView({
    rowItem,
    tableName,
    imageRoleColumns,
    imageRows,
    imageSrc,
}) {
    // Rows handed over by an article or its gallery are already what that article
    // shows, composed from its fresh response; adding the row's own image fields here
    // would bring back a picture that response no longer lists. The opened image is
    // the one the viewer clicked among them.
    if (Array.isArray(imageRows) && imageRows.length > 0) {
        return { rows: resolveRowArticleImageRows(imageRows), cardPicture: "", openedImageChosen: true };
    }

    let dynamicChildren = null;
    if (rowItem?.id != null && tableName) {
        try {
            const freshChildren = await createRowArticleLoadSession({ tableName, rowId: rowItem.id })
                .fetchDynamicChildren();
            if (Array.isArray(freshChildren?.child_tables)) {
                dynamicChildren = freshChildren;
            }
        } catch (error) {
            console.warn("image-first media lookup failed", error?.message || error);
        }
    }

    // A fresh response alone decides what the view shows, its gallery or else only the
    // card's picture, and the view starts on the card's picture: the opened image and
    // the row's own image fields are what a card or article showed before, possibly a
    // picture deleted or replaced since. They stand in, the opened image first, only
    // without a response.
    if (dynamicChildren) {
        return {
            rows: resolveRowArticleDisplayedImageRows(
                dynamicChildren,
                resolveRowArticleImageGalleryChild(dynamicChildren),
            ),
            cardPicture: dynamicChildren.card_picture,
            openedImageChosen: false,
        };
    }
    const rowImageRows = resolveRowArticleParentImageRows(rowItem, imageRoleColumns);
    if (imageSrc) {
        rowImageRows.unshift({
            asset_kind: "image",
            filename: imageSrc,
            is_image_first_fallback: true,
        });
    }
    return {
        rows: resolveRowArticleDisplayedImageRows(null, null, rowImageRows),
        cardPicture: "",
        openedImageChosen: true,
    };
}

function resolveTargetCardImage(targetCard) {
    const image = targetCard?.querySelector?.(
        ".card_image [data-image-first-src], .card_image img",
    );
    return image?.dataset?.imageFirstSrc || image?.getAttribute?.("src") || "";
}

function lockRowNavigation(navigation) {
    if (!(navigation instanceof HTMLElement)) {
        return () => {};
    }
    // Loading is transient busy state, not evidence that a neighboring record
    // does not exist. Keep the controls visually stable while their click
    // handlers suppress duplicate navigation through the navigation's
    // aria-busy contract.
    navigation.setAttribute("aria-busy", "true");
    let restored = false;
    return () => {
        if (restored) return;
        restored = true;
        navigation.removeAttribute("aria-busy");
    };
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
    restoringHistory = false,
    isCurrent = () => true,
} = {}) {
    if (!rowItem || typeof rowItem !== "object" || !tableName) {
        return null;
    }

    const intent = beginImageFirstViewOpen({
        tableName, rowId: rowItem.id, listPath: buildDatasetPath(tableName, DATASET_PREFIX || "/"),
        restoring: restoringHistory, isCurrent,
    });
    if (!await authorizeImageFirstView(tableName, intent.isCurrent)) return null;
    // Reopening history always obtains current row/column permissions. Its state
    // contains only identities, never a cached copy of protected article data.
    let dataTypes = resolveRowArticleDataTypes(tableName, selectedCard);
    if (restoringHistory) {
        const response = await fetchDatasetData({
            dataset_name: tableName, filters: { id: rowItem.id },
            view_key: "article_view", callerName: "openImageFirstView",
        });
        if (!intent.isCurrent()) return null;
        rowItem = response?.data?.find(row => String(row.id) === String(rowItem.id));
        if (!rowItem) return null;
        dataTypes = response.types || {};
        selectedCard = Array.from(document.getElementById(tableName + "_container")
            ?.querySelectorAll(".card[data-id]") || [])
            .find(card => String(card.dataset.id) === String(rowItem.id)) || null;
    }
    const sortedColumns = sortColumnsByRole(Object.keys(rowItem), dataTypes);
    const imageRoleColumns = sortedColumns.filter((column) =>
        parseRoleString(dataTypes[column]?.card_element || "").baseRoles.includes("image")
    );
    const [{ rows: resolvedRows, cardPicture, openedImageChosen }, currentUserProfile, sectionDefaults] = await Promise.all([
        resolveImageRowsForView({
            rowItem,
            tableName,
            imageRoleColumns,
            imageRows,
            imageSrc,
        }),
        fetchCurrentUserProfile().catch(() => null),
        loadRowArticleSectionDefaults(tableName, "image_first"),
    ]);
    if (!intent.isCurrent() || resolvedRows.length === 0) {
        return null;
    }

    // A restored address names the picture the viewer last showed; a clicked thumbnail
    // or article image arrives as activeImageRow, or as the opened imageSrc.
    let currentImageRow = resolveActiveImageRow(
        resolvedRows,
        intent.image ? null : activeImageRow,
        intent.image || (openedImageChosen ? imageSrc : ""),
        cardPicture,
    );
    const imageEntries = resolvedRows.map((row, index) => ({ row, index }));
    const rowPresentationLabel = resolveRowPresentationLabel(
        rowItem,
        sortedColumns,
        dataTypes,
    );
    let closeImageFirstView = null;
    let historyEntryId = null;
    const stage = buildRowArticleImageFirstStage({
        imageEntries,
        getActiveRow: () => currentImageRow,
        onSelectRow: (row) => {
            currentImageRow = row;
            updateImageFirstViewImage(historyEntryId, row?.filename || "");
        },
        resolvePath: resolveImagePath,
        resolveAlt: resolveImageAltText,
        tableName,
        rowLabel: rowPresentationLabel,
        onBackdropActivate: () => closeImageFirstView?.(),
    });
    if (!stage) {
        return null;
    }

    const [{ rowArticleContentElement }] = await Promise.all([
        buildRowArticleContent(
            rowItem,
            tableName,
            dataTypes,
            sortedColumns,
            buildCreationSeed(rowItem),
            resolveHeaderInitial(rowItem, sortedColumns, dataTypes),
            imageRoleColumns.length > 0,
            currentUserProfile?.user_id ?? null,
            { sectionDefaults },
        ),
        stage.whenTransitionMediaReady(),
    ]);
    if (!intent.isCurrent()) return null;
    rowArticleContentElement
        .querySelectorAll(":scope > .big_card_image")
        .forEach((imageElement) => imageElement.remove());
    rowArticleContentElement.classList.add("image_first_view_article_content");
    placeRowArticleDetails(rowArticleContentElement, image_first_view_details_position);

    const shell = document.createElement("div");
    shell.classList.add("image_first_view");
    shell.dataset.testid = "image-first-view";
    // The centered article leaves real background beside its text, outside the
    // image stage. Close only on that shell, never through article controls or
    // a text-selection drag that began inside the content.
    let pointerStartedOnBackground = false;
    shell.addEventListener("pointerdown", (event) => {
        pointerStartedOnBackground = event.target === shell;
    });
    shell.addEventListener("click", (event) => {
        if (event.target === shell && (event.detail === 0 || pointerStartedOnBackground)) {
            closeImageFirstView?.();
        }
        pointerStartedOnBackground = false;
    });

    let rowNavigation = null;
    if (enable_experimental_row_article_row_navigation) {
        const cardContainer = selectedCard?.closest?.(".card_container");
        rowNavigation = buildRowArticleRowNavigation({
            cardContainer,
            currentRowId: rowItem.id,
            onNavigate: (targetRow, targetCard) => {
                const restoreNavigation = lockRowNavigation(rowNavigation);
                void openImageFirstView({
                    imageSrc: resolveTargetCardImage(targetCard),
                    rowItem: targetRow,
                    tableName,
                    selectedCard: targetCard,
                }).catch((error) => {
                    console.warn(
                        "image-first record transition failed",
                        error?.message || error,
                    );
                }).finally(restoreNavigation);
            },
        });
    }

    shell.append(stage.element, rowArticleContentElement);
    if (!window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) {
        activateImageFirstStageTransitionMedia(stage.element);
    }
    const ariaLabel = getTranslationForKey("open_article") || "Open article";
    const topControlElements = rowNavigation ? [rowNavigation] : [];
    historyEntryId = intent.commit(currentImageRow?.filename || "");
    if (!historyEntryId) return null;
    const onClose = () => {
        shell.remove();
        imageFirstViewDidClose(historyEntryId);
    };
    const modalResult = transitionImageFirstModalContent({
        contentElement: shell,
        ariaLabel,
        topControlElements,
        onClose,
    }) || openImageModalContent({
        contentElement: shell,
        classNames: ["image_first_view_modal"],
        overlayClassNames: ["image_first_view_overlay"],
        ariaLabel,
        topControlElements,
        onClose,
    });
    attachImageFirstView(historyEntryId, modalResult);
    closeImageFirstView = modalResult?.close || null;
    // The stage builder performs its initial synchronization before returning.
    // Rebuilding the same media after the modal animation has started forces
    // Firefox to decode and paint SVG presentations during their first frame.
    // Later image changes still synchronize through the stage's own controls.
    return modalResult;
}
