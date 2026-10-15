// image_first_view_activation.test.js
// Verifies accessible pointer and keyboard activation for shared image-first media.
// Bridges ordinary card/article media elements with the lazy image-first opener.
// Exists so every image-first entry surface follows one durable DOM contract.
// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from "vitest";

const { openImageFirstViewMock } = vi.hoisted(() => ({
    openImageFirstViewMock: vi.fn(),
}));

import { bindImageFirstViewActivation } from "./image_first_view_activation.js";

describe("bindImageFirstViewActivation", () => {
    beforeEach(() => {
        document.body.innerHTML = "";
        sessionStorage.setItem('user_permissions', JSON.stringify(['/ui/view/article_view']));
        openImageFirstViewMock.mockReset();
        openImageFirstViewMock.mockResolvedValue(null);
    });

    test("opens by pointer and keyboard without duplicating bindings", async () => {
        const media = document.createElement("div");
        const selectedCard = document.createElement("article");
        const options = {
            imageSrc: "/storage/104/392/original/firefox.svg",
            rowItem: { id: 392, title: "Firefox" },
            tableName: "app_service_catalog",
            selectedCard,
        };

        bindImageFirstViewActivation(media, {
            ...options,
            rowItem: { id: 392, title: "Stale Firefox" },
        }, openImageFirstViewMock);
        bindImageFirstViewActivation(media, options, openImageFirstViewMock);
        document.body.appendChild(media);

        expect(media.getAttribute("role")).toBe("button");
        expect(media.tabIndex).toBe(0);
        expect(media.dataset.imageFirstSrc).toBe(options.imageSrc);
        expect(media.dataset.ariaLabelLangKey).toBe("open_article");

        media.click();
        media.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
        media.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));

        await vi.waitFor(() => {
            expect(openImageFirstViewMock).toHaveBeenCalledTimes(3);
        });
        expect(openImageFirstViewMock).toHaveBeenLastCalledWith(options);
    });
});

// A denied image remains readable and explains synthetic activation without opening IFAV.
test.each(['click', 'Enter', ' '])('denied image %s has no opener semantics', activation => {
    sessionStorage.setItem('user_permissions', '[]');
    document.body.replaceChildren();
    const image = document.createElement('div');
    const open = vi.fn();
    bindImageFirstViewActivation(image, { imageSrc: '/photo.jpg' }, open);
    expect(image.hasAttribute('role')).toBe(false);
    expect(image.hasAttribute('tabindex')).toBe(false);
    expect(image.dataset.articleAccess).toBe('denied');
    document.body.append(image);
    if (activation === 'click') image.click();
    else image.dispatchEvent(new KeyboardEvent('keydown', { key: activation }));
    expect(open).not.toHaveBeenCalled();
    expect(document.querySelector('[data-lang-key="article_view_permission_missing"]')).not.toBeNull();
});
