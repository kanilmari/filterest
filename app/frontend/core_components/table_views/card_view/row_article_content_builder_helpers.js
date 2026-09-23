// row_article_content_builder_helpers.js
// Pure helper functions extracted from row_article_content_builder.js for testability.
// Zero DOM access — all functions are pure input→output.

/**
 * Extract the numeric suffix from a role string like "details3" or "description12".
 * Returns Number.MAX_SAFE_INTEGER when no suffix is present (sorts last).
 *
 * @param {string} role - Role string, e.g. "details3", "description", "details_link42"
 * @returns {number}
 */
export function extractSuffixNumber(role) {
    const m = role.match(/\d+/);
    return m ? Number(m[0]) : Number.MAX_SAFE_INTEGER;
}

/**
 * Test whether a role string matches a given base role with optional numeric suffix.
 * E.g. matchesRole("details3", "details") → true, matchesRole("header", "details") → false.
 * Only classifyRole below uses it, so the routing category is the tested contract.
 *
 * @param {string} role - The role string to test
 * @param {string} baseName - The base role name (without suffix)
 * @returns {boolean}
 */
function matchesRole(role, baseName) {
    return new RegExp(`^${baseName}(\\d+)?$`).test(role);
}

/**
 * Resolve a local image filename to its storage path.
 * Returns the input unchanged if it's already an absolute URL or path.
 * For filenames matching the pattern "tableId_rowId_colId.ext", builds
 * a structured storage path.
 *
 * @param {string} src - Image source string (URL, path, or filename)
 * @returns {string} Resolved image path
 */
export function resolveImagePath(src) {
    const trimmed = src.trim();
    if (!trimmed) return trimmed;

    if (/^https?:\/\//.test(trimmed) || trimmed.startsWith("./") || trimmed.startsWith("/")) {
        return trimmed;
    }

    const m = trimmed.match(/^(\d+)_(\d+)_(\d+)\.(\w+)$/);
    return m
        ? `/storage/${m[1]}/${m[2]}/original/${trimmed}`
        : "/storage/" + trimmed;
}

/**
 * Classify a single role string into a routing category.
 * Returns one of: "hidden", "details_link", "details", "description",
 * "keywords", "username", "image", "header", "creation_spec", or "fallback".
 *
 * @param {string} role - A single base role string
 * @returns {string} The routing category
 */
export function classifyRole(role) {
    if (matchesRole(role, "hidden")) return "hidden";
    if (matchesRole(role, "details_link")) return "details_link";
    if (matchesRole(role, "details")) return "details";
    if (matchesRole(role, "description")) return "description";
    if (role === "keywords") return "keywords";
    if (role === "username") return "username";
    if (role === "image") return "image";
    if (role === "header") return "header";
    if (role === "creation_spec") return "creation_spec";
    return "fallback";
}
