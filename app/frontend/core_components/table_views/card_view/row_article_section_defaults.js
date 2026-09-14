// row_article_section_defaults.js
// Loads one article opening's permitted disclosure defaults from the stable API.
// Bridges classic/image-first section keys and the existing disclosure primitive.
// Keeps initial settings separate from user toggles and same-row media refreshes.

const SECTION_KEYS = Object.freeze({
    classic: Object.freeze(["details", "images", "attachments", "related_rows", "task_progress"]),
    image_first: Object.freeze(["details"]),
});

/** No global cache: reopening a row obtains current permitted dataset settings. */
export async function loadRowArticleSectionDefaults(dataset, presentationKey) {
    const keys = SECTION_KEYS[presentationKey] || [];
    let initial = {};
    try {
        // Load at the article action boundary, not while the renderer graph is
        // initializing; the stable router imports navigation and permissions.
        const { getArticleSectionDefaults } = await import("../../endpoints/stable_endpoint_router.js");
        const response = await getArticleSectionDefaults(dataset, presentationKey);
        if (response?.dataset === dataset && response?.presentation_key === presentationKey) {
            initial = response.initial_open || {};
        }
    } catch {
        // The established disclosure default remains open if optional settings
        // are unavailable. This never changes access to rows, media or sections.
    }
    return Object.freeze(Object.fromEntries(keys.map(key => [key,
        typeof initial[key] === "boolean" ? initial[key] : true,
    ])));
}

/** An existing same-row disclosure wins over the opening's initial setting. */
export function resolveRowArticleSectionStartOpen(defaults, key, existingSection = null) {
    const current = existingSection?.dataset?.disclosureState;
    if (current === "expanded" || current === "collapsed") return current === "expanded";
    return defaults?.[key] !== false;
}
