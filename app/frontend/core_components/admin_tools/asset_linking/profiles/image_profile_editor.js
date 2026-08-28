// image_profile_editor.js
// Defines image-profile-specific editor helpers for the future asset-linking admin UI.
// Bridges the generic asset admin view and image-only controls such as primary preview behavior.
// Exists to keep image-specific UX separate from generic asset capability state.

export function createImageProfileDefaults() {
    return {
        assetKind: 'image',
        cacheColumn: 'cached_image',
        thumbnailSizes: ['300', '1000'],
        allowPrimarySelection: true
    };
}
