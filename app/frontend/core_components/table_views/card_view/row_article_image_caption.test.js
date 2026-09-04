/* @vitest-environment jsdom */

// row_article_image_caption.test.js
// Verifies article-only, multilingual captions for shared image asset rows.
// Bridges child image metadata with the ordinary article image container.
// Exists to prevent captions from becoming stale, duplicated, or visible in compact cards.

import { beforeEach, describe, expect, test, vi } from "vitest";

const { getLanguageMock } = vi.hoisted(() => ({
    getLanguageMock: vi.fn(() => "fi"),
}));

vi.mock("../../state_stores/lang_preference_reader.js", () => ({
    getLanguageWithBrowserFallback: getLanguageMock,
}));

import {
    setRowArticleImageCaption,
    syncRowArticleInlineImageCaptions,
} from "./row_article_image_caption.js";
import { refreshLocalizedDatasetValues } from "../dataset_value_localizer.js";

function buildArticleImage(filename = "hero.jpg") {
    const article = document.createElement("article");
    const imageContainer = document.createElement("div");
    imageContainer.classList.add("big_card_image");
    imageContainer.dataset.rowArticleImageColumn = "cached_image";
    const image = document.createElement("img");
    image.src = `/storage/${filename}`;
    imageContainer.appendChild(image);
    article.appendChild(imageContainer);
    return { article, imageContainer };
}

beforeEach(() => {
    document.body.replaceChildren();
    getLanguageMock.mockReturnValue("fi");
});

describe("article image captions", () => {
    test("places the matching image description directly below the ordinary article image", () => {
        const { article, imageContainer } = buildArticleImage();
        syncRowArticleInlineImageCaptions(article, [{
            id: 7,
            asset_kind: "image",
            filename: "hero.jpg",
            description: { fi: "Kuva: Tekijä.", en: "Photo: Creator." },
        }]);

        const caption = imageContainer.querySelector(
            "[data-testid='row-article-inline-image-caption']",
        );
        expect(caption?.textContent).toBe("Kuva: Tekijä.");
        expect(imageContainer.lastElementChild).toBe(caption);
        expect(article.querySelectorAll(".row_article_image_caption")).toHaveLength(1);
    });

    test("updates the visible caption when the interface language changes", async () => {
        const caption = document.createElement("p");
        document.body.appendChild(caption);
        setRowArticleImageCaption(caption, {
            description: JSON.stringify({ fi: "Kuva: Tekijä.", en: "Photo: Creator." }),
        });

        expect(caption.textContent).toBe("Kuva: Tekijä.");
        await refreshLocalizedDatasetValues("en");
        expect(caption.textContent).toBe("Photo: Creator.");
    });

    test("removes a stale caption when the linked image row is no longer present", () => {
        const { article } = buildArticleImage();
        syncRowArticleInlineImageCaptions(article, [{
            asset_kind: "image",
            filename: "hero.jpg",
            description: "Existing caption",
        }]);
        syncRowArticleInlineImageCaptions(article, []);

        expect(article.querySelector(".row_article_image_caption")).toBeNull();
    });

    test("does not add image captions to compact card media", () => {
        const card = document.createElement("article");
        const compactImage = document.createElement("div");
        compactImage.classList.add("card_image");
        compactImage.appendChild(document.createElement("img"));
        card.appendChild(compactImage);

        syncRowArticleInlineImageCaptions(card, [{
            asset_kind: "image",
            filename: "hero.jpg",
            description: "Hidden from compact cards",
        }]);

        expect(card.querySelector(".row_article_image_caption")).toBeNull();
    });
});
