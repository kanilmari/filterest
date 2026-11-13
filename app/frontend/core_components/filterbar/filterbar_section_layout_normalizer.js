// filterbar_section_layout_normalizer.js
// Normalizes the shared and personal section layouts.
// Connects the safe API payload to ordering and settings controls.
// Keeps the published search section and the style section in the same catalogue.

export const DEFAULT_FILTERBAR_SECTION_ORDER = Object.freeze([
    "filters",
    "search_overview",
    "search_controls",
    "tools",
    "views",
    "field_sets",
    "style",
    "chat",
]);

const LEGACY_FILTERBAR_SECTION_ORDER = Object.freeze([
    "search_controls",
    "tools",
    "views",
    "field_sets",
    "filters",
    "chat",
]);

const allowedSectionKeys = new Set(DEFAULT_FILTERBAR_SECTION_ORDER);

export function normalizeFilterbarSectionOrder(input = []) {
    if (sectionOrderEquals(input, LEGACY_FILTERBAR_SECTION_ORDER)) {
        return [...DEFAULT_FILTERBAR_SECTION_ORDER];
    }

    const normalized = [];
    const seen = new Set();
    const values = Array.isArray(input) ? input : [];

    for (const rawKey of values) {
        const key = String(rawKey || "").trim();
        if (!allowedSectionKeys.has(key) || seen.has(key)) {
            continue;
        }
        normalized.push(key);
        seen.add(key);
    }

    for (const key of DEFAULT_FILTERBAR_SECTION_ORDER) {
        if (!seen.has(key)) {
            normalized.push(key);
        }
    }

    return normalized;
}

export function normalizeFilterbarSectionLayout(input) {
    // A missing response is unknown. Older sites return a layout without the option.
    const hasLayout = input !== null && typeof input === "object" && !Array.isArray(input);
    return {
        section_order: normalizeFilterbarSectionOrder(input?.section_order),
        allow_own_order: input?.allow_own_order === true,
        field_selector_admin_only: hasLayout ? (input.field_selector_admin_only ?? false) : null,
    };
}

function sectionOrderEquals(input, expected) {
    if (!Array.isArray(input) || input.length !== expected.length) {
        return false;
    }
    return input.every((key, index) => key === expected[index]);
}

