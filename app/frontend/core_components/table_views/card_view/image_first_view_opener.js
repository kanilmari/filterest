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
    isImageFirstModalOpen,
    openImageModalContent,
    transitionImageFirstModalContent,
} from "./card_image_modal.js";
import { cardImageFrameFollowsStoredShape } from "./card_image_presentation.js";
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

/**
 * Loads and decodes a picture outside the page and resolves once it is decoded
 * or has failed. The stage later asks for the same address, which the browser
 * then already holds. The opened picture starts here at once instead of after
 * the picture list arrives; a picture the list replaces is merely unused.
 */
function decodePicture(src) {
    const path = typeof src === "string" ? resolveImagePath(src) : "";
    if (!path || typeof Image !== "function") return Promise.resolve();
    const image = new Image();
    image.decoding = "async";
    image.src = path;
    return typeof image.decode === "function"
        ? image.decode().catch(() => undefined)
        : Promise.resolve();
}

/**
 * The photo a card already shows, when the view can grow from it at once: a plain
 * raster card photo that is decoded on screen. Logos, SVGs and contrast frames
 * return "" and open once their own presentation is known.
 */
function resolveShownCardPhoto(sourceMedia) {
    // Plain card photos are the frames that follow stored photo geometry.
    if (!(sourceMedia instanceof HTMLElement) || !cardImageFrameFollowsStoredShape(sourceMedia)) {
        return "";
    }
    const image = sourceMedia.querySelector(":scope > img");
    if (!(image instanceof HTMLImageElement) || !image.complete || !(image.naturalWidth > 0)) {
        return "";
    }
    return image.currentSrc || image.getAttribute("src") || "";
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
    sourceMedia = null,
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
    // The opened picture starts downloading now, not after the picture list arrives.
    void decodePicture(imageSrc);
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

    let closeImageFirstView = null;
    let historyEntryId = null;
    let currentImageRow = null;
    // The stage reads this array whenever it syncs, so an instant opening can
    // replace its stand-in picture with the fresh list in place.
    const imageEntries = [];
    // Before the view is committed the opening intent decides; afterwards only
    // whether this opening's own view is still the open one.
    const stillWanted = () => (historyEntryId != null ? intent.isOpen() : intent.isCurrent());
    const reducedMotion = Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches);

    const imageRowsRequest = resolveImageRowsForView({
        rowItem,
        tableName,
        imageRoleColumns,
        imageRows,
        imageSrc,
    });
    // Settled here only to keep an early return from leaving a rejection unhandled;
    // the awaits below still receive the same outcome.
    imageRowsRequest.catch(() => undefined);

    // The article text does not depend on which pictures the view shows, so it is
    // built while the picture list and the opened picture are still loading.
    const loadArticle = async () => {
        const [currentUserProfile, sectionDefaults] = await Promise.all([
            fetchCurrentUserProfile().catch(() => null),
            loadRowArticleSectionDefaults(tableName, pageLayout ? viewKey : "image_first"),
        ]);
        if (!stillWanted()) return null;
        const recordTitle = resolveRecordTitle({ rowItem, columns: sortedColumns, tableName,
            dataTypes, surface: 'article', currentUserID: currentUserProfile?.user_id });
        const buildContent = async (chosenLanguage) => {
            const { rowArticleContentElement: content } = await buildRowArticleContent(
                rowItem, tableName, dataTypes, sortedColumns, buildCreationSeed(rowItem),
                recordTitle.initial, imageRoleColumns.length > 0, currentUserProfile?.user_id ?? null,
                pageLayout ? { sectionDefaults, chosenLanguage, presentationKey: viewKey }
                    : { sectionDefaults, presentationKey: viewKey },
            );
            if (!content || !datasetAppearanceState.isCurrent(appearanceToken)) return null;
            content.querySelectorAll(":scope > .big_card_image").forEach(image => image.remove());
            content.classList.add("image_first_view_article_content");
            placeRowArticleDetails(content, image_first_view_details_position);
            return content;
        };
        const language = getLanguageWithBrowserFallback();
        const contentRequest = buildContent(language);
        contentRequest.catch(() => undefined);
        return { recordTitle, buildContent, language, contentRequest };
    };
    const articleRequest = loadArticle();
    articleRequest.catch(() => undefined);

    // A restored address names the picture the viewer last showed; a clicked thumbnail
    // or article image arrives as activeImageRow, or as the opened imageSrc.
    const pickShownRow = (rows, cardPicture, openedImageChosen) => resolveActiveImageRow(
        rows,
        intent.image ? null : activeImageRow,
        intent.image || (openedImageChosen ? imageSrc : ""),
        cardPicture,
    );
    const buildStage = (rowLabel) => buildRowArticleImageFirstStage({
        imageEntries,
        getActiveRow: () => currentImageRow,
        onSelectRow: (row) => {
            currentImageRow = row;
            updateImageFirstViewImage(historyEntryId, row?.filename || "");
        },
        resolvePath: resolveImagePath,
        resolveAlt: resolveImageAltText,
        tableName,
        rowLabel,
        onBackdropActivate: () => closeImageFirstView?.(),
    });

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
    const ariaLabel = getTranslationForKey("open_article") || "Open article";
    const topControlElements = rowNavigation ? [rowNavigation] : [];
    const mount = (image) => {
        historyEntryId = intent.commit(image);
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
        return modalResult;
    };

    // A fresh opening from a photo already on screen starts growing at once from
    // that photo. Records handed over inside an open view, restored or chosen
    // views, Page, galleries and non-photo media wait for their data as before.
    const shownCardPhoto = !pageLayout && !restoringHistory && !presentationChoice
        && !(Array.isArray(imageRows) && imageRows.length > 0)
        && !isImageFirstModalOpen()
        ? resolveShownCardPhoto(sourceMedia)
        : "";
    if (shownCardPhoto) {
        const shownRow = { asset_kind: "image", filename: shownCardPhoto, is_image_first_fallback: true };
        imageEntries.push({ row: shownRow, index: 0 });
        currentImageRow = shownRow;
        // The viewer is not known yet; the full record label follows with the article.
        const stage = buildStage(resolveRecordTitle({ rowItem, columns: sortedColumns, tableName,
            dataTypes, surface: 'article', currentUserID: null }).text);
        await stage.whenTransitionMediaReady();
        if (!intent.isCurrent()) return null;
        shell.append(stage.element);
        if (!reducedMotion) activateImageFirstStageTransitionMedia(stage.element);
        // The address names the picture once the fresh list confirms it.
        const modalResult = mount("");
        if (!modalResult) return null;
        // Leaves the view this opening put up. A newer opening still pending will
        // replace the view itself: closing now would let the close animation finish
        // on that opening's record (or, without motion, cancel the opening).
        const leaveView = () => {
            if (intent.isOpen() && intent.isLatest()) closeImageFirstView?.();
        };
        // Leaves the view when its data may no longer be shown here; says whether
        // this opening should keep completing it.
        const keepCompleting = () => {
            if (!intent.isOpen()) return false;
            if (datasetAppearanceState.isCurrent(appearanceToken)) return true;
            leaveView();
            return false;
        };
        try {
            const { rows, cardPicture, openedImageChosen } = await imageRowsRequest;
            if (!keepCompleting()) return null;
            if (rows.length === 0) {
                // The fresh list no longer offers a picture: leave at once instead of
                // keeping the card's copy on screen.
                leaveView();
                return null;
            }
            const shownPicture = pickShownRow(rows, cardPicture, openedImageChosen);
            imageEntries.splice(0, imageEntries.length, ...rows.map((row, index) => ({ row, index })));
            currentImageRow = shownPicture;
            // A newer opening still pending must keep the address it captured.
            if (intent.isLatest()) updateImageFirstViewImage(historyEntryId, shownPicture?.filename || "");
            // The card's copy stays only while the fresh list confirms that very
            // picture and its full size decodes; any other picture replaces it now.
            const sameAsShown = resolveRowArticlePictureIdentity(shownPicture?.filename || "")
                === resolveRowArticlePictureIdentity(imageSrc);
            const fullPicture = sameAsShown ? decodePicture(shownPicture.filename) : null;
            stage.sync({ keepMedia: sameAsShown });

            const article = await articleRequest;
            const content = article ? await article.contentRequest : null;
            if (!keepCompleting()) return null;
            if (!content) {
                leaveView();
                return null;
            }
            stage.setRowLabel(article.recordTitle.text);
            shell.append(content);

            if (fullPicture) {
                await fullPicture;
                if (!keepCompleting()) return null;
                // A picture the viewer chose meanwhile has already replaced the copy.
                if (currentImageRow === shownPicture) stage.sync();
            }
            return modalResult;
        } catch (error) {
            leaveView();
            throw error;
        }
    }

    const article = await articleRequest;
    if (!article || !stillWanted()) return null;
    const { rows: resolvedRows, cardPicture, openedImageChosen } = await imageRowsRequest;
    if (!stillWanted() || (!pageLayout && resolvedRows.length === 0 && !textOnlyAllowed)) {
        return null;
    }
    currentImageRow = pickShownRow(resolvedRows, cardPicture, openedImageChosen);
    imageEntries.push(...resolvedRows.map((row, index) => ({ row, index })));
    const stage = pageLayout ? buildRowArticlePageImage({
        imageRow: currentImageRow, resolvePath: resolveImagePath, resolveAlt: resolveImageAltText,
    }) : resolvedRows.length === 0 ? null : buildStage(article.recordTitle.text);
    if (!stage && !pageLayout && !textOnlyAllowed) {
        return null;
    }

    const [rowArticleContentElement] = await Promise.all([
        article.contentRequest, stage?.whenTransitionMediaReady?.(),
    ]);
    if (!rowArticleContentElement || !stillWanted()) return null;

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
    if (stage && !pageLayout && !reducedMotion) {
        activateImageFirstStageTransitionMedia(stage.element);
    }
    const modalResult = mount(currentImageRow?.filename || "");
    if (!historyEntryId) return null;
    if (pageLayout && modalResult) {
        void bindPageArticleReading(shell, rowArticleContentElement, article.buildContent, article.language);
    }
    // The stage builder performs its initial synchronization before returning.
    // Rebuilding the same media after the modal animation has started forces
    // Firefox to decode and paint SVG presentations during their first frame.
    // Later image changes still synchronize through the stage's own controls.
    return modalResult;
}
