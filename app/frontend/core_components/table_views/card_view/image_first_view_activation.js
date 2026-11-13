// image_first_view_activation.js
// Lazily activates the standalone image-first view from ordinary card media.
// Bridges the card builder to the viewer without creating a static module cycle.
// Exists because the viewer reuses the article content builder used by cards.

import { applyArticleViewAffordance, canOpenArticleView, requireArticleViewAccess } from './article_view_access.js';
import { PHONE_BREAKPOINT_PX } from '../../../ui_config.js';

const imageFirstActivationBindings = new WeakMap();

function imageViewKey(layout) {
    return layout === "page" ? "image_first_page_view" : "image_first_view";
}

function imageLayout(cardListImage, layout) {
    return cardListImage && window.innerWidth <= PHONE_BREAKPOINT_PX ? "page" : layout;
}

function applyImageAffordance(element, layout) {
    const allowed = canOpenArticleView(imageViewKey(layout));
    if (element.dataset.articleAccess === (allowed ? "allowed" : "denied")) return;
    element.tabIndex = 0;
    element.setAttribute("role", "button");
    element.dataset.ariaLabelLangKey = "open_article";
    element.setAttribute("aria-label", "Open article");
    applyArticleViewAffordance(element, () => allowed);
}

// The existing card resize pass updates keyboard access when the presentation changes.
export function refreshCardListImageAffordance(element) {
    applyImageAffordance(element, imageLayout(true));
}

export async function activateImageFirstView(options) {
    if (!requireArticleViewAccess(imageViewKey(options.layout))) return null;
    const { openImageFirstView } = await import("./image_first_view_opener.js");
    return openImageFirstView(options);
}

/**
 * Makes existing card or article media open the shared image-first view.
 * The caller retains ownership of media rendering while this module owns the
 * common pointer, keyboard, accessibility, and lazy-view activation contract.
 */
export function bindImageFirstViewActivation(
    element,
    options = {},
    activate = activateImageFirstView,
) {
    if (!(element instanceof HTMLElement)) {
        return null;
    }

    const { cardListImage, ...viewerOptions } = options;
    const imageSrc = String(options.imageSrc || "").trim();
    const previousBinding = imageFirstActivationBindings.get(element);
    if (previousBinding) {
        element.removeEventListener("click", previousBinding.click);
        element.removeEventListener("keydown", previousBinding.keydown);
    }
    const openImageView = (event) => {
        const layout = imageLayout(cardListImage, options.layout);
        if (!requireArticleViewAccess(imageViewKey(layout))) {
            event?.preventDefault();
            event?.stopPropagation();
            return;
        }
        void activate(layout ? { ...viewerOptions, layout } : viewerOptions).catch((error) => {
            console.warn(
                "image-first view could not be opened",
                error?.message || error,
            );
        });
    };

    element.dataset.imageFirstSrc = imageSrc;
    element.toggleAttribute("data-card-list-image", Boolean(cardListImage));
    applyImageAffordance(element, imageLayout(cardListImage, options.layout));
    const handleKeydown = (event) => {
        if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            openImageView(event);
        }
    };
    element.addEventListener("click", openImageView);
    element.addEventListener("keydown", handleKeydown);
    imageFirstActivationBindings.set(element, {
        click: openImageView,
        keydown: handleKeydown,
    });
    return element;
}
