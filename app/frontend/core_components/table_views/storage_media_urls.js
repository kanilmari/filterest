// storage_media_urls.js
// Rewrites stored media URLs onto display-sized variants without changing stored originals.
// Bridges catalog/list/background renderers and the on-disk 300/1000/2160/original folders.
// Exists so ordinary page loads do not fetch multi-megabyte originals when a smaller file is enough.

export const ROW_MEDIA_DISPLAY_FOLDERS = Object.freeze(["300", "1000", "2160", "original"]);
export const DATASET_MEDIA_ROLES = Object.freeze(["cover", "background"]);
export const DATASET_COVER_DISPLAY_FOLDER = "1000";
export const DATASET_BACKGROUND_DISPLAY_FOLDER = "2160";

export const MEDIA_URL_SLOTS = Object.freeze({
    GUEST_CATALOG: "guest_catalog",
    CATALOG: "catalog",
    LIST: "list",
    BACKGROUND: "background",
    COVER: "cover",
    CARD: "card",
    SMALL_THUMBNAIL: "small_thumbnail",
    ARTICLE: "article",
    LIGHTBOX: "lightbox",
    DOWNLOAD: "download",
});

const ORIGINAL_REQUIRED_SLOTS = new Set([
    MEDIA_URL_SLOTS.ARTICLE,
    MEDIA_URL_SLOTS.LIGHTBOX,
    MEDIA_URL_SLOTS.DOWNLOAD,
]);

const SLOT_DISPLAY_FOLDERS = Object.freeze({
    [MEDIA_URL_SLOTS.GUEST_CATALOG]: "1000",
    [MEDIA_URL_SLOTS.CATALOG]: "1000",
    [MEDIA_URL_SLOTS.LIST]: "300",
    [MEDIA_URL_SLOTS.BACKGROUND]: DATASET_BACKGROUND_DISPLAY_FOLDER,
    [MEDIA_URL_SLOTS.COVER]: DATASET_COVER_DISPLAY_FOLDER,
    [MEDIA_URL_SLOTS.CARD]: "1000",
    [MEDIA_URL_SLOTS.SMALL_THUMBNAIL]: "300",
    [MEDIA_URL_SLOTS.ARTICLE]: "original",
    [MEDIA_URL_SLOTS.LIGHTBOX]: "original",
    [MEDIA_URL_SLOTS.DOWNLOAD]: "original",
});

const ROW_STORAGE_PATH_RE = /^(?:\/storage\/)?(\d+)\/(\d+)\/(?:original|300|1000|2160)\/([^/?#]+)([?#].*)?$/i;
const DATASET_MEDIA_PATH_RE = /^(?:\/storage\/)?(\d+)\/dataset_media\/(cover|background)\/(?:original|300|1000|2160)\/([^/?#]+)([?#].*)?$/i;
const MEDIA_LIBRARY_PATH_RE = /^(?:\/storage\/)?media\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/(?:original|300|1000|2160)\/([^/?#]+)([?#].*)?$/i;

function isDisplayFolder(folder) {
    return ROW_MEDIA_DISPLAY_FOLDERS.includes(String(folder || ""));
}

/**
 * Choose the on-disk folder for a named display or original-required slot.
 * Unknown slots still prefer a sized derivative so catalog-like callers cannot
 * silently fall through to original.
 *
 * @param {string} slot
 * @returns {string}
 */
export function displayFolderForSlot(slot) {
    const normalized = String(slot || "").trim().toLowerCase();
    if (Object.prototype.hasOwnProperty.call(SLOT_DISPLAY_FOLDERS, normalized)) {
        return SLOT_DISPLAY_FOLDERS[normalized];
    }
    return "1000";
}

export function slotAllowsOriginal(slot) {
    return ORIGINAL_REQUIRED_SLOTS.has(String(slot || "").trim().toLowerCase());
}

/**
 * Files to try when a requested variant is missing. Original is last except when
 * the caller asked for original itself.
 *
 * @param {string} requested
 * @returns {string[]}
 */
export function mediaVariantFallbackOrder(requested) {
    switch (String(requested || "")) {
        case "300":
            return ["300", "1000", "2160", "original"];
        case "1000":
            return ["1000", "300", "2160", "original"];
        case "2160":
            return ["2160", "1000", "300", "original"];
        case "original":
            return ["original"];
        default:
            return ["1000", "300", "2160", "original"];
    }
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
    return `/storage/${match[1]}/${match[2]}/${mediaFolder}/${filename}${suffix}`;
}

/**
 * Point a dataset cover/background URL at a bounded display variant.
 * Raster backgrounds use 2160 and covers use 1000 unless the caller names a folder.
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
    return `/storage/${match[1]}/dataset_media/${role}/${requestedFolder}/${filename}${suffix}`;
}

function resolveLibraryMediaDisplayPath(rawSrc, mediaFolder) {
    const source = String(rawSrc || "").trim();
    if (!isDisplayFolder(mediaFolder)) {
        return source;
    }
    const match = source.match(MEDIA_LIBRARY_PATH_RE);
    if (!match) {
        return source;
    }
    const suffix = match[3] || "";
    return `/storage/media/${match[1]}/${mediaFolder}/${match[2]}${suffix}`;
}

/**
 * Rewrite any recognized storage URL onto the folder required by a named slot.
 *
 * @param {string} rawSrc
 * @param {string} slot
 * @returns {string}
 */
export function resolveMediaUrlForSlot(rawSrc, slot) {
    const folder = displayFolderForSlot(slot);
    const source = String(rawSrc || "").trim();
    const datasetPath = resolveDatasetMediaDisplayPath(source, folder);
    if (datasetPath !== source) {
        return datasetPath;
    }
    const libraryPath = resolveLibraryMediaDisplayPath(source, folder);
    if (libraryPath !== source) {
        return libraryPath;
    }
    return resolveRowMediaDisplayPath(source, folder);
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
