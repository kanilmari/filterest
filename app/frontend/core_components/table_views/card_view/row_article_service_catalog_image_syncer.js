// row_article_service_catalog_image_syncer.js
// Syncs service-catalog inline cached images with article-view gallery hero media.
// Bridges row article field rendering and shared image-gallery rendering for service catalog rows.
// Exists so big_card_opener can delegate service-specific media de-duplication.

const SERVICE_CATALOG_TABLE_NAMES = new Set(["app_service_catalog", "service_catalog"]);

function isServiceCatalogTableName(tableName = "") {
    return SERVICE_CATALOG_TABLE_NAMES.has(String(tableName || "").trim());
}

function rowArticleGalleryHasHeroImage(galleryElement) {
    return galleryElement instanceof HTMLElement
        && Boolean(galleryElement.querySelector(".big_card_hero_image img"));
}

/**
 * Marks duplicate service-catalog cached-image fields when the gallery already has a hero image.
 *
 * @param {HTMLElement} rowArticleContentElement
 * @param {string} tableName
 * @param {HTMLElement|null} galleryElement
 */
export function syncServiceCatalogInlineCachedImageVisibility(
    rowArticleContentElement,
    tableName,
    galleryElement
) {
    const inlineCachedImages = Array.from(
        rowArticleContentElement
            .querySelectorAll('.big_card_image[data-row-article-image-column="cached_image"]')
    );
    const shouldSuppressDuplicateGalleryHero =
        isServiceCatalogTableName(tableName)
        && inlineCachedImages.length > 0
        && rowArticleGalleryHasHeroImage(galleryElement);

    inlineCachedImages.forEach((inlineImageElement) => {
        inlineImageElement.hidden = false;
        inlineImageElement.dataset.serviceCatalogInlineImageSuppressed = "false";
        inlineImageElement.dataset.serviceCatalogInlineImagePrimary =
            shouldSuppressDuplicateGalleryHero ? "true" : "false";
    });

    const galleryHeroElement = galleryElement instanceof HTMLElement
        ? galleryElement.querySelector(".big_card_hero_image")
        : null;
    if (galleryHeroElement) {
        galleryHeroElement.hidden = shouldSuppressDuplicateGalleryHero;
        galleryHeroElement.dataset.serviceCatalogGalleryHeroSuppressed =
            shouldSuppressDuplicateGalleryHero ? "true" : "false";
    }
}
