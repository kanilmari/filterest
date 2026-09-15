// storage_media_urls.js
// Rewrites stored media URLs onto display-sized variants without changing stored originals.
// Bridges catalog/list/background renderers and the on-disk 300/1000/2160/original folders.
// Exists so ordinary page loads do not fetch multi-megabyte originals when a smaller file is enough.

export const ROW_MEDIA_DISPLAY_FOLDERS = Object.freeze(["300", "1000", "2160", "original"]);
export const DATASET_MEDIA_ROLES = Object.freeze(["cover", "background"]);
export const DATASET_COVER_DISPLAY_FOLDER = "1000";
export const DATASET_BACKGROUND_DISPLAY_FOLDER = "2160";

const ROW_STORAGE_PATH_RE = /^(?:\/storage\/)?(\d+)\/(\d+)\/(?:original|300|1000|2160)\/([^/?#]+)([?#].*)?$/i;
const DATASET_MEDIA_PATH_RE = /^(?:\/storage\/)?(\d+)\/dataset_media\/(cover|background)\/(?:original|300|1000|2160)\/([^/?#]+)([?#].*)?$/i;
const VECTOR_OR_ANIMATED_RE = /\.(svg|gif)$/i;

function isDisplayFolder(folder) {
    return ROW_MEDIA_DISPLAY_FOLDERS.includes(String(folder || ""));
}

function keepOriginalVariant(filename) {
    return VECTOR_OR_ANIMATED_RE.test(String(filename || ""));
}

/**
 * Point a row-scoped storage URL at the display folder used by the current slot.
 * Rooted `/storage/.../original/...` paths are rewritten the same way as relative ones.
 *
 * @param {string} rawSrc
 * @param {string} mediaFolder
 * @returns {string}
 */
export function resolveRowMediaDisplayPath(rawSrc, mediaFolder) {
    const source = String(rawSrc || "").trim();
    if (!source || !isDisplayFolder(mediaFolder)) {
        return source;
    }

    const match = source.match(ROW_STORAGE_PATH_RE);
    if (!match) {
        return source;
    }

    const filename = match[3];
    const suffix = match[4] || "";
    const folder = keepOriginalVariant(filename) ? "original" : mediaFolder;
    return `/storage/${match[1]}/${match[2]}/${folder}/${filename}${suffix}`;
}

/**
 * Point a dataset cover/background URL at a bounded display variant.
 * SVG/GIF covers keep original; raster backgrounds use 2160 and covers use 1000.
 *
 * @param {string} rawSrc
 * @param {string} [mediaFolder]
 * @returns {string}
 */
export function resolveDatasetMediaDisplayPath(rawSrc, mediaFolder) {
    const source = String(rawSrc || "").trim();
    const match = source.match(DATASET_MEDIA_PATH_RE);
    if (!match) {
        return source;
    }

    const filename = match[3];
    const suffix = match[4] || "";
    const role = match[2];
    const requestedFolder = isDisplayFolder(mediaFolder)
        ? mediaFolder
        : role === "background"
            ? DATASET_BACKGROUND_DISPLAY_FOLDER
            : DATASET_COVER_DISPLAY_FOLDER;
    const folder = keepOriginalVariant(filename) ? "original" : requestedFolder;
    return `/storage/${match[1]}/dataset_media/${role}/${folder}/${filename}${suffix}`;
}

/**
 * Quote a URL for a CSS `url("...")` background without introducing a second fetch of an unrelated value.
 *
 * @param {string} rawSrc
 * @returns {string}
 */
export function encodeCssUrlValue(rawSrc) {
    return `url("${encodeURI(String(rawSrc || "")).replaceAll('"', "%22")}")`;
}
