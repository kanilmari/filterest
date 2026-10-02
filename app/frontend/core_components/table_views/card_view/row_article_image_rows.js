// row_article_image_rows.js
// Normalizes the image rows article galleries and image-first views show, in the server's order, and picks the one shown first.
// Bridges fresh gallery rows, the card picture the server reports and the address that identifies a picture.
// Exists to keep image-first rendering separate from the ordinary article gallery module.

import { resolveImagePath } from "./row_article_content_builder_helpers.js";
import { extractLangValue } from "../../../reusable_components/lang_value_reader.js";
import { getLanguageWithBrowserFallback } from "../../state_stores/lang_preference_reader.js";

// Any fixed base gives the same comparison where no page address exists, as in a test without a DOM.
const PICTURE_ADDRESS_FALLBACK_BASE = "http://localhost/";

/**
 * The identity of a picture: its address as the browser loads it, keeping the host and
 * the query and dropping only a #fragment. A bare stored name and its full storage
 * address are the same picture; the same path on another host, or with another query,
 * is another picture whose pixels must replace the old ones. Returns "" for no value.
 * Every article view compares pictures through this one function.
 */
export function resolveRowArticlePictureIdentity(value) {
    const name = typeof value === "string" ? value.trim() : "";
    if (!name) {
        return "";
    }
    const address = resolveImagePath(name);
    try {
        const url = new URL(address, globalThis.location?.href || PICTURE_ADDRESS_FALLBACK_BASE);
        url.hash = "";
        return url.href;
    } catch {
        return address;
    }
}

/**
 * Keeps image rows in the order given, dropping other assets, rows without a stored
 * name and later rows whose picture an earlier row already shows. The server orders
 * gallery rows itself (K120), so the browser never re-sorts them.
 */
export function resolveRowArticleImageRows(rows) {
    const seenPictures = new Set();

    return (Array.isArray(rows) ? rows : [])
        .filter((row) => {
            const assetKind = String(row?.asset_kind || "").toLowerCase();
            const hasFilename = typeof row?.filename === "string" && row.filename.trim() !== "";
            if (!hasFilename || !(assetKind === "image" || assetKind === "")) {
                return false;
            }

            const picture = resolveRowArticlePictureIdentity(row.filename);
            if (seenPictures.has(picture)) {
                return false;
            }
            seenPictures.add(picture);
            return true;
        });
}

/**
 * The stored name of the card picture the server reports, or "" for none. The server
 * cannot know the viewer's language, so a multilingual value arrives whole; it is read
 * in the viewer's language with the same call the card's image makes
 * (addImageOrAvatar in card_element_builder.js). The card applies the column's
 * multilingual setting before that call, which this reading cannot know, so a column
 * marked multilingual whose value is not a plain language map of texts can differ
 * (Asset_Linking_Architecture.md §4). An empty value in that language is no card
 * picture. Every reading of the card picture comes here.
 */
function readPictureName(picture) {
    return extractLangValue(picture, getLanguageWithBrowserFallback()).trim();
}

/** Finds the row that shows the given picture, by picture identity. */
function findRowShowingPicture(rows, pictureName) {
    const picture = resolveRowArticlePictureIdentity(pictureName);
    return rows.find((row) => resolveRowArticlePictureIdentity(row?.filename) === picture) || null;
}

/**
 * Composes what an article shows from one fresh dynamic-children response: the
 * gallery rows, already in the server's gallery order, and the parent's stored card
 * picture (`card_picture`). A card picture that no gallery row carries (another row's
 * file, an external address, a media-library picture) stays the card's own picture
 * until an administrator clears it, so it leads as a card-only tile. That tile has no
 * row id, so the gallery offers no row actions for it.
 */
export function composeRowArticleImageRows(galleryRows = [], cardPicture = "") {
    const canonicalRows = resolveRowArticleImageRows(galleryRows);
    const cardPictureName = readPictureName(cardPicture);
    const cardOnlyRows = cardPictureName && !findRowShowingPicture(canonicalRows, cardPictureName)
        ? [{ asset_kind: "image", filename: cardPictureName, is_card_only_picture: true }]
        : [];

    return [...cardOnlyRows, ...canonicalRows];
}

/**
 * Picks the picture an article or image-first view shows first: the row that shows the
 * card picture the server reported, otherwise the first row. The rows keep the
 * gallery's order; only the first picture shown follows the card, so the article opens
 * on the same picture as its card (K128).
 */
export function resolveRowArticleMainImageRow(rows = [], cardPicture = "") {
    const imageRows = Array.isArray(rows) ? rows : [];
    const cardPictureName = readPictureName(cardPicture);
    return (cardPictureName && findRowShowingPicture(imageRows, cardPictureName))
        || imageRows[0]
        || null;
}
