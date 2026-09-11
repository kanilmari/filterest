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

describe("linked photo credits", () => {
    const photoUrl = "https://www.pexels.com/photo/aerial-view-of-city-during-sunset-6367377/";
    function render(row) {
        const caption = document.createElement("p");
        document.body.appendChild(caption);
        setRowArticleImageCaption(caption, row);
        return caption;
    }

    test("turns a legacy Fintravel credit into one short photographer and provider link", async () => {
        const caption = render({ description: "Kuvituskuva – [Chris Economou](" + photoUrl + ")" });
        expect(caption.textContent).toBe("Kuvituskuva: Chris Economou / Pexels");
        expect([...caption.querySelectorAll("a")].map(link => link.href)).toEqual([photoUrl]);
        for (const link of caption.querySelectorAll("a")) {
            expect(link.target).toBe("_blank");
            expect(link.rel).toBe("noopener noreferrer");
        }
        await refreshLocalizedDatasetValues("en");
        expect(caption.textContent).toBe("Illustration: Chris Economou / Pexels");
        await refreshLocalizedDatasetValues("fi");
        expect(caption.textContent).toBe("Kuvituskuva: Chris Economou / Pexels");
    });

    test("uses new picker metadata and changes language without duplicate credit text", async () => {
        const caption = render({
            description: { fi: "Kuva: Creator / Unsplash.", en: "Photo: Creator / Unsplash." },
            metadata_json: JSON.stringify({ image_source: {
                provider: "unsplash", creator_name: "Creator", source_page_url: "https://unsplash.com/photos/example",
                creator_profile_url: "https://unsplash.com/@creator",
            } }),
        });
        expect(caption.textContent).toBe("Kuva: Creator / Unsplash");
        expect([...caption.querySelectorAll("a")].every(link =>
            link.href === "https://unsplash.com/photos/example")).toBe(true);
        await refreshLocalizedDatasetValues("en");
        expect(caption.textContent).toBe("Photo: Creator / Unsplash");
    });

    test("keeps an authored caption beside its structured attribution", () => {
        const caption = render({ description: "Sunset over Helsinki.", metadata_json: { image_source: {
            provider: "pexels", creator_name: "Chris", source_page_url: photoUrl,
        } } });
        expect(caption.textContent).toBe("Sunset over Helsinki. — Kuva: Chris / Pexels");
    });

    test.each([
        "javascript:alert", "data:text/html,alert", "//example.com/image", "https://user:secret@example.com/photo",
        "https://example.com/\nphoto", "not-a-url",
    ])("does not activate unsafe structured links: %s", source_page_url => {
        const caption = render({ description: "Ordinary caption", metadata_json: { image_source: {
            creator_name: "<img src=x onerror=alert(1)>", provider: "pexels", source_page_url,
        } } });
        expect(caption.textContent).toBe("Ordinary caption");
        expect(caption.querySelector("a,img,script")).toBeNull();
    });

    test("renders hostile HTML as text and rejects executable Markdown links", () => {
        const caption = render({ description: "<img src=x onerror=alert(1)> [click](javascript:evil)" });
        expect(caption.textContent).toBe("<img src=x onerror=alert(1)> click");
        expect(caption.querySelector("a,img,script")).toBeNull();
    });

    test("keeps ordinary named web links without interpreting surrounding HTML", () => {
        const caption = render({ description: "See [the original](" + photoUrl + ") for details." });
        expect(caption.textContent).toBe("See the original for details.");
        expect(caption.querySelector("a").href).toBe(photoUrl);
    });

    test("updates the credit when the active image changes and removes old links", () => {
        const caption = render({ description: "Kuvituskuva – [Chris](" + photoUrl + ")" });
        setRowArticleImageCaption(caption, { description: "A different image" });
        expect(caption.textContent).toBe("A different image");
        expect(caption.querySelector("a")).toBeNull();
        setRowArticleImageCaption(caption, { description: "" });
        expect(caption.hidden).toBe(true);
    });

    test("isolates credit activation from image navigation but preserves default link action and Escape", () => {
        const caption = render({ description: "Kuvituskuva – [Chris](" + photoUrl + ")" });
        const parent = document.createElement("section");
        document.body.appendChild(parent); parent.appendChild(caption);
        const onNavigate = vi.fn();
        for (const name of ["click", "touchstart", "touchend", "keydown"]) parent.addEventListener(name, onNavigate);
        const link = caption.querySelector("a");
        for (const name of ["click", "touchstart", "touchend"]) {
            const event = new Event(name, { bubbles: true, cancelable: true });
            expect(link.dispatchEvent(event)).toBe(true);
        }
        link.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
        expect(onNavigate).not.toHaveBeenCalled();
        link.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        expect(onNavigate).toHaveBeenCalledOnce();
    });

    test("renders the same linked credit below the traditional article image", () => {
        const { article, imageContainer } = buildArticleImage();
        syncRowArticleInlineImageCaptions(article, [{
            filename: "hero.jpg", description: "Kuvituskuva – [Chris](" + photoUrl + ")",
        }]);
        const caption = imageContainer.lastElementChild;
        expect(caption.dataset.testid).toBe("row-article-inline-image-caption");
        expect(caption.textContent).toBe("Kuvituskuva: Chris / Pexels");
        expect(caption.querySelectorAll("a")).toHaveLength(1);
        expect(caption.querySelector("a").textContent).toBe("Chris / Pexels");
    });
});

describe("credit locale and URL variants", () => {
    test.each([["zh-CN", "图片"], ["zh-TW", "圖片"], ["zh-HK", "圖片"], ["yue-HK", "相片"]])(
        "uses reviewed Chinese credit copy for %s", async (language, label) => {
            const caption = document.createElement("p");
            document.body.appendChild(caption);
            setRowArticleImageCaption(caption, { metadata_json: { image_source: {
                provider: "pexels", creator_name: "Name", source_page_url: "https://www.pexels.com/photo/example/",
            } } });
            await refreshLocalizedDatasetValues(language);
            expect(caption.textContent).toBe(label + ": Name / Pexels");
        },
    );
    test.each(["See [Photo]", "Kuvituskuva – [Photo]"])("keeps balanced destination parentheses: %s", prefix => {
        const caption = document.createElement("p");
        const url = "https://commons.wikimedia.org/wiki/File:Example_(photo).jpg";
        setRowArticleImageCaption(caption, { description: prefix + "(" + url + ")" });
        expect(caption.querySelector("a").href).toBe(url);
        expect(caption.textContent).not.toContain(".jpg)");
    });
});
