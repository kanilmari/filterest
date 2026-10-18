// card_image_presentation.js
// Applies the site's three presentation modes only to raster card media.
// Connects the shared appearance setting with existing card image wrappers.
// Keeps article images, SVG logos, avatars and thumbnails on their own rendering paths.

import { addCardResourceListener } from './card_resource_lifecycle.js';
import { APPEARANCE_SCOPE_SELECTOR, readAppearanceAttribute, appearanceScopeElements } from '../../../reusable_components/appearance_scope_reader.js';
import { projectAppearanceAttribute, projectAppearanceStyle } from '../../../reusable_components/appearance_projection_writer.js';
import { CARD_IMAGE_PRESENTATIONS, resolveCardImagePresentation } from './card_image_presentation_resolver.js';

export { CARD_IMAGE_PRESENTATIONS };

export function normalizeCardImagePresentation(value) {
    return CARD_IMAGE_PRESENTATIONS.includes(value) ? value : 'contain';
}

export function applyCardImagePresentationSetting(value, scope = document.documentElement, defaults) {
    scope._cardImageDefaults = defaults || { site: value };
    projectAppearanceAttribute(scope, 'cardImagePresentation', normalizeCardImagePresentation(value));
    appearanceScopeElements(scope, '.card_photo_presentation').forEach(wrapper => {
        wrapper._cardImageDefaults = scope._cardImageDefaults;
        wrapper._refreshImagePresentation?.();
    });
}

function isContainBlurPresentation(wrapper) {
    return wrapper.dataset.cardImagePresentation === 'contain_blur';
}

/** Decorative CSS uses the same resolved URL; the accessible image stays the single img. */
export function prepareCardImagePresentation(wrapper, image, { cardImageOwn, cardImageUse } = {}) {
    if (wrapper.dataset.cardImageRenderSlot !== 'card_media'
        || wrapper.dataset.imagePresentationKind !== 'raster'
        || image.parentElement !== wrapper) return false;
    wrapper.classList.add('card_photo_presentation');
    wrapper._cardImageOwn = cardImageOwn;
    wrapper._cardImageUse = cardImageUse ? Object.freeze({ ...cardImageUse }) : null;
    wrapper.style.backgroundColor = 'var(--bg_color)';
    image.style.setProperty('object-fit', 'var(--card-photo-object-fit, contain)', 'important');
    let hasLoaded = image.complete;
    const updateBackdrop = () => {
        const defaults = wrapper._cardImageDefaults
            || wrapper.closest(APPEARANCE_SCOPE_SELECTOR)?._cardImageDefaults
            || { site: readAppearanceAttribute(wrapper, 'cardImagePresentation') };
        const resolved = resolveCardImagePresentation({ own: wrapper._cardImageOwn, ...defaults });
        projectAppearanceAttribute(wrapper, 'cardImagePresentation', resolved.value);
        projectAppearanceAttribute(wrapper, 'cardImageSource', resolved.source);
        projectAppearanceStyle(wrapper, '--card-photo-focal', resolved.value === 'cover'
            ? `${resolved.focal.x * 100}% ${resolved.focal.y * 100}%` : null);
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
    addCardResourceListener(image, 'load', () => {
        hasLoaded = true;
        // Lifecycle cleanup revoked this wrapper's projection. A late image
        // event cannot recreate it; an explicit adapter paint enables it again.
        if (wrapper.dataset.cardImagePresentation) updateBackdrop();
    });
    addCardResourceListener(image, 'error', () => {
        hasLoaded = false;
        projectAppearanceStyle(wrapper, '--card-photo-source', null);
    });
    return true;
}
