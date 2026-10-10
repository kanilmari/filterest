// dataset_appearance_capabilities.js
// Derives independent tab/site/card editing capabilities from existing rights.
// Connects the flag-gated palette and administrator routes without granting access.
// The server keeps administrator, CSRF and dataset authorization authoritative.
export function datasetAppearanceCapabilities(permissionCheck, flags) {
    const enabled = flags?.view_admin_cover_image_test_palette === true;
    return Object.freeze({
        mayEditTab: enabled && permissionCheck('/ui/admin/dataset_header_config')
            && permissionCheck('/api/admin/dataset-appearance'),
        mayEditSite: enabled && permissionCheck('/api/admin/site-presentation-settings'),
        mayEditCards: enabled && permissionCheck('/ui/admin/card_visibility'),
    });
}
