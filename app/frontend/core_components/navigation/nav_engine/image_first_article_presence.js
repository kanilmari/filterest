// image_first_article_presence.js
// Says which image-first article is on screen, for owners other than its opener.
// Bridges the opener, which mounts the view in the shared dialog, the history owner, which takes it down,
// and the browser tab title, which names the article a person is reading.
// Exists so the view's dataset mark and the announcement of a change are each spelled once.

/** Announced when an image-first article has drawn its text, drawn it again, or left the screen. */
export const IMAGE_FIRST_ARTICLE_CHANGED = "image-first-article-changed";

/**
 * Lets the view say which dataset's article it shows. It is mounted in the shared
 * dialog, outside that dataset's own container, so its place in the page cannot say it.
 */
export function markImageFirstArticle(view, tableName) {
    view.dataset.articleDataset = tableName;
}

export function announceImageFirstArticle(tableName) {
    document.dispatchEvent(new CustomEvent(IMAGE_FIRST_ARTICLE_CHANGED, { detail: { tableName } }));
}

/**
 * Finds the image-first article of this dataset that is on screen, or null.
 * While one record replaces another, the newest view is the one the person is reading.
 */
export function findImageFirstArticle(datasetName) {
    const views = Array.from(document.querySelectorAll(".image_first_view"))
        .filter((view) => view.dataset.articleDataset === datasetName);
    return views.at(-1) || null;
}
