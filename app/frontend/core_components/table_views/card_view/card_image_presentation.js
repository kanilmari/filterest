// card_image_presentation.js
// Applies card presentation settings and resolves stored photo geometry for cards and articles.
// Connects the shared appearance setting with existing card image wrappers.
// Article photos retain their intrinsic shape; logos, avatars and image-first keep their own renderers.

import { CARD_IMAGE_RENDER_SLOTS } from './card_image_render_options.js';
import { addCardResourceListener } from './card_resource_lifecycle.js';
import { APPEARANCE_SCOPE_SELECTOR, readAppearanceAttribute, appearanceScopeElements } from '../../../reusable_components/appearance_scope_reader.js';
import { projectAppearanceAttribute, projectAppearanceStyle } from '../../../reusable_components/appearance_projection_writer.js';
import { CARD_IMAGE_PRESENTATIONS, resolveCardImagePresentation } from './card_image_presentation_resolver.js';

export { CARD_IMAGE_PRESENTATIONS };

const MIN_CARD_PHOTO_FRAME_RATIO = 4 / 5;

function photoRatio(width, height, minimum = 0) {
    if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) return null;
    return Math.max(minimum, width / height);
}

/** Only cards limit a tall photo's frame to 1.25 times its width. */
export function resolveCardPhotoFrameRatio(width, height) {
    return photoRatio(width, height, MIN_CARD_PHOTO_FRAME_RATIO);
}

// Resolution-folder swaps retain the same stored file identity.
function photoFileName(image) {
    return (image.currentSrc || image.src).split(/[?#]/, 1)[0].split('/').pop();
}

/** Dimensions belong to the displayed file, including after a resolution-folder swap. */
function readStoredPhotoRatio(image, imageMetadata, minimum = 0) {
    try {
        const metadata = typeof imageMetadata === 'string' ? JSON.parse(imageMetadata) : imageMetadata;
        if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
        const size = metadata.displayed_image_size;
        if (!size || typeof size !== 'object' || Array.isArray(size)
            || typeof size.file !== 'string' || !size.file || size.file !== photoFileName(image)) return null;
        const ratio = photoRatio(size.width_px, size.height_px, minimum);
        return Number.isFinite(ratio) && ratio > 0 ? ratio : null;
    } catch {
        return null;
    }
}

export function resolveStoredCardPhotoFrameRatio(image, imageMetadata) {
    return readStoredPhotoRatio(image, imageMetadata, MIN_CARD_PHOTO_FRAME_RATIO);
}

/** Keep the ordinary article photo's real shape. Logos, thumbnails and image-first own their frames. */
export function prepareInlineArticlePhotoFrame(wrapper, image, imageMetadata) {
    if (wrapper.dataset.cardImageRenderSlot !== CARD_IMAGE_RENDER_SLOTS.ROW_ARTICLE_INLINE
        || wrapper.dataset.imagePresentationKind !== 'raster'
        || wrapper.classList.contains('service_catalog_logo_frame') || image.parentElement !== wrapper) return false;

    wrapper.classList.add('row_article_photo_frame');
    const property = '--row-article-photo-ratio';
    const stored = readStoredPhotoRatio(image, imageMetadata);
    if (stored !== null) {
        wrapper.style.setProperty(property, String(stored));
    } else {
        // Old uploads have no dimensions: allow intrinsic sizing until this image is decoded.
        const useNaturalSize = () => {
            const ratio = photoRatio(image.naturalWidth, image.naturalHeight);
            if (Number.isFinite(ratio) && ratio > 0) wrapper.style.setProperty(property, String(ratio));
        };
        if (image.complete && image.naturalWidth) useNaturalSize();
        else addCardResourceListener(image, 'load', useNaturalSize, { once: true });
    }
    return true;
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
