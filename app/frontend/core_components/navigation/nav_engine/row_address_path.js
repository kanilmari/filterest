// row_address_path.js
// Says whether a browser path is one row's own address.
// Shared by the dataset address owner and the image-first article's history owner,
// which both keep a readable row address that is already in place.
// Exists so "this row's address, readable words included" is decided in one place.

/**
 * Tells whether a pathname is already this row's own address:
 * "/{dataset}/{id}", or "/{dataset}/{id}-{words}" as the site publishes it.
 *
 * @param {string} pathname Full browser pathname.
 * @param {string} datasetPath The dataset's own path, without a trailing slash.
 * @param {string|number} rowId
 * @returns {boolean}
 */
export function isAddressOfRow(pathname, datasetPath, rowId) {
    return pathname === `${datasetPath}/${rowId}`
        || pathname.startsWith(`${datasetPath}/${rowId}-`);
}
