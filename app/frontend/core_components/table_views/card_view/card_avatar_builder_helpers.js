// card_avatar_builder_helpers.js
// Pure helper functions extracted from card_avatar_builder.js for testability.
// Zero DOM access — all functions are pure input→output.

/**
 * Available font families for avatar text rendering.
 * @type {string[]}
 */
const FONTS = [
    'Arial, sans-serif',
    '"Times New Roman", Times, serif',
    'Consolas, monospace',
    'Verdana, Geneva, sans-serif',
    '"Trebuchet MS", Helvetica, sans-serif',
    'Georgia, serif',
    '"Palatino Linotype", "Book Antiqua", Palatino, serif',
];

/**
 * Compute an HSL background color string from a numeric hash value.
 * Saturation and lightness are fixed for a dark, muted palette.
 *
 * @param {number} numericHash - Unsigned 32-bit integer derived from hash
 * @returns {string} HSL color string, e.g. "hsl(217, 30%, 40%)"
 */
export function hslColorFromHash(numericHash) {
    const hue = numericHash % 360;
    return `hsl(${hue}, 30%, 40%)`;
}

/**
 * Compute a border-radius percentage string from a numeric hash value.
 * Result is between 1% and 30%.
 *
 * @param {number} numericHash - Unsigned 32-bit integer derived from hash
 * @returns {string} CSS border-radius value, e.g. "17%"
 */
export function borderRadiusFromHash(numericHash) {
    const radius = (numericHash % 30) + 1;
    return `${radius}%`;
}

/**
 * Select a font family from the predefined list using a numeric hash.
 * Uses bit-shift (>>> 8) to pick a different part of the hash than hue.
 *
 * @param {number} numericHash - Unsigned 32-bit integer derived from hash
 * @returns {string} CSS font-family value
 */
export function fontFromHash(numericHash) {
    const index = (numericHash >>> 8) % FONTS.length;
    return FONTS[index];
}

/**
 * Check whether an image source path or URL points to a .png file.
 *
 * @param {string} imageSrc - Image source URL or path
 * @returns {boolean} True if the source is a PNG file
 */
export function isPngImage(imageSrc) {
    return String(imageSrc ?? '')
        .trim()
        .split(/[?#]/)[0]
        .toLowerCase()
        .endsWith('.png');
}

/**
 * Format a dataset name into readable fallback text for image alt context.
 *
 * @param {string|null|undefined} datasetName - Raw dataset name such as "system_users"
 * @returns {string} Readable dataset label such as "System users"
 */
export function formatDatasetNameForAltText(datasetName) {
    const trimmed = String(datasetName ?? '')
        .trim()
        .replace(/_/g, ' ')
        .replace(/\s+/g, ' ');

    if (!trimmed) {
        return '';
    }

    return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

/**
 * Build contextual image alt text from the row label and dataset name.
 *
 * @param {string|null|undefined} datasetName - Dataset name owning the row
 * @param {string|null|undefined} rowLabel - Best available row label for the image
 * @returns {string} Context string for translated alt labels
 */
export function buildImageAltContext(datasetName, rowLabel) {
    const formattedDatasetName = formatDatasetNameForAltText(datasetName);
    const trimmedRowLabel = String(rowLabel ?? '').trim().replace(/\s+/g, ' ');

    if (trimmedRowLabel && formattedDatasetName) {
        return `${trimmedRowLabel} (${formattedDatasetName})`;
    }

    if (trimmedRowLabel) {
        return trimmedRowLabel;
    }

    return formattedDatasetName;
}

/**
 * Truncate and uppercase avatar display text.
 * Returns '?' for falsy input. Appends '...' if text exceeds maxChars.
 *
 * @param {string|null|undefined} text - Raw text for avatar
 * @param {number} [maxChars=16] - Maximum characters before truncation
 * @returns {string} Uppercased, possibly truncated text
 */
export function formatAvatarText(text, maxChars = 16) {
    if (!text) return '?';
    const trimmed = text.length > maxChars
        ? text.slice(0, maxChars) + '...'
        : text;
    return trimmed.toUpperCase();
}

/**
 * Compute all deterministic avatar visual properties from a hex hash string.
 * Returns a plain config object — no DOM elements.
 *
 * @param {string} hashHex - SHA-256 hex string (at least 16 characters)
 * @param {string|null|undefined} letterForAvatar - Text to display on avatar
 * @param {boolean} [useLargeSize=false] - Whether to use large (300px) or small (120px) sizing
 * @returns {{ text: string, color: string, borderRadius: string, font: string, containerSize: number, avatarBoxSize: number }}
 */
export function computeAvatarConfig(hashHex, letterForAvatar, useLargeSize = false) {
    const numericForColor = parseInt(hashHex.slice(0, 8), 16);
    const numericForRadius = parseInt(hashHex.slice(8, 16), 16);

    return {
        text: formatAvatarText(letterForAvatar),
        color: hslColorFromHash(numericForColor),
        borderRadius: borderRadiusFromHash(numericForRadius),
        font: fontFromHash(numericForColor),
        containerSize: useLargeSize ? 300 : 120,
        avatarBoxSize: useLargeSize ? 220 : 120,
    };
}
