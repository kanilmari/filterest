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

export function normalizeFilterbarSectionCollapsed(input = {}) {
    const values = input && typeof input === "object" && !Array.isArray(input)
        ? input
        : {};
    const normalized = {};

    for (const key of DEFAULT_FILTERBAR_SECTION_ORDER) {
        if (values[key] === true || values[key] === false) {
            normalized[key] = values[key];
        }
    }

    return normalized;
}

export function normalizeFilterbarSectionLayout(input = {}) {
    return {
        section_order: normalizeFilterbarSectionOrder(input?.section_order),
        section_collapsed: normalizeFilterbarSectionCollapsed(input?.section_collapsed),
        allow_own_order: input?.allow_own_order === true,
    };
}

function sectionOrderEquals(input, expected) {
    if (!Array.isArray(input) || input.length !== expected.length) {
        return false;
    }
    return input.every((key, index) => key === expected[index]);
}

