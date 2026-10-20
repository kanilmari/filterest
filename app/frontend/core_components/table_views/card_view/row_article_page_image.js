// row_article_page_image.js
// Builds the optional contained picture inside the Page article's text column.
// Connects authorized IFAV media rows to a plain image and resource cleanup.
// Missing and failed media leave no box, placeholder or broken-image affordance.
import { addCardResourceListener } from './card_resource_lifecycle.js';

export function buildRowArticlePageImage({ imageRow, resolvePath, resolveAlt }) {
    if (!imageRow?.filename) return null;
    const element = document.createElement('div');
    element.className = 'row_article_page_image';
    element.dataset.testid = 'row-article-page-image';
    const image = document.createElement('img');
    image.alt = resolveAlt(imageRow);
    // Keep the undecoded image out of layout; a failed request never paints an icon.
    image.hidden = true;
    addCardResourceListener(image, 'load', () => { image.hidden = false; }, { once: true });
    addCardResourceListener(image, 'error', () => element.remove(), { once: true });
    element.append(image);
    image.src = resolvePath(imageRow.filename);
    if (image.complete && image.naturalWidth > 0) image.hidden = false;
    return { element };
}
