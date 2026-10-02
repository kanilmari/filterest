// row_article_inline_media.js
// Adds shared image controls to ordinary articles using their already permitted assets.
// Connects article hydration, image-first activation and localized picture captions.
// Keeps image browsing local to the article without reopening or reloading its result list.
import { createImageElement } from "./card_avatar_builder.js";
import { CARD_IMAGE_RENDER_SLOTS } from "./card_image_render_options.js";
import { bindImageFirstViewActivation } from "./image_first_view_activation.js";
import { resolveImagePath } from "./row_article_content_builder_helpers.js";
import {
    resolveRowArticleImageRows,
    resolveRowArticleMainImageRow,
    resolveRowArticlePictureIdentity,
} from "./row_article_image_rows.js";
import { syncRowArticleInlineImageCaptions } from "./row_article_image_caption.js";
import { buildRowArticleImageArrow, buildRowArticleImagePosition } from "./row_article_image_controls.js";
import { buildRowArticleRowNavigation } from "./row_article_presentation.js";
import { enable_experimental_row_article_row_navigation } from "../../../ui_config.js";

const controllers = new WeakMap();

/**
 * Reuses each inline media surface while authorized child rows hydrate or refresh.
 * The rows are what the article shows, in the server's gallery order with a card-only
 * picture first. The article's main image is the row showing context.cardPicture, the
 * picture the server says the card shows, otherwise the first row. context.fromResponse
 * marks rows from a related-rows response, which decides the image shown; without it
 * the rows are the row's own image fields standing in until a response arrives.
 */
export function syncRowArticleInlineMedia(article, rows = [], context = {}) {
    if (!(article instanceof HTMLElement)) return;
    const images = resolveRowArticleImageRows(rows).filter(row => row?.filename);
    for (const container of article.querySelectorAll(".big_card_image[data-row-article-image-column]")) {
        let controller = controllers.get(container);
        if (!controller) {
            controller = buildInlineMedia(container, article, context);
            if (!controller) continue;
            controllers.set(container, controller);
        }
        controller.update(images, context);
    }
    syncRowArticleInlineImageCaptions(article, images);
}

/** Releases observers before an article or its retained host is discarded. */
export function disposeRowArticleInlineMedia(article) {
    for (const container of article?.querySelectorAll?.(".big_card_image[data-row-article-image-column]") || []) {
        controllers.get(container)?.dispose();
        controllers.delete(container);
    }
}

function buildInlineMedia(container, article, initialContext) {
    let media = container.querySelector(":scope > [data-image-first-src], :scope > .wrapper, :scope > img");
    if (!media) return null;
    const frame = document.createElement("div");
    frame.className = "row_article_inline_media";
    frame.dataset.testid = "row-article-inline-media";
    frame.tabIndex = 0;
    frame.setAttribute("role", "group");
    frame.setAttribute("aria-roledescription", "carousel");
    frame.dataset.ariaLabelLangKey = "images";
    frame.setAttribute("aria-label", "Images");
    media.before(frame);
    frame.append(media);
    let context = initialContext, images = [], index = 0, managedImage = false, disposed = false;
    // viewerChose: the shown image is one the viewer browsed to after a response decided
    // the start; hadResponse: a related-rows response has decided the shown image once.
    let viewerChose = false, hadResponse = false;
    const events = new AbortController();
    const canInteract = () => !disposed && article.isConnected && context.canCommit?.() !== false;
    // The picture shown, by identity: another host or query is another picture.
    let currentPicture = resolveRowArticlePictureIdentity(media.dataset.imageFirstSrc
        || media.querySelector("img")?.getAttribute("src") || media.getAttribute("src"));
    const previous = buildRowArticleImageArrow("previous", () => { if (canInteract()) browse(index - 1); });
    const next = buildRowArticleImageArrow("next", () => { if (canInteract()) browse(index + 1); });
    const position = buildRowArticleImagePosition();
    const records = document.createElement("div");
    records.className = "row_article_inline_record_controls";
    const topControls = document.createElement("div");
    topControls.className = "row_article_inline_top_controls";
    topControls.append(records, position);
    frame.append(previous, next, topControls);

    function refreshRecordNavigation() {
        const cardContainer = context.selectedCard?.closest?.(".card_container");
        if (!enable_experimental_row_article_row_navigation || !cardContainer) return;
        const navigation = buildRowArticleRowNavigation({
            cardContainer, currentRowId: context.rowItem?.id,
            onNavigate: async (row, card) => {
                if (!canInteract() || records.getAttribute("aria-busy") === "true") return;
                records.setAttribute("aria-busy", "true");
                try {
                    const { openRowArticleView } = await import("./row_article_opener.js");
                    if (canInteract()) await openRowArticleView(row, context.tableName, card);
                } catch (error) {
                    console.warn("Article record navigation failed:", error?.message || error);
                } finally { records.removeAttribute("aria-busy"); }
            },
        });
        const focusedControl = records.contains(document.activeElement) ? document.activeElement?.dataset?.testid : "";
        records.replaceChildren(...(navigation ? [navigation] : []));
        records.hidden = !navigation;
        if (focusedControl) {
            Array.from(records.querySelectorAll("button")).find(button => button.dataset.testid === focusedControl)
                ?.focus({ preventScroll: true });
        }
    }
    // Refresh bounded record navigation when the article list gains a new page.
    // Observation is attached to the owning article, never a global list registry.
    const cardContainer = context.selectedCard?.closest?.(".card_container");
    let observer = null;
    if (cardContainer) {
        observer = new MutationObserver(() => {
            if (!frame.isConnected) { observer.disconnect(); return; }
            refreshRecordNavigation();
        });
        observer.observe(cardContainer, { childList: true });
    }
    function paintControls() {
        const available = images.length > 0 && index >= 0;
        previous.disabled = !available || index === 0;
        next.disabled = !available || index === images.length - 1;
        position.textContent = available ? (index + 1) + " / " + images.length : "";
        position.hidden = !available;
        refreshRecordNavigation();
    }
    /** Shows the image at nextIndex; returns false when there is none. */
    function select(nextIndex) {
        if (nextIndex < 0 || nextIndex >= images.length) return false;
        index = nextIndex;
        managedImage = true;
        const row = images[index], src = resolveImagePath(row.filename);
        const nextMedia = createImageElement(src, true, {
            tableName: context.tableName, rowLabel: context.rowLabel,
            renderSlot: CARD_IMAGE_RENDER_SLOTS.ROW_ARTICLE_INLINE,
            imageTypeId: row.type_id, imageMetadata: row.metadata_json,
            imageTitle: row.title, imageOriginalName: row.original_name, imageMimeType: row.mime_type,
        });
        bindImageFirstViewActivation(nextMedia, {
            imageSrc: src, imageRows: images, activeImageRow: row,
            rowItem: context.rowItem, tableName: context.tableName, selectedCard: context.selectedCard,
        });
        const restoreMediaFocus = media === document.activeElement || media.contains(document.activeElement);
        media.replaceWith(nextMedia);
        media = nextMedia;
        if (restoreMediaFocus) media.focus({ preventScroll: true });
        currentPicture = resolveRowArticlePictureIdentity(row.filename);
        syncRowArticleInlineImageCaptions(article, images);
        paintControls();
        return true;
    }
    /** Shows the image the viewer browsed to, which later refreshes keep while listed. */
    function browse(nextIndex) {
        if (select(nextIndex)) viewerChose = true;
    }
    frame.addEventListener("keydown", event => {
        if (!canInteract()) return;
        if (event.target.closest("a, input, textarea, select") || event.altKey || event.ctrlKey || event.metaKey) return;
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
            event.preventDefault(); event.stopPropagation();
            browse(index + (event.key === "ArrowLeft" ? -1 : 1));
        }
    }, { signal: events.signal });
    let touchStart = null;
    frame.addEventListener("touchstart", event => {
        if (!canInteract()) return;
        touchStart = event.target.closest("button, a") ? null : event.touches?.[0] || null;
    }, { passive: true, signal: events.signal });
    frame.addEventListener("touchend", event => {
        const end = event.changedTouches?.[0], start = touchStart;
        touchStart = null;
        if (!canInteract() || !start || !end) return;
        const delta = end.clientX - start.clientX;
        if (Math.abs(delta) >= 44 && Math.abs(delta) > Math.abs(end.clientY - start.clientY)) {
            browse(index + (delta > 0 ? -1 : 1));
        }
    }, { passive: true, signal: events.signal });
    return { dispose() {
        disposed = true;
        observer?.disconnect();
        events.abort();
        records.replaceChildren();
    }, update(nextImages, nextContext) {
        if (disposed) return;
        context = nextContext;
        images = nextImages;
        index = images.findIndex(row => resolveRowArticlePictureIdentity(row.filename) === currentPicture);
        // A related-rows response decides which image shows. The first one starts on the
        // main image, the card's picture wherever the rows list it, even when they also
        // list the row's earlier picture. A later one, after an upload or a save, keeps an
        // image the viewer browsed to while the rows still list it, and otherwise follows
        // the main image. Before any response the row's own fields keep the shown image
        // while they list it.
        const fromResponse = context.fromResponse === true;
        const keepViewerChoice = fromResponse && hadResponse && viewerChose && index >= 0;
        const keepShown = keepViewerChoice || (!fromResponse && index >= 0);
        if (fromResponse) {
            hadResponse = true;
            if (!keepViewerChoice) viewerChose = false;
        }
        if (managedImage && images.length === 0) {
            // A formerly selected asset was removed or became unavailable.
            // Remove both its pixels and activation binding rather than retaining stale rows.
            const empty = document.createElement("span");
            empty.className = "row_article_inline_media_empty";
            media.replaceWith(empty); media = empty; currentPicture = "";
        } else if (images.length > 0 && (managedImage || index >= 0 || images.length === 1)) {
            // Taken over: an image the rows show or one managed before. An inline image no
            // row shows and that was never managed is left untouched.
            const target = keepShown ? index : images.indexOf(resolveRowArticleMainImageRow(images, context.cardPicture));
            if (target !== index) {
                select(target);
            } else {
                managedImage = true;
                bindImageFirstViewActivation(media, {
                    imageSrc: resolveImagePath(images[index].filename), imageRows: images, activeImageRow: images[index],
                    rowItem: context.rowItem, tableName: context.tableName, selectedCard: context.selectedCard,
                });
            }
        }
        paintControls();
    } };
}
