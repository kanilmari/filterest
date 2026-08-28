// image_first_view_activation.js
// Lazily activates the standalone image-first view from ordinary card media.
// Bridges the card builder to the viewer without creating a static module cycle.
// Exists because the viewer reuses the article content builder used by cards.

const imageFirstActivationBindings = new WeakMap();

export async function activateImageFirstView(options) {
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

    const imageSrc = String(options.imageSrc || "").trim();
    const previousBinding = imageFirstActivationBindings.get(element);
    if (previousBinding) {
        element.removeEventListener("click", previousBinding.click);
        element.removeEventListener("keydown", previousBinding.keydown);
    }
    const openImageView = () => {
        void activate(options).catch((error) => {
            console.warn(
                "image-first view could not be opened",
                error?.message || error,
            );
        });
    };

    element.tabIndex = 0;
    element.setAttribute("role", "button");
    element.dataset.imageFirstSrc = imageSrc;
    element.dataset.ariaLabelLangKey = "open_article";
    element.setAttribute("aria-label", "Open article");
    const handleKeydown = (event) => {
        if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            openImageView();
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
