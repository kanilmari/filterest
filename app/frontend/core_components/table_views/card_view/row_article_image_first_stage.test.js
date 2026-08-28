/* @vitest-environment jsdom */

import { describe, expect, test, vi } from "vitest";

vi.mock("../../lang/translation_handler.js", () => ({
    getTranslationForKey: vi.fn((key) => ({
        next_image: "Next image",
        previous_image: "Previous image",
        show_more: "Show article",
    })[key] || ""),
}));

import {
    activateImageFirstStageTransitionMedia,
    buildRowArticleImageFirstStage,
    settleImageFirstStageTransitionMedia,
} from "./row_article_image_first_stage.js";

function createStage(rows, options = {}) {
    let activeRow = rows[0];
    const selected = [];
    const onBackdropActivate = vi.fn();
    const result = buildRowArticleImageFirstStage({
        imageEntries: rows.map((row) => ({ row })),
        getActiveRow: () => activeRow,
        onSelectRow: (row) => {
            activeRow = row;
            selected.push(row.id);
        },
        resolvePath: (filename) => `/storage/${filename}`,
        resolveAlt: (row) => row.alt,
        onBackdropActivate,
        tableName: options.tableName || "",
        rowLabel: options.rowLabel || "",
    });
    return { ...result, onBackdropActivate, selected };
}

describe("row article image-first stage", () => {
    test("disables both navigation arrows for one image", () => {
        const { element, onBackdropActivate } = createStage([
            { id: 1, filename: "one.jpg", alt: "One" },
        ], { rowLabel: "Example article" });

        const previousButton = element.querySelector(
            "[data-testid='row-article-image-previous']",
        );
        const nextButton = element.querySelector(
            "[data-testid='row-article-image-next']",
        );
        expect(previousButton.disabled).toBe(true);
        expect(nextButton.disabled).toBe(true);
        nextButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        expect(onBackdropActivate).not.toHaveBeenCalled();
        expect(element.querySelector("img").alt).toBe("One");
        expect(element.querySelector("[aria-live='polite']").textContent).toBe("1 / 1");
        expect(element.getAttribute("aria-label")).toBe("Images");
        const revealCluster = element.querySelector(
            "[data-testid='row-article-image-first-reveal-cluster']",
        );
        const revealTitle = element.querySelector(
            "[data-testid='row-article-image-first-reveal-title']",
        );
        expect(revealCluster.contains(element.querySelector(".row_article_image_first_media")))
            .toBe(true);
        expect(revealTitle.textContent).toBe("Example article");
        expect(revealTitle.getAttribute("aria-hidden")).toBe("true");
    });

    test("supports buttons, arrow keys, and horizontal touch gestures", () => {
        const rows = [
            { id: 1, filename: "one.jpg", alt: "One" },
            { id: 2, filename: "two.jpg", alt: "Two" },
            { id: 3, filename: "three.jpg", alt: "Three" },
        ];
        const { element, selected } = createStage(rows);

        element.querySelector("[data-testid='row-article-image-next']").click();
        element.dispatchEvent(new KeyboardEvent("keydown", {
            key: "ArrowRight",
            bubbles: true,
            cancelable: true,
        }));

        const touchStart = new Event("touchstart", { bubbles: true });
        Object.defineProperty(touchStart, "touches", { value: [{ clientX: 120 }] });
        element.dispatchEvent(touchStart);
        const touchEnd = new Event("touchend", { bubbles: true });
        Object.defineProperty(touchEnd, "changedTouches", { value: [{ clientX: 190 }] });
        element.dispatchEvent(touchEnd);

        expect(selected).toEqual([2, 3, 2]);
        expect(element.querySelector("img").getAttribute("src")).toBe("/storage/two.jpg");
        expect(element.querySelector("[data-testid='row-article-image-previous']")
            .getAttribute("aria-label")).toBe("Previous image");
    });

    test("shows the article cue and treats raster letterbox space as the backdrop", () => {
        const { element, onBackdropActivate } = createStage([
            { id: 1, filename: "one.jpg", alt: "One" },
        ]);
        const articleContent = document.createElement("article");
        articleContent.scrollIntoView = vi.fn();
        document.body.append(element, articleContent);

        expect(element.style.getPropertyValue("--row-article-image-first-backdrop"))
            .toContain("/storage/one.jpg");
        const image = element.querySelector("img");
        image.click();
        expect(onBackdropActivate).not.toHaveBeenCalled();

        element.querySelector(".row_article_image_first_media").click();
        expect(onBackdropActivate).toHaveBeenCalledOnce();

        element.click();
        expect(onBackdropActivate).toHaveBeenCalledTimes(2);

        const scrollHint = element.querySelector("[data-testid='row-article-image-scroll-hint']");
        expect(scrollHint.textContent).toContain("Show article");
        scrollHint.click();
        expect(articleContent.scrollIntoView).toHaveBeenCalledWith({
            behavior: "smooth",
            block: "start",
        });
    });

    test("closes above or below a wide contained image but not on its pixels", () => {
        const { element, onBackdropActivate } = createStage([
            { id: 1, filename: "wide.jpg", alt: "Wide" },
        ]);
        const image = element.querySelector("img");
        Object.defineProperties(image, {
            naturalWidth: { configurable: true, value: 1600 },
            naturalHeight: { configurable: true, value: 400 },
        });
        image.getBoundingClientRect = () => ({
            left: 0,
            top: 0,
            right: 1000,
            bottom: 1000,
            width: 1000,
            height: 1000,
            x: 0,
            y: 0,
            toJSON: () => ({}),
        });

        image.dispatchEvent(new MouseEvent("click", {
            bubbles: true,
            clientX: 500,
            clientY: 100,
        }));
        expect(onBackdropActivate).toHaveBeenCalledOnce();

        image.dispatchEvent(new MouseEvent("click", {
            bubbles: true,
            clientX: 500,
            clientY: 500,
        }));
        expect(onBackdropActivate).toHaveBeenCalledOnce();

        image.dispatchEvent(new MouseEvent("click", {
            bubbles: true,
            clientX: 500,
            clientY: 900,
        }));
        expect(onBackdropActivate).toHaveBeenCalledTimes(2);
    });

    test("closes beside a tall contained image but not on its pixels", () => {
        const { element, onBackdropActivate } = createStage([
            { id: 1, filename: "tall.jpg", alt: "Tall" },
        ]);
        const image = element.querySelector("img");
        Object.defineProperties(image, {
            naturalWidth: { configurable: true, value: 400 },
            naturalHeight: { configurable: true, value: 1600 },
        });
        image.getBoundingClientRect = () => ({
            left: 0,
            top: 0,
            right: 1000,
            bottom: 1000,
            width: 1000,
            height: 1000,
            x: 0,
            y: 0,
            toJSON: () => ({}),
        });

        image.dispatchEvent(new MouseEvent("click", {
            bubbles: true,
            clientX: 100,
            clientY: 500,
        }));
        expect(onBackdropActivate).toHaveBeenCalledOnce();

        image.dispatchEvent(new MouseEvent("click", {
            bubbles: true,
            clientX: 500,
            clientY: 500,
        }));
        expect(onBackdropActivate).toHaveBeenCalledOnce();
    });

    test("encodes the active image URL before passing it to the CSS backdrop", () => {
        const { element } = createStage([
            { id: 1, filename: 'cover");background:red;(.jpg', alt: "Cover" },
        ]);
        const backdropValue = element.style.getPropertyValue(
            "--row-article-image-first-backdrop",
        );

        expect(backdropValue).toContain("%22");
        expect(backdropValue).toContain("%28");
        expect(backdropValue).not.toContain('url("/storage/cover")');
    });

    test("uses the shared SVG mark-and-label presentation in the full-height viewer", () => {
        const { element, onBackdropActivate } = createStage(
            [{ id: 1, filename: "firefox.svg", alt: "Firefox logo" }],
            { tableName: "app_service_catalog", rowLabel: "Firefox" },
        );

        const mediaHost = element.querySelector(".row_article_image_first_media");
        expect(mediaHost?.dataset.imagePresentationKind).toBe("svg-logo");
        expect(mediaHost?.querySelector(".record_svg_image_presentation__label")?.textContent)
            .toBe("Firefox");
        expect(mediaHost?.querySelector("img")?.getAttribute("src"))
            .toBe("/storage/firefox.svg");
        mediaHost.click();
        expect(onBackdropActivate).not.toHaveBeenCalled();
    });

    test("uses a raster copy only while an SVG stage is moving", async () => {
        const drawImage = vi.fn();
        const getContext = vi.spyOn(HTMLCanvasElement.prototype, "getContext")
            .mockReturnValue({ drawImage });
        const toDataURL = vi.spyOn(HTMLCanvasElement.prototype, "toDataURL")
            .mockReturnValue("data:image/png;base64,transition-copy");
        const originalDecode = Object.getOwnPropertyDescriptor(
            HTMLImageElement.prototype,
            "decode",
        );
        Object.defineProperty(HTMLImageElement.prototype, "decode", {
            configurable: true,
            value: vi.fn().mockResolvedValue(undefined),
        });

        try {
            const { element, whenTransitionMediaReady } = createStage(
                [{
                    id: 1,
                    filename: "openstreetmap.svg",
                    mime_type: "image/svg+xml",
                    alt: "OpenStreetMap",
                }],
                { tableName: "app_service_catalog", rowLabel: "OpenStreetMap" },
            );
            document.body.appendChild(element);
            const image = element.querySelector("img");
            Object.defineProperties(image, {
                naturalWidth: { configurable: true, value: 256 },
                naturalHeight: { configurable: true, value: 256 },
            });
            image.dispatchEvent(new Event("load"));

            await whenTransitionMediaReady();

            expect(drawImage).toHaveBeenCalledWith(image, 0, 0, 256, 256);
            expect(image.getAttribute("src")).toBe("/storage/openstreetmap.svg");
            expect(element.style.getPropertyValue("--row-article-image-first-backdrop"))
                .toContain("data:image/png");

            activateImageFirstStageTransitionMedia(element);
            expect(image.getAttribute("src")).toBe("data:image/png;base64,transition-copy");
            const revealCluster = element.querySelector(
                "[data-testid='row-article-image-first-reveal-cluster']",
            );
            const animationEnd = typeof window.AnimationEvent === "function"
                ? new window.AnimationEvent("animationend", {
                    animationName: "image-first-foreground-grow",
                    bubbles: true,
                })
                : new Event("animationend", { bubbles: true });
            if (!("animationName" in animationEnd)) {
                Object.defineProperty(animationEnd, "animationName", {
                    value: "image-first-foreground-grow",
                });
            }
            revealCluster.dispatchEvent(animationEnd);
            expect(image.getAttribute("src")).toBe("/storage/openstreetmap.svg");

            activateImageFirstStageTransitionMedia(element);
            expect(image.getAttribute("src")).toBe("data:image/png;base64,transition-copy");
            settleImageFirstStageTransitionMedia(element);
            expect(image.getAttribute("src")).toBe("/storage/openstreetmap.svg");
        } finally {
            getContext.mockRestore();
            toDataURL.mockRestore();
            if (originalDecode) {
                Object.defineProperty(HTMLImageElement.prototype, "decode", originalDecode);
            } else {
                delete HTMLImageElement.prototype.decode;
            }
        }
    });

    test("closes from unused space around an image-backed service logo", () => {
        const { element, onBackdropActivate } = createStage(
            [{ id: 1, filename: "service-logo.jpg", alt: "Service logo" }],
            { tableName: "app_service_catalog", rowLabel: "Service" },
        );

        const mediaHost = element.querySelector(".row_article_image_first_media");
        expect(mediaHost?.dataset.serviceCatalogLogoRenderMode).toBe("image");

        mediaHost.querySelector("img").click();
        expect(onBackdropActivate).not.toHaveBeenCalled();

        mediaHost.click();
        expect(onBackdropActivate).toHaveBeenCalledOnce();
    });
});
