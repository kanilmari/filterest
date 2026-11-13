// image_first_view_opener.js
// Opens a standalone image-led article without changing the ordinary article view.
// Bridges the existing image modal, row content builder, and already-visible result cards.
// Exists so every real content image can lead into a full-height media view by default.

import { bindPageArticleReading } from "./row_article_page_reading.js";
import { getLanguageWithBrowserFallback } from "../../state_stores/lang_preference_reader.js";
import { buildRowArticlePageImage } from "./row_article_page_image.js";
import { datasetAppearanceState } from '../dataset_appearance_state.js';
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
import { resolveRecordTitle } from '../record_title_resolver.js';

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
 * `presentationChoice` is an explicit choice in the view picker's split button
 * (row_presentation/): only the row id is trusted, the permitted record and its
 * current fields are fetched again, and full IFAV opens as a text-only article
 * when that row has no permitted photo. Its history entry keeps the choice.
 * `onRowUnavailable` is called when that fresh fetch no longer returns the row.
 */
export async function openImageFirstView({
    imageSrc = "",
    imageRows = null,
    activeImageRow = null,
    rowItem = null,
    tableName = "",
    selectedCard = null,
    restoringHistory = false,
    search,
    isCurrent = () => true,
    onAccessDenied,
    layout = "image_first",
    presentationChoice = false,
    onRowUnavailable,
} = {}) {
    if (!rowItem || typeof rowItem !== "object" || !tableName) {
        return null;
    }

    const pageLayout = layout === "page";
    const viewKey = pageLayout ? "image_first_page_view" : "image_first_view";
    const appearanceToken = datasetAppearanceState.capture(tableName);
    const callerIsCurrent = isCurrent;
    isCurrent = () => callerIsCurrent() && datasetAppearanceState.isCurrent(appearanceToken);
    const intent = beginImageFirstViewOpen({
        tableName, rowId: rowItem.id, listPath: buildDatasetPath(tableName, DATASET_PREFIX || "/"),
        restoring: restoringHistory, isCurrent, viewKey, presentationChoice, search,
    });
    // Restoring a chosen entry keeps its choice; Page never needs a photo.
    const textOnlyAllowed = !pageLayout && intent.presentationChoice;
    if (!await authorizeImageFirstView(tableName, intent.isCurrent, onAccessDenied, viewKey)) return null;
    // Reopening history always obtains current row/column permissions. Its state
    // contains only identities, never a cached copy of protected article data.
    let dataTypes = resolveRowArticleDataTypes(tableName, selectedCard);
    if (restoringHistory || pageLayout || presentationChoice) {
        const response = await fetchDatasetData({
            dataset_name: tableName, filters: { id: rowItem.id },
            view_key: pageLayout ? viewKey : "article_view", callerName: "openImageFirstView",
        });
        if (!intent.isCurrent()) return null;
        rowItem = response?.data?.find(row => String(row.id) === String(rowItem.id));
        if (!rowItem) {
            // Deleted, filtered out or no longer readable: the caller may say it
            // did not open, without learning which.
            onRowUnavailable?.();
            return null;
        }
        if (response.dataset_appearance != null
            && !datasetAppearanceState.accept(tableName, response.dataset_appearance, { token: appearanceToken, isCurrent })) return null;
        dataTypes = response.types || {};
        Object.defineProperty(rowItem, '__articleTableMeta', { value: response.table_meta || {}, configurable: true });
        Object.defineProperty(rowItem, '__articleColumns', { value: response.columns || Object.keys(rowItem), configurable: true });
        selectedCard = Array.from(document.getElementById(tableName + "_container")
            ?.querySelectorAll(".card[data-id]") || [])
            .find(card => String(card.dataset.id) === String(rowItem.id)) || null;
    }
    const sortedColumns = sortColumnsByRole(rowItem.__articleColumns || Object.keys(rowItem), dataTypes);
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
        loadRowArticleSectionDefaults(tableName, pageLayout ? viewKey : "image_first"),
    ]);
    if (!intent.isCurrent() || (!pageLayout && resolvedRows.length === 0 && !textOnlyAllowed)) {
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
    const recordTitle = resolveRecordTitle({ rowItem, columns: sortedColumns, tableName,
        dataTypes, surface: 'article', currentUserID: currentUserProfile?.user_id });
    const rowPresentationLabel = recordTitle.text;
    let closeImageFirstView = null;
    let historyEntryId = null;
    const stage = pageLayout ? buildRowArticlePageImage({
        imageRow: currentImageRow, resolvePath: resolveImagePath, resolveAlt: resolveImageAltText,
    }) : resolvedRows.length === 0 ? null : buildRowArticleImageFirstStage({
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
    if (!stage && !pageLayout && !textOnlyAllowed) {
        return null;
    }

    const buildContent = async (chosenLanguage) => {
        const { rowArticleContentElement: content } = await buildRowArticleContent(
            rowItem, tableName, dataTypes, sortedColumns, buildCreationSeed(rowItem),
            recordTitle.initial, imageRoleColumns.length > 0, currentUserProfile?.user_id ?? null,
            pageLayout ? { sectionDefaults, chosenLanguage } : { sectionDefaults },
        );
        if (!content || !datasetAppearanceState.isCurrent(appearanceToken)) return null;
        content.querySelectorAll(":scope > .big_card_image").forEach(image => image.remove());
        content.classList.add("image_first_view_article_content");
        placeRowArticleDetails(content, image_first_view_details_position);
        return content;
    };
    const language = getLanguageWithBrowserFallback();
    const [rowArticleContentElement] = await Promise.all([
        buildContent(language), stage?.whenTransitionMediaReady?.(),
    ]);
    if (!rowArticleContentElement || !intent.isCurrent()) return null;

    const shell = document.createElement("div");
    shell.classList.add("image_first_view");
    datasetAppearanceState.bind(shell, tableName);
    shell.dataset.testid = "image-first-view";
    // Ownership belongs to this disposable dialog content, never the singleton
    // overlay. Close removes it; reuse replaces it, including photo transitions.
    if (presentationChoice) shell.dataset.rowPresentationOwner = tableName;
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
    if (!pageLayout && enable_experimental_row_article_row_navigation) {
        const cardContainer = selectedCard?.closest?.(".card_container");
        rowNavigation = buildRowArticleRowNavigation({
            cardContainer,
            currentRowId: rowItem.id,
            onNavigate: (targetRow, targetCard) => {
                const restoreNavigation = lockRowNavigation(rowNavigation);
                void openImageFirstView({
                    // A chosen view reads each record afresh, never the card's last picture.
                    imageSrc: intent.presentationChoice ? "" : resolveTargetCardImage(targetCard),
                    rowItem: targetRow,
                    tableName,
                    selectedCard: targetCard,
                    presentationChoice: intent.presentationChoice,
                }).catch((error) => {
                    console.warn(
                        "image-first record transition failed",
                        error?.message || error,
                    );
                }).finally(restoreNavigation);
            },
        });
    }

    if (pageLayout) {
        shell.classList.add("image_first_page_view");
        if (stage) rowArticleContentElement.prepend(stage.element);
        shell.append(rowArticleContentElement);
    } else if (stage) {
        shell.append(stage.element, rowArticleContentElement);
    } else {
        // Text-only IFAV: the chosen row has no permitted photo, so no stage or placeholder.
        shell.classList.add("image_first_view--text-only");
        shell.append(rowArticleContentElement);
    }
    if (stage && !pageLayout && !window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) {
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
    if (pageLayout && modalResult) {
        void bindPageArticleReading(shell, rowArticleContentElement, buildContent, language);
    }
    attachImageFirstView(historyEntryId, modalResult);
    closeImageFirstView = modalResult?.close || null;
    // The stage builder performs its initial synchronization before returning.
    // Rebuilding the same media after the modal animation has started forces
    // Firefox to decode and paint SVG presentations during their first frame.
    // Later image changes still synchronize through the stage's own controls.
    return modalResult;
}
