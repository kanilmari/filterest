// card_image_presentation.js
// Applies the site's three presentation modes only to raster card media.
// Connects the shared appearance setting with existing card image wrappers.
// Keeps article images, SVG logos, avatars and thumbnails on their own rendering paths.

export const CARD_IMAGE_PRESENTATIONS = Object.freeze(['cover', 'contain', 'contain_blur']);

export function normalizeCardImagePresentation(value) {
    return CARD_IMAGE_PRESENTATIONS.includes(value) ? value : 'contain';
}

export function applyCardImagePresentationSetting(value) {
    document.documentElement.dataset.cardImagePresentation = normalizeCardImagePresentation(value);
}

function isContainBlurPresentation() {
    return document.documentElement.dataset.cardImagePresentation === 'contain_blur';
}

/** Decorative CSS uses the same resolved URL; the accessible image stays the single img. */
export function prepareCardImagePresentation(wrapper, image) {
    if (wrapper.dataset.cardImageRenderSlot !== 'card_media'
        || wrapper.dataset.imagePresentationKind !== 'raster'
        || image.parentElement !== wrapper) return false;
    wrapper.classList.add('card_photo_presentation');
    wrapper.style.backgroundColor = 'var(--bg_color)';
    image.style.setProperty('object-fit', 'var(--card-photo-object-fit, contain)', 'important');
    const updateBackdrop = () => {
        if (!isContainBlurPresentation()) {
            wrapper.style.removeProperty('--card-photo-source');
            return;
        }
        const source = image.currentSrc || image.src;
        if (!source) {
            wrapper.style.removeProperty('--card-photo-source');
            return;
        }
        wrapper.style.setProperty('--card-photo-source', `url(${JSON.stringify(source)})`);
    };
    if (image.complete) {
        updateBackdrop();
    }
    image.addEventListener('load', updateBackdrop);
    image.addEventListener('error', () => wrapper.style.removeProperty('--card-photo-source'));
    return true;
}
