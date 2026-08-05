// card_element_builder_helpers.js
// Pure helper functions extracted from card_element_builder.js for testability.
// Zero DOM access — all functions are pure input→output.

/**
 * Build a Google Maps embed URL from address fields on a row item.
 * Returns null if no address parts are present.
 *
 * @param {{ street?: string, house_number?: string, postal_code?: string, city?: string, country_name?: string }} rowItem
 * @returns {string|null} Google Maps embed src URL, or null if address is empty
 */
export function buildGoogleMapsEmbedUrl(rowItem) {
    const addressParts = [
        rowItem.street,
        rowItem.house_number,
        rowItem.postal_code,
        rowItem.city,
        rowItem.country_name,
    ]
        .filter(Boolean)
        .join(" ");

    if (!addressParts.trim()) return null;

    return (
        "https://maps.google.com/maps?q=" +
        encodeURIComponent(addressParts) +
        "&z=15&output=embed"
    );
}

/**
 * Resolve a raw image source string into display and original paths.
 * Handles three formats:
 *   1. Full path: "104/133/300/104_133_38.png" → /storage/104/133/{mediaFolder}/filename
 *   2. Flat name: "104_133_38.png" → /storage/104/133/{mediaFolder}/104_133_38.png
 *   3. Fallback: "anything" → /storage/anything
 * External URLs (http://, https://) and rooted paths (./, /) are returned as-is.
 *
 * @param {string} rawSrc - Raw image source value (trimmed)
 * @param {string} mediaFolder - Target media folder ("300" or "1000")
 * @returns {{ displaySrc: string, originalSrc: string }}
 */
export function resolveImagePaths(rawSrc, mediaFolder) {
    if (
        rawSrc.startsWith("http://") ||
        rawSrc.startsWith("https://") ||
        rawSrc.startsWith("./") ||
        rawSrc.startsWith("/")
    ) {
        return { displaySrc: rawSrc, originalSrc: rawSrc };
    }

    // Format: 104/133/300/104_133_38.png
    const pathMatch = rawSrc.match(/^(\d+)\/(\d+)\/(?:\d+|original)\/(.+)$/);
    if (pathMatch) {
        const mainTableId = pathMatch[1];
        const mainRowId = pathMatch[2];
        const filename = pathMatch[3];
        return {
            displaySrc: `/storage/${mainTableId}/${mainRowId}/${mediaFolder}/${filename}`,
            originalSrc: `/storage/${mainTableId}/${mainRowId}/original/${filename}`,
        };
    }

    // Format: 104_133_38.png
    const fileMatch = rawSrc.match(/^(\d+)_(\d+)_(\d+)\.(\w+)$/);
    if (fileMatch) {
        const mainTableId = fileMatch[1];
        const mainRowId = fileMatch[2];
        return {
            displaySrc: `/storage/${mainTableId}/${mainRowId}/${mediaFolder}/${rawSrc}`,
            originalSrc: `/storage/${mainTableId}/${mainRowId}/original/${rawSrc}`,
        };
    }

    // Fallback
    const fallback = `/storage/${rawSrc}`;
    return { displaySrc: fallback, originalSrc: fallback };
}

export const DEFAULT_CARD_IMAGE_FALLBACK_KEYS = [
    "cached_image",
    "image",
    "image_url",
    "image_path",
    "hero_image",
    "avatar_image",
    "avatar_url",
    "logo_image",
    "thumbnail_image",
];

const IMAGE_FILENAME_RE = /\.(avif|bmp|gif|ico|jpe?g|png|svg|webp)(?:[?#].*)?$/i;
const IMAGE_STORAGE_PATH_RE = /^(\d+)\/(\d+)\/(?:\d+|original)\/(.+)$/;
const IMAGE_FLAT_FILE_RE = /^(\d+)_(\d+)_(\d+)\.(\w+)$/;
const FALLBACK_IMAGE_KEY_RE = /(?:^|_)(image|image_url|image_path|avatar|avatar_url)$/i;

function isLikelyCardImageValue(candidate) {
    if (!candidate) {
        return false;
    }

    if (
        candidate.startsWith("http://") ||
        candidate.startsWith("https://") ||
        candidate.startsWith("/") ||
        candidate.startsWith("./") ||
        candidate.startsWith("../")
    ) {
        return true;
    }

    return (
        IMAGE_STORAGE_PATH_RE.test(candidate) ||
        IMAGE_FLAT_FILE_RE.test(candidate) ||
        IMAGE_FILENAME_RE.test(candidate)
    );
}

function normalizeFallbackImageCandidate(rawValue) {
    if (rawValue == null) {
        return "";
    }

    if (typeof rawValue === "object" && !Array.isArray(rawValue)) {
        for (const nestedValue of Object.values(rawValue)) {
            const resolved = normalizeFallbackImageCandidate(nestedValue);
            if (resolved) {
                return resolved;
            }
        }
        return "";
    }

    const candidate = String(rawValue).trim();
    if (!candidate) {
        return "";
    }

    if (isLikelyCardImageValue(candidate)) {
        return candidate;
    }

    if (candidate.startsWith("{") && candidate.endsWith("}")) {
        try {
            const parsed = JSON.parse(candidate);
            return normalizeFallbackImageCandidate(parsed);
        } catch {
            return "";
        }
    }

    return "";
}

/**
 * Find a sensible fallback image value from row data when metadata has no
 * usable image role. Prefers common image field names before scanning other
 * image-like keys.
 *
 * @param {Record<string, unknown>} rowItem
 * @param {string[]} preferredKeys
 * @returns {string}
 */
export function resolveFallbackCardImageValue(
    rowItem,
    preferredKeys = DEFAULT_CARD_IMAGE_FALLBACK_KEYS
) {
    if (!rowItem || typeof rowItem !== "object") {
        return "";
    }

    for (const key of preferredKeys) {
        const resolved = normalizeFallbackImageCandidate(rowItem[key]);
        if (resolved) {
            return resolved;
        }
    }

    for (const [key, rawValue] of Object.entries(rowItem)) {
        if (!FALLBACK_IMAGE_KEY_RE.test(key) || preferredKeys.includes(key)) {
            continue;
        }

        const resolved = normalizeFallbackImageCandidate(rawValue);
        if (resolved) {
            return resolved;
        }
    }

    return "";
}

/**
 * Detect whether a table has an image-like fallback column even when metadata
 * has not marked it with the explicit image card role.
 *
 * @param {string[]} columns
 * @param {string[]} preferredKeys
 * @returns {boolean}
 */
export function hasFallbackCardImageColumn(
    columns,
    preferredKeys = DEFAULT_CARD_IMAGE_FALLBACK_KEYS
) {
    if (!Array.isArray(columns)) {
        return false;
    }

    return columns.some((columnName) => {
        const normalizedName = String(columnName || "").trim();
        return (
            preferredKeys.includes(normalizedName) ||
            FALLBACK_IMAGE_KEY_RE.test(normalizedName)
        );
    });
}
