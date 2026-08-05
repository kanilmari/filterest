// big_card_opener_helpers.js
// Pure helper functions extracted from big_card_opener.js for testability.
// Zero DOM access — all functions are pure input→output.

import { buildDatasetPath } from '../../navigation/nav_engine/dataset_aliases.js';

/**
 * Build an SEO-friendly URL slug from arbitrary text.
 * Strips diacritics, removes special characters, collapses whitespace into hyphens,
 * and truncates to 80 characters.
 *
 * @param {string} text - Raw text to slugify
 * @returns {string} URL-safe slug (may be empty if input has no valid characters)
 */
export function buildSlug(text) {
    if (!text) return "";
    return text
        .toLowerCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")   // strip diacritics
        .replace(/[^a-z0-9\s-]/g, "")                       // remove special chars
        .replace(/\s+/g, "-")                                // spaces → hyphens
        .replace(/-+/g, "-")                                 // collapse hyphens
        .replace(/^-|-$/g, "")                               // trim edge hyphens
        .substring(0, 80);                                   // limit length
}

/**
 * Compute the avatar/colour seed string from a row's id and creation timestamp.
 * Falls back to the id alone when no creation field is present.
 *
 * @param {object} rowItem - Row data object
 * @returns {string} Seed string for deterministic avatar generation
 */
export function buildCreationSeed(rowItem) {
    const createdPart =
        rowItem.created ||
        rowItem.created_at ||
        rowItem.luontiaika ||
        null;
    const idPart =
        rowItem.id !== undefined ? String(rowItem.id) : "unknown_id";
    return createdPart ? `${idPart}_${createdPart}` : idPart;
}

/**
 * Extract the row ID as a string, or null if not present.
 *
 * @param {object} rowItem - Row data object
 * @returns {string|null}
 */
export function extractRowId(rowItem) {
    return rowItem.id !== undefined ? String(rowItem.id) : null;
}

/**
 * Sort columns so that columns with a card_element role come before those without.
 * Preserves relative order among columns that both have (or both lack) a role.
 *
 * @param {string[]} columns - Column names
 * @param {object} dataTypes - Map of column name → { card_element?: string, ... }
 * @returns {string[]} New sorted array (does not mutate input)
 */
export function sortColumnsByRole(columns, dataTypes) {
    return [...columns].sort((a, b) => {
        const roleA = dataTypes[a]?.card_element || "";
        const roleB = dataTypes[b]?.card_element || "";
        return roleA && !roleB ? -1 : !roleA && roleB ? 1 : 0;
    });
}

/**
 * Build the deep-link URL path for a big card.
 *
 * @param {string} datasetPrefix - URL prefix for datasets (e.g. "/d/")
 * @param {string} tableName - Dataset/table name
 * @param {string} rowId - Row ID
 * @param {string} slug - SEO slug (may be empty)
 * @returns {string} Full URL path
 */
export function buildCardUrl(datasetPrefix, tableName, rowId, slug) {
    const slugSuffix = slug ? `-${slug}` : "";
    return `${buildDatasetPath(tableName, datasetPrefix)}/${rowId}${slugSuffix}`;
}
