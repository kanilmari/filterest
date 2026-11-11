// row_article_page_image.js
// Builds the optional contained picture inside the Page article's text column.
// Pairs the selected, authorized asset with its localized caption.
// Missing and failed media leave no box, placeholder or broken-image affordance.
import { setRowArticleImageCaption } from './row_article_image_caption.js';
import { addCardResourceListener } from './card_resource_lifecycle.js';

export function buildRowArticlePageImage({ imageRow, resolvePath, resolveAlt }) {
    if (!imageRow?.filename) return null;
    const element = document.createElement('figure');
    element.className = 'row_article_page_image';
    element.dataset.testid = 'row-article-page-image';
    element.hidden = true;
    const caption = document.createElement('figcaption');
    caption.className = 'row_article_image_caption';
    caption.dataset.testid = 'row-article-page-image-caption';
    setRowArticleImageCaption(caption, imageRow);

    const image = document.createElement('img');
    image.alt = resolveAlt(imageRow);
    // Keep the undecoded image out of layout; a failed request never paints an icon.
    image.hidden = true;
    function revealImage() {
        // A height-limited portrait occupies only part of the text column.
        if (image.naturalWidth && image.naturalHeight) {
            element.style.setProperty('--page-image-ratio', String(image.naturalWidth / image.naturalHeight));
        }
        image.hidden = false;
        element.hidden = false;
    }
    addCardResourceListener(image, 'load', revealImage, { once: true });
    addCardResourceListener(image, 'error', () => element.remove(), { once: true });
    element.append(image, caption);
    image.src = resolvePath(imageRow.filename);
    if (image.complete && image.naturalWidth > 0) revealImage();
    return { element };
}
