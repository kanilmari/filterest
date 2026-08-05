// sort_dropdown_builder_helpers.js
// Pure helper functions extracted from sort_dropdown_builder.js for testability.
// Zero DOM access — all functions are pure input→output.

export const IMAGE_FIRST_SORT_COLUMN = "__images_first";
export const IMAGE_FIRST_SORT_DIRECTION = "DESC";

/**
 * Filter columns to only those that are sortable (not created/updated, and have sco_number).
 * Returns them sorted by sco_number ascending.
 *
 * @param {string[]} columns - All column names
 * @param {Object<string, {sco_number?: number}>} dataTypes - Column metadata keyed by column name
 * @returns {string[]} Sortable column names, ordered by sco_number
 */
export function filterSortableColumns(columns, dataTypes) {
    const extra = columns.filter(
        (col) =>
            col !== "created" &&
            col !== "updated" &&
            dataTypes[col]?.sco_number != null
    );
    extra.sort((a, b) => dataTypes[a].sco_number - dataTypes[b].sco_number);
    return extra;
}

/**
 * Build the full sort dropdown options array from sortable columns.
 * Includes the default static options (relevance, newest, oldest, etc.)
 * plus ASC/DESC entries for each extra sortable column.
 *
 * @param {string[]} sortableColumns - Pre-filtered and sorted column names
 * @returns {Array<{value: string, label: string, langKey: string}>}
 */
export function buildSortOptions(sortableColumns) {
    const options = [
        { value: "", label: "Search relevance", langKey: "search_relevance" },
        {
            value: `${IMAGE_FIRST_SORT_COLUMN}:${IMAGE_FIRST_SORT_DIRECTION}`,
            label: "Rows with images first",
            langKey: "sort_images_first",
        },
        { value: "created:DESC", label: "Newest", langKey: "sort_newest" },
        { value: "created:ASC", label: "Oldest", langKey: "sort_oldest" },
        { value: "updated:DESC", label: "Most recently updated", langKey: "sort_updated_newest" },
        { value: "updated:ASC", label: "Least recently updated", langKey: "sort_updated_oldest" },
    ];

    sortableColumns.forEach((col) => {
        options.push({
            value: `${col}:ASC`,
            label: `${col} \u2191`,
            langKey: `${col}_asc`,
        });
        options.push({
            value: `${col}:DESC`,
            label: `${col} \u2193`,
            langKey: `${col}_desc`,
        });
    });

    return options;
}
