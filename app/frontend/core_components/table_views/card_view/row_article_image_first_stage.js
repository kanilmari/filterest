// row_article_image_first_stage.js
// Builds the full-viewport image stage used by image-first row articles.
// Bridges ordered article image rows with pointer, keyboard, and touch navigation.
// Exists to keep the ordinary thumbnail gallery unchanged for standard articles.

import { getTranslationForKey } from "../../lang/translation_handler.js";
import { createImageElement } from "./card_avatar_builder.js";
import { CARD_IMAGE_RENDER_SLOTS } from "./card_image_render_options.js";
import { isSvgImageAsset } from "./svg_image_presentation.js";

const SWIPE_NAVIGATION_THRESHOLD_PX = 44;
const SVG_BACKDROP_RASTER_MAX_EDGE_PX = 1024;
const SVG_BACKDROP_IMAGE_READY_TIMEOUT_MS = 2000;
const imageFirstStageTransitionMediaStates = new WeakMap();
const IMAGE_FIRST_CONTROL_SELECTOR = [
    ".row_article_image_first_arrow",
    ".row_article_image_first_position",
    ".row_article_image_first_scroll_hint",
].join(", ");

function resolveBackdropImageValue(imagePath) {
    try {
        const absoluteUrl = new URL(imagePath, window.location.href);
        const cssSafeHref = absoluteUrl.href
            .replaceAll("\\", "%5C")
            .replaceAll('"', "%22")
            .replaceAll("'", "%27")
            .replaceAll("(", "%28")
            .replaceAll(")", "%29");
        return `url("${cssSafeHref}")`;
    } catch {
        return "none";
    }
}

function waitForImageReady(imageElement) {
    if (!(imageElement instanceof HTMLImageElement)) {
        return Promise.reject(new Error("image-first backdrop image is unavailable"));
    }
    if (!imageElement.isConnected && typeof imageElement.decode !== "function") {
        return Promise.reject(new Error("image-first backdrop image cannot be decoded"));
    }
    if (imageElement.complete && imageElement.naturalWidth > 0) {
        return typeof imageElement.decode === "function"
            ? imageElement.decode().catch(() => undefined)
            : Promise.resolve();
    }

    return new Promise((resolve, reject) => {
        const timeout = window.setTimeout(() => {
            cleanup();
            reject(new Error("image-first backdrop image did not become ready"));
        }, SVG_BACKDROP_IMAGE_READY_TIMEOUT_MS);
        const cleanup = () => {
            window.clearTimeout(timeout);
            imageElement.removeEventListener("load", handleLoad);
            imageElement.removeEventListener("error", handleError);
        };
        const handleLoad = () => {
            cleanup();
            resolve();
        };
        const handleError = () => {
            cleanup();
            reject(new Error("image-first backdrop image could not be loaded"));
        };
        imageElement.addEventListener("load", handleLoad, { once: true });
        imageElement.addEventListener("error", handleError, { once: true });
    });
}

/**
 * Rasterizes one SVG once for the blurred backdrop and temporary moving copy.
 * The visible foreground stays vector except while it is actively scaling, so
 * Firefox can composite the transition without repainting SVG paths each frame.
 */
async function resolvePreparedSvgTransitionMedia({
    imageElement,
    imagePath,
    imageRow,
}) {
    const fallbackValue = resolveBackdropImageValue(imagePath);
    if (!isSvgImageAsset({
        imageSrc: imagePath,
        imageMimeType: imageRow?.mime_type,
        imageOriginalName: imageRow?.original_name,
        imageMetadata: imageRow?.metadata_json,
    })) {
        return {
            backdropValue: fallbackValue,
            originalImageSource: "",
            transitionImageSource: "",
        };
    }

    const originalImageSource = imageElement?.getAttribute?.("src") || "";
    try {
        await waitForImageReady(imageElement);
        const naturalWidth = Number(imageElement.naturalWidth);
        const naturalHeight = Number(imageElement.naturalHeight);
        if (naturalWidth <= 0 || naturalHeight <= 0) {
            throw new Error("image-first SVG has no drawable dimensions");
        }

        const scale = Math.min(
            1,
            SVG_BACKDROP_RASTER_MAX_EDGE_PX / Math.max(naturalWidth, naturalHeight),
        );
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(naturalHeight * scale));
        const context = canvas.getContext("2d");
        if (!context) {
            throw new Error("image-first SVG raster canvas is unavailable");
        }
        context.drawImage(imageElement, 0, 0, canvas.width, canvas.height);
        const transitionImageSource = canvas.toDataURL("image/png");
        const transitionImage = new Image();
        transitionImage.src = transitionImageSource;
        if (typeof transitionImage.decode === "function") {
            await transitionImage.decode();
        } else {
            await waitForImageReady(transitionImage);
        }
        return {
            backdropValue: resolveBackdropImageValue(transitionImageSource),
            originalImageSource,
            transitionImageSource,
        };
    } catch {
        // Cross-origin or malformed SVGs retain the safe ordinary image path.
        if (originalImageSource && imageElement instanceof HTMLImageElement) {
            imageElement.src = originalImageSource;
        }
        return {
            backdropValue: fallbackValue,
            originalImageSource: "",
            transitionImageSource: "",
        };
    }
}

/**
 * Switches a prepared SVG stage to its decoded raster only while it scales.
 * This keeps open, close, and record handoff animations on the compositor.
 */
export function activateImageFirstStageTransitionMedia(stageElement) {
    const state = imageFirstStageTransitionMediaStates.get(stageElement);
    if (!(state?.imageElement instanceof HTMLImageElement)
        || !state.transitionImageSource) {
        return;
    }
    state.imageElement.src = state.transitionImageSource;
}

/** Restores the original vector after the size transition has completed. */
export function settleImageFirstStageTransitionMedia(stageElement) {
    const state = imageFirstStageTransitionMediaStates.get(stageElement);
    if (!(state?.imageElement instanceof HTMLImageElement)
        || !state.originalImageSource) {
        return;
    }
    state.imageElement.src = state.originalImageSource;
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

function isPointInsideContainedImage(event, image) {
    const bounds = image.getBoundingClientRect();
    const naturalWidth = Number(image.naturalWidth);
    const naturalHeight = Number(image.naturalHeight);
    if (bounds.width <= 0 || bounds.height <= 0
        || naturalWidth <= 0 || naturalHeight <= 0) {
        // Until the image has measurable geometry, favor keeping the view open
        // instead of treating a real image click as backdrop activation.
        return true;
    }

    const containedScale = Math.min(
        bounds.width / naturalWidth,
        bounds.height / naturalHeight,
    );
    const contentWidth = naturalWidth * containedScale;
    const contentHeight = naturalHeight * containedScale;
    const contentLeft = bounds.left + ((bounds.width - contentWidth) / 2);
    const contentTop = bounds.top + ((bounds.height - contentHeight) / 2);

    return event.clientX >= contentLeft
        && event.clientX <= contentLeft + contentWidth
        && event.clientY >= contentTop
        && event.clientY <= contentTop + contentHeight;
}

function isBackdropActivationTarget(event, stage, mediaElement) {
    const { target } = event;
    if (target instanceof Element && target.closest(IMAGE_FIRST_CONTROL_SELECTOR)) {
        return false;
    }
    if (target === stage) {
        return true;
    }
    if (!(target instanceof Element) || !(mediaElement instanceof Element)) {
        return false;
    }

    // Raster wrappers span the stage, so their unused letterbox area is the
    // clickable backdrop. A CSS-composed logo or framed SVG is itself the
    // complete presentation surface; an image-backed service logo is not,
    // because only its nested img occupies the visible media rectangle.
    if (mediaElement?.matches?.(".record_svg_image_frame")) {
        return false;
    }
    if (mediaElement?.matches?.(".service_catalog_logo_frame")) {
        if (mediaElement.dataset.serviceCatalogLogoRenderMode !== "image") {
            return false;
        }
    }

    if (target === mediaElement) {
        return true;
    }

    const visibleImage = target.closest("img:not([aria-hidden='true'])");
    if (visibleImage && mediaElement.contains(visibleImage)) {
        return !isPointInsideContainedImage(event, visibleImage);
    }
    return false;
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
    let transitionMediaPreparation = Promise.resolve();
    let transitionMediaPreparationRevision = 0;

    const revealCluster = document.createElement("div");
    revealCluster.classList.add("row_article_image_first_reveal_cluster");
    revealCluster.dataset.testid = "row-article-image-first-reveal-cluster";
    const revealTitle = document.createElement("div");
    revealTitle.classList.add("row_article_image_first_reveal_title");
    revealTitle.dataset.testid = "row-article-image-first-reveal-title";
    revealTitle.setAttribute("aria-hidden", "true");
    revealTitle.textContent = rowLabel;
    revealTitle.hidden = !rowLabel;
    revealCluster.appendChild(revealTitle);
    revealCluster.addEventListener("animationend", (event) => {
        if (event.target !== revealCluster) {
            return;
        }
        if ([
            "image-first-foreground-grow",
            "image-first-record-media-grow",
        ].includes(event.animationName)) {
            settleImageFirstStageTransitionMedia(stage);
        }
    });

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
            revealCluster.insertBefore(nextMediaElement, revealTitle);
        }
        mediaElement = nextMediaElement;
        const imageIsSvg = isSvgImageAsset({
            imageSrc: imagePath,
            imageMimeType: row?.mime_type,
            imageOriginalName: row?.original_name,
            imageMetadata: row?.metadata_json,
        });
        const preparationRevision = ++transitionMediaPreparationRevision;
        if (!imageIsSvg) {
            stage.style.setProperty(
                "--row-article-image-first-backdrop",
                resolveBackdropImageValue(imagePath),
            );
            transitionMediaPreparation = Promise.resolve();
        } else {
            const backdropImage = nextMediaElement.querySelector("img");
            transitionMediaPreparation = resolvePreparedSvgTransitionMedia({
                imageElement: backdropImage,
                imagePath,
                imageRow: row,
            }).then((preparedMedia) => {
                if (preparationRevision !== transitionMediaPreparationRevision) {
                    return;
                }
                stage.style.setProperty(
                    "--row-article-image-first-backdrop",
                    preparedMedia.backdropValue,
                );
                if (preparedMedia.transitionImageSource) {
                    imageFirstStageTransitionMediaStates.set(stage, {
                        imageElement: backdropImage,
                        originalImageSource: preparedMedia.originalImageSource,
                        transitionImageSource: preparedMedia.transitionImageSource,
                    });
                } else {
                    imageFirstStageTransitionMediaStates.delete(stage);
                }
            });
        }
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
        if (isBackdropActivationTarget(event, stage, mediaElement)
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

    stage.append(revealCluster, previousButton, nextButton, position, scrollHint);
    sync();
    return {
        element: stage,
        sync,
        whenTransitionMediaReady: () => transitionMediaPreparation,
    };
}
