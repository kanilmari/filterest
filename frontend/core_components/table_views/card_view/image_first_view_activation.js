// image_first_view_activation.js
// Lazily activates the standalone image-first view from ordinary card media.
// Bridges the card builder to the viewer without creating a static module cycle.
// Exists because the viewer reuses the article content builder used by cards.

export async function activateImageFirstView(options) {
    const { openImageFirstView } = await import("./image_first_view_opener.js");
    return openImageFirstView(options);
}
