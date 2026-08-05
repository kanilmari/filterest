// dom_container_builder_helpers.js
// Pure helper functions extracted from dom_container_builder.js for testability.
// Zero DOM access — all functions are pure input→output.

/**
 * Extract a leading numeric ID from text formatted as "id (name)" or just "id".
 *
 * @param {string} text - The text to parse
 * @returns {string|null} The extracted numeric ID string, or null if none found
 */
export function extract_id_from_text(text) {
    const match = text.match(/^(\d+)/);
    if (match && match[1]) {
        return match[1];
    }
    return null;
}

/**
 * Check whether a name is a valid identifier (a-zA-Z0-9_ only, no Finnish diacritics).
 *
 * @param {string} name - The identifier candidate
 * @returns {boolean} true if valid
 */
export function isValidIdentifier(name) {
    if (/[åäöÅÄÖ]/.test(name)) {
        return false;
    }
    return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name);
}

/**
 * Tags allowed when rendering small HTML snippets via renderAllowedHtml.
 * The same list is also used by containsAllowedHtml for detection.
 */
export const ALLOWED_HTML_TAGS = [
    'div', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'ul', 'ol', 'li', 'strong', 'em', 'span', 'br',
    'b', 'i', 'a', 'hr', 'blockquote', 'pre'
];

/**
 * Quick regex-based check to see if a string likely contains
 * HTML elements that we support rendering.
 *
 * @param {string} text - candidate HTML snippet
 * @returns {boolean} true if at least one allowed tag is found
 */
export function containsAllowedHtml(text) {
    if (typeof text !== 'string') return false;
    const pattern = new RegExp(`<\\s*(?:${ALLOWED_HTML_TAGS.join('|')})(?:\\s|/>|>)`, 'i');
    return pattern.test(text);
}
