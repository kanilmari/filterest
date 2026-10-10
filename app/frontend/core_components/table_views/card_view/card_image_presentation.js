// card_image_presentation.js
// Applies the site's three presentation modes only to raster card media.
// Connects the shared appearance setting with existing card image wrappers.
// Keeps article images, SVG logos, avatars and thumbnails on their own rendering paths.

import { readAppearanceAttribute, appearanceScopeElements } from '../../../reusable_components/appearance_scope_reader.js';
import { projectAppearanceAttribute, projectAppearanceStyle } from '../../../reusable_components/appearance_projection_writer.js';

export const CARD_IMAGE_PRESENTATIONS = Object.freeze(['cover', 'contain', 'contain_blur']);

export function normalizeCardImagePresentation(value) {
    return CARD_IMAGE_PRESENTATIONS.includes(value) ? value : 'contain';
}

export function applyCardImagePresentationSetting(value, scope = document.documentElement) {
    projectAppearanceAttribute(scope, 'cardImagePresentation', normalizeCardImagePresentation(value));
    appearanceScopeElements(scope, '.card_photo_presentation').forEach(wrapper => {
        projectAppearanceAttribute(wrapper, 'cardImagePresentation', scope.dataset.cardImagePresentation);
        wrapper._refreshImagePresentation?.();
    });
}

function isContainBlurPresentation(wrapper) {
    return readAppearanceAttribute(wrapper, 'cardImagePresentation') === 'contain_blur';
}

/** Decorative CSS uses the same resolved URL; the accessible image stays the single img. */
export function prepareCardImagePresentation(wrapper, image) {
    if (wrapper.dataset.cardImageRenderSlot !== 'card_media'
        || wrapper.dataset.imagePresentationKind !== 'raster'
        || image.parentElement !== wrapper) return false;
    wrapper.classList.add('card_photo_presentation');
    wrapper.style.backgroundColor = 'var(--bg_color)';
    image.style.setProperty('object-fit', 'var(--card-photo-object-fit, contain)', 'important');
    let hasLoaded = image.complete;
    const updateBackdrop = () => {
        projectAppearanceAttribute(wrapper, 'cardImagePresentation', normalizeCardImagePresentation(readAppearanceAttribute(wrapper, 'cardImagePresentation')));
        if (!isContainBlurPresentation(wrapper) || (!hasLoaded && !image.complete)) {
            projectAppearanceStyle(wrapper, '--card-photo-source', null);
            return;
        }
        const source = image.currentSrc || image.src;
        if (!source) {
            projectAppearanceStyle(wrapper, '--card-photo-source', null);
            return;
        }
        projectAppearanceStyle(wrapper, '--card-photo-source', `url(${JSON.stringify(source)})`);
    };
    wrapper._refreshImagePresentation = updateBackdrop;
    updateBackdrop();
    image.addEventListener('load', () => {
        hasLoaded = true;
        // Lifecycle cleanup revoked this wrapper's projection. A late image
        // event cannot recreate it; an explicit adapter paint enables it again.
        if (wrapper.dataset.cardImagePresentation) updateBackdrop();
    });
    image.addEventListener('error', () => {
        hasLoaded = false;
        projectAppearanceStyle(wrapper, '--card-photo-source', null);
    });
    return true;
}
