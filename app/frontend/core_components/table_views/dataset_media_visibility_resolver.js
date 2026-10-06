// dataset_media_visibility_resolver.js
// Chooses whether a stored dataset image may be loaded by a presentation surface.
// Connects media paths and per-image hidden flags with hero/background CSS writers.
// Keeps the stored link intact while suppressing the browser request at display time.

/** Returns the stored path to display, or an empty path for a hidden image. */
export function resolveVisibleDatasetMediaPath(path, hidden = false) {
    return hidden === true || typeof path !== 'string' ? '' : path.trim();
}
