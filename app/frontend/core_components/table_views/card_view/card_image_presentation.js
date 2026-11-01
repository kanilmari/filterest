// card_image_presentation.js
// Applies the site's three presentation modes only to raster card media.
// Connects the shared appearance setting with existing card image wrappers.
// Compact results share this path; other article slots, SVG logos and avatars retain their own renderers.

import { addCardResourceListener } from './card_resource_lifecycle.js';
import { APPEARANCE_SCOPE_SELECTOR, readAppearanceAttribute, appearanceScopeElements } from '../../../reusable_components/appearance_scope_reader.js';
import { projectAppearanceAttribute, projectAppearanceStyle } from '../../../reusable_components/appearance_projection_writer.js';
import { CARD_IMAGE_PRESENTATIONS, resolveCardImagePresentation } from './card_image_presentation_resolver.js';

export { CARD_IMAGE_PRESENTATIONS };

const MIN_CARD_PHOTO_FRAME_RATIO = 4 / 5;

/** Resolve a photo-shaped frame no taller than 1.25 times its width. */
export function resolveCardPhotoFrameRatio(naturalWidth, naturalHeight) {
    if (!Number.isFinite(naturalWidth) || naturalWidth <= 0
        || !Number.isFinite(naturalHeight) || naturalHeight <= 0) return null;
    return Math.max(MIN_CARD_PHOTO_FRAME_RATIO, naturalWidth / naturalHeight);
}

// Resolution-folder swaps retain the same stored file identity.
function photoFileName(image) {
    return (image.currentSrc || image.src).split(/[?#]/, 1)[0].split('/').pop();
}

/** Read a matching stored size once; malformed or stale metadata keeps the square frame. */
export function resolveStoredCardPhotoFrameRatio(image, imageMetadata) {
    try {
        const metadata = typeof imageMetadata === 'string' ? JSON.parse(imageMetadata) : imageMetadata;
        if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
        const size = metadata.displayed_image_size;
        if (!size || typeof size !== 'object' || Array.isArray(size)
            || typeof size.file !== 'string' || !size.file || size.file !== photoFileName(image)) return null;
        const ratio = resolveCardPhotoFrameRatio(size.width_px, size.height_px);
        return Number.isFinite(ratio) ? ratio : null;
    } catch {
        return null;
    }
}

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

/** Stored photo geometry applies at construction and resize; logo/contrast frames keep their own rules. */
export function cardImageFrameFollowsStoredShape(wrapper) {
    return wrapper?.matches('.card_photo_presentation:not(.service_catalog_logo_frame):not(.card_image_contrast_frame)') ?? false;
}

/** Decorative CSS uses the same resolved URL; the accessible image stays the single img. */
export function prepareCardImagePresentation(wrapper, image, { cardImageOwn, cardImageUse, imageMetadata } = {}) {
    if (wrapper.dataset.cardImageRenderSlot !== 'card_media'
        || wrapper.dataset.imagePresentationKind !== 'raster'
        || image.parentElement !== wrapper) return false;
    wrapper.classList.add('card_photo_presentation');
    wrapper._cardImageOwn = cardImageOwn;
    wrapper._cardImageUse = cardImageUse ? Object.freeze({ ...cardImageUse }) : null;
    wrapper.style.backgroundColor = 'var(--bg_color)';
    image.style.setProperty('object-fit', 'var(--card-photo-object-fit, contain)', 'important');
    let hasLoaded = image.complete;
    const frameRatio = cardImageFrameFollowsStoredShape(wrapper)
        ? resolveStoredCardPhotoFrameRatio(image, imageMetadata) : null;
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
    wrapper._refreshImagePresentation = () => {
        // Only construction and an explicit appearance repaint project the original size.
        projectAppearanceStyle(wrapper, '--card-photo-frame-ratio', frameRatio === null ? null : String(frameRatio));
        updateBackdrop();
    };
    wrapper._refreshImagePresentation();
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
