// row_article_image_first_stage.js
// Builds the full-viewport image stage used by image-first row articles.
// Bridges ordered article image rows with pointer, keyboard, and touch navigation.
// Exists to keep the ordinary thumbnail gallery unchanged for standard articles.

import { getTranslationForKey } from "../../lang/translation_handler.js";
import { createImageElement } from "./card_avatar_builder.js";
import { CARD_IMAGE_RENDER_SLOTS } from "./card_image_render_options.js";

const SWIPE_NAVIGATION_THRESHOLD_PX = 44;

function resolveBackdropImageValue(imagePath) {
    try {
        const absoluteUrl = new URL(imagePath, window.location.origin);
        return `url("${absoluteUrl.href.replaceAll('"', "%22")}")`;
    } catch {
        return "none";
    }
}

function scrollToArticleContent(stage) {
    const articleContent = stage.nextElementSibling;
    if (!(articleContent instanceof HTMLElement)
        || typeof articleContent.scrollIntoView !== "function") {
        return;
    }
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    articleContent.scrollIntoView({
        behavior: reducedMotion ? "auto" : "smooth",
        block: "start",
    });
}

function rowsMatch(left, right) {
    if (!left || !right) {
        return false;
    }
    if (left.id != null || right.id != null) {
        return String(left.id) === String(right.id);
    }
    return String(left.filename || "") === String(right.filename || "");
}

function isBackdropActivationTarget(target, stage, mediaElement) {
    if (target === stage) {
        return true;
    }
    if (target !== mediaElement) {
        return false;
    }

    // Raster wrappers span the stage so their unused letterbox area can show
    // the blurred backdrop. A framed SVG/logo wrapper is itself the complete
    // presentation surface, including its intentional padding and label.
    return !mediaElement?.matches?.(
        ".record_svg_image_frame, .service_catalog_logo_frame",
    );
}

function buildImageArrow(direction, activate) {
    const isPrevious = direction === "previous";
    const langKey = isPrevious ? "previous_image" : "next_image";
    const fallback = isPrevious ? "Previous image" : "Next image";
    const button = document.createElement("button");
    button.type = "button";
    button.classList.add(
        "row_article_image_first_arrow",
        `row_article_image_first_arrow--${direction}`,
        "fw-btn",
        "fw-btn--ghost",
    );
    button.dataset.testid = `row-article-image-${direction}`;
    button.dataset.titleLangKey = langKey;
    button.dataset.ariaLabelLangKey = langKey;
    button.textContent = isPrevious ? "‹" : "›";
    button.title = getTranslationForKey(langKey) || fallback;
    button.setAttribute("aria-label", button.title);
    button.addEventListener("click", (event) => {
        event.stopPropagation();
        activate();
    });
    return button;
}

/**
 * Creates a 100dvh media stage with same-row image navigation.
 */
export function buildRowArticleImageFirstStage({
    imageEntries,
    getActiveRow,
    onSelectRow,
    onBackdropActivate = null,
    resolvePath,
    resolveAlt,
    tableName = "",
    rowLabel = "",
}) {
    if (!Array.isArray(imageEntries) || imageEntries.length === 0) {
        return null;
    }

    const stage = document.createElement("div");
    stage.classList.add("row_article_image_first_stage");
    stage.dataset.testid = "row-article-image-first-stage";
    stage.tabIndex = 0;
    stage.setAttribute("role", "group");
    stage.setAttribute("aria-roledescription", "carousel");
    stage.dataset.ariaLabelLangKey = "images";
    stage.setAttribute("aria-label", getTranslationForKey("images") || "Images");

    let mediaElement = null;

    const previousButton = buildImageArrow("previous", () => activateRelative(-1));
    const nextButton = buildImageArrow("next", () => activateRelative(1));

    const position = document.createElement("span");
    position.classList.add("row_article_image_first_position");
    position.dataset.testid = "row-article-image-position";
    position.setAttribute("aria-live", "polite");

    const scrollHint = document.createElement("button");
    scrollHint.type = "button";
    scrollHint.classList.add(
        "row_article_image_first_scroll_hint",
        "fw-btn",
        "fw-btn--ghost",
    );
    scrollHint.dataset.testid = "row-article-image-scroll-hint";
    scrollHint.dataset.titleLangKey = "show_more";
    scrollHint.dataset.ariaLabelLangKey = "show_more";
    scrollHint.textContent = getTranslationForKey("show_more") || "Show article";
    scrollHint.title = scrollHint.textContent;
    scrollHint.setAttribute("aria-label", scrollHint.textContent);
    const scrollHintArrow = document.createElement("span");
    scrollHintArrow.setAttribute("aria-hidden", "true");
    scrollHintArrow.textContent = "⌄";
    scrollHint.appendChild(scrollHintArrow);
    scrollHint.addEventListener("click", (event) => {
        event.stopPropagation();
        scrollToArticleContent(stage);
    });

    const activeIndex = () => {
        const index = imageEntries.findIndex(({ row }) => rowsMatch(row, getActiveRow()));
        return index >= 0 ? index : 0;
    };

    const sync = () => {
        const index = activeIndex();
        const row = imageEntries[index]?.row;
        if (!row) {
            return;
        }
        const imagePath = resolvePath(row.filename);
        const nextMediaElement = createImageElement(imagePath, true, {
            tableName,
            rowLabel,
            renderSlot: CARD_IMAGE_RENDER_SLOTS.IMAGE_FIRST,
            imageTypeId: row?.type_id,
            imageMetadata: row?.metadata_json,
            imageTitle: row?.title,
            imageOriginalName: row?.original_name,
            imageMimeType: row?.mime_type,
        });
        nextMediaElement.classList.add("row_article_image_first_media");
        nextMediaElement.setAttribute("aria-label", resolveAlt(row) || rowLabel || "Image");
        const primaryImage = nextMediaElement.querySelector("img");
        if (primaryImage) {
            primaryImage.dataset.testid = "row-article-image-first-media";
        } else {
            nextMediaElement.dataset.testid = "row-article-image-first-media";
        }
        const visibleImage = nextMediaElement.querySelector("img:not([aria-hidden='true'])");
        if (visibleImage) {
            visibleImage.alt = resolveAlt(row);
        }
        if (mediaElement) {
            mediaElement.replaceWith(nextMediaElement);
        } else {
            stage.insertBefore(nextMediaElement, previousButton);
        }
        mediaElement = nextMediaElement;
        stage.style.setProperty(
            "--row-article-image-first-backdrop",
            resolveBackdropImageValue(imagePath),
        );
        previousButton.disabled = index === 0;
        nextButton.disabled = index === imageEntries.length - 1;
        position.textContent = `${index + 1} / ${imageEntries.length}`;
    };

    function activateRelative(delta) {
        const nextIndex = activeIndex() + delta;
        if (nextIndex < 0 || nextIndex >= imageEntries.length) {
            return;
        }
        onSelectRow(imageEntries[nextIndex].row);
        sync();
    }

    stage.addEventListener("keydown", (event) => {
        if (event.key === "ArrowLeft") {
            event.preventDefault();
            activateRelative(-1);
        } else if (event.key === "ArrowRight") {
            event.preventDefault();
            activateRelative(1);
        }
    });

    stage.addEventListener("click", (event) => {
        if (isBackdropActivationTarget(event.target, stage, mediaElement)
            && typeof onBackdropActivate === "function") {
            onBackdropActivate();
        }
    });

    let touchStartX = null;
    stage.addEventListener("touchstart", (event) => {
        touchStartX = event.touches?.[0]?.clientX ?? null;
    }, { passive: true });
    stage.addEventListener("touchend", (event) => {
        const touchEndX = event.changedTouches?.[0]?.clientX;
        if (touchStartX == null || !Number.isFinite(touchEndX)) {
            touchStartX = null;
            return;
        }
        const deltaX = touchEndX - touchStartX;
        touchStartX = null;
        if (Math.abs(deltaX) < SWIPE_NAVIGATION_THRESHOLD_PX) {
            return;
        }
        activateRelative(deltaX > 0 ? -1 : 1);
    }, { passive: true });

    stage.append(previousButton, nextButton, position, scrollHint);
    sync();
    return { element: stage, sync };
}
