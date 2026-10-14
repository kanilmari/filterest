/* @vitest-environment jsdom */
// row_article_image_first_stage.test.js
// Verifies image-first navigation, backdrop activation and photo resource disposal.
// Connects painted photo bounds and stage controls with their DOM lifecycle.
// Keeps background clicks working when the foreground box shrinks or is replaced.

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
import { disposeCardResources } from "./card_resource_lifecycle.js";

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
    test("waits for a cached tiny photo's decode before publishing its natural ratio", async () => {
        const originalDecode = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "decode");
        let finishDecode;
        const decode = vi.fn(() => new Promise(resolve => { finishDecode = resolve; }));
        Object.defineProperty(HTMLImageElement.prototype, "decode", { configurable: true, value: decode });
        try {
            const stage = createStage([{ id: 1, filename: "tiny.png" }]);
            const image = stage.element.querySelector("img");
            const property = "--row-article-image-first-photo-ratio";
            Object.defineProperties(image, {
                complete: { configurable: true, value: true },
                naturalWidth: { configurable: true, value: 1 },
                naturalHeight: { configurable: true, value: 1 },
            });
            expect(decode).toHaveBeenCalledOnce();
            expect(image.style.getPropertyValue(property)).toBe("");
            finishDecode();
            await stage.whenTransitionMediaReady();
            expect(image.style.getPropertyValue(property)).toBe("1");
            expect(stage.element.style.getPropertyValue(property)).toBe("");
            disposeCardResources(stage.element);
            expect(image.style.getPropertyValue(property)).toBe("");
        } finally {
            if (originalDecode) Object.defineProperty(HTMLImageElement.prototype, "decode", originalDecode);
            else delete HTMLImageElement.prototype.decode;
        }
    });

    test("updates the loaded ratio on image change and revokes replaced/closed images", () => {
        const stage = createStage([
            { id: 1, filename: "square.jpg" },
            { id: 2, filename: "wide.jpg" },
        ]);
        const first = stage.element.querySelector("img");
        const property = "--row-article-image-first-photo-ratio";
        Object.defineProperties(first, {
            naturalWidth: { configurable: true, value: 400 },
            naturalHeight: { configurable: true, value: 400 },
        });
        first.dispatchEvent(new Event("load"));
        expect(first.style.getPropertyValue(property)).toBe("1");
        stage.element.querySelector("[data-testid='row-article-image-next']").click();
        const second = stage.element.querySelector("img");
        expect(first.style.getPropertyValue(property)).toBe("");
        expect(second.style.getPropertyValue(property)).toBe("");
        first.dispatchEvent(new Event("load"));
        expect(first.style.getPropertyValue(property)).toBe("");
        Object.defineProperties(second, {
            naturalWidth: { configurable: true, value: 1600 },
            naturalHeight: { configurable: true, value: 600 },
        });
        second.dispatchEvent(new Event("load"));
        expect(Number(second.style.getPropertyValue(property))).toBeCloseTo(8 / 3);
        disposeCardResources(stage.element);
        second.dispatchEvent(new Event("load"));
        expect(second.style.getPropertyValue(property)).toBe("");
    });

    test("late decoding cannot recreate a ratio after replacement or teardown", async () => {
        const originalDecode = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "decode");
        const completions = [];
        Object.defineProperty(HTMLImageElement.prototype, "decode", {
            configurable: true,
            value: () => new Promise(resolve => { completions.push(resolve); }),
        });
        try {
            const stage = createStage([
                { id: 1, filename: "first.jpg" }, { id: 2, filename: "second.jpg" },
            ]);
            const first = stage.element.querySelector("img");
            stage.element.querySelector("[data-testid='row-article-image-next']").click();
            const second = stage.element.querySelector("img");
            for (const image of [first, second]) Object.defineProperties(image, {
                naturalWidth: { configurable: true, value: 600 },
                naturalHeight: { configurable: true, value: 1600 },
            });
            disposeCardResources(stage.element);
            completions.forEach(resolve => resolve());
            await stage.whenTransitionMediaReady();
            for (const image of [first, second]) {
                expect(image.style.getPropertyValue("--row-article-image-first-photo-ratio")).toBe("");
            }
        } finally {
            if (originalDecode) Object.defineProperty(HTMLImageElement.prototype, "decode", originalDecode);
            else delete HTMLImageElement.prototype.decode;
        }
    });

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
        expect(element.querySelector("[data-testid='row-article-image-first-caption']").hidden)
            .toBe(true);
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

    test("shows the active image caption as an overlay and updates it with navigation", () => {
        const rows = [
            { id: 1, filename: "one.jpg", alt: "One", description: { en: "First image" } },
            { id: 2, filename: "two.jpg", alt: "Two", description: { en: "Second image" } },
        ];
        const { element } = createStage(rows);
        const caption = element.querySelector("[data-testid='row-article-image-first-caption']");

        expect(caption.textContent).toBe("First image");
        expect(caption.hidden).toBe(false);
        element.querySelector("[data-testid='row-article-image-next']").click();
        expect(caption.textContent).toBe("Second image");
    });

    test("groups the caption with the article cue without changing link or scroll actions", () => {
        const { element, onBackdropActivate } = createStage([{
            id: 1, filename: "one.jpg", alt: "One",
            description: { en: "Illustration – [Photographer](https://unsplash.com/photos/example)" },
        }]);
        const article = document.createElement("article");
        article.scrollIntoView = vi.fn();
        document.body.append(element, article);
        const controls = element.querySelector("[data-testid='row-article-image-first-bottom-controls']");
        const caption = controls.querySelector("[data-testid='row-article-image-first-caption']");
        const cue = controls.querySelector("[data-testid='row-article-image-scroll-hint']");
        expect([...controls.children]).toEqual([caption, cue]);
        expect(element.querySelector(".row_article_image_first_reveal_cluster").contains(controls))
            .toBe(true);
        const credit = caption.querySelector("a");
        expect(credit.href).toBe("https://unsplash.com/photos/example");
        credit.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
        controls.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        expect(onBackdropActivate).not.toHaveBeenCalled();
        expect(article.scrollIntoView).not.toHaveBeenCalled();
        cue.click();
        expect(onBackdropActivate).not.toHaveBeenCalled();
        expect(article.scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
        element.remove();
        article.remove();
    });

    test("keeps the article cue in the group when navigation removes the caption", () => {
        const { element } = createStage([
            { id: 1, filename: "one.jpg", description: { en: "Image credit" } },
            { id: 2, filename: "two.jpg" },
        ]);
        const controls = element.querySelector("[data-testid='row-article-image-first-bottom-controls']");
        const caption = controls.querySelector(".row_article_image_first_caption");
        const cue = controls.querySelector(".row_article_image_first_scroll_hint");
        expect(caption.hidden).toBe(false);
        element.querySelector("[data-testid='row-article-image-next']").click();
        expect(caption.hidden).toBe(true);
        expect(caption.nextElementSibling).toBe(cue);
        expect(cue.hidden).toBe(false);
        element.querySelector("[data-testid='row-article-image-previous']").click();
        expect(caption.hidden).toBe(false);
        expect(controls.children).toHaveLength(2);
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

    // Explicit viewport-relative rectangles cover both the old letterboxed img
    // and the smaller scrolled photo box. Empty space can hit any stage wrapper.
    const backdropCases = [
        ["desktop square", 1440, 900, 400, 400, [270, 0, 900, 900], [270, 0, 900, 900]],
        ["desktop wide", 1440, 900, 1600, 600, [0, 0, 1440, 900], [0, 180, 1440, 540]],
        ["phone square", 390, 844, 400, 400, [0, 0, 390, 844], [0, 227, 390, 390]],
        ["phone portrait", 390, 844, 400, 1600, [89.5, 0, 211, 844], [89.5, 0, 211, 844]],
    ].flatMap(([name, width, height, naturalWidth, naturalHeight, unscrolled, painted]) =>
        [false, true].flatMap(scrolled => ["mouse", "touch"].map(input => ({
            name: `${name}, ${scrolled ? "scrolled" : "unscrolled"}, ${input}`,
            width, height, naturalWidth, naturalHeight, painted, input, scrolled,
            imageBox: scrolled ? painted : unscrolled,
        }))),
    );

    function activatePoint(target, clientX, clientY, input) {
        if (input === "touch") {
            // A tap supplies the same click used by browsers after touchend;
            // the stage's existing swipe listeners see a stationary gesture.
            for (const type of ["touchstart", "touchend"]) {
                const event = new Event(type, { bubbles: true });
                Object.defineProperty(event, type === "touchstart" ? "touches" : "changedTouches", {
                    value: [{ clientX, clientY }],
                });
                target.dispatchEvent(event);
            }
        }
        target.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX, clientY, detail: 1 }));
    }

    test.each(backdropCases)("tests the painted photo independently of the hit wrapper: $name", ({
        width, height, naturalWidth, naturalHeight, painted, imageBox, input, scrolled,
    }) => {
        const { element, onBackdropActivate } = createStage([{ id: 1, filename: "photo.jpg" }]);
        element.classList.toggle("image-modal-content-scrolled", scrolled);
        const stageLeft = 20;
        const stageTop = scrolled ? -40 : 30;
        element.getBoundingClientRect = () => new DOMRect(stageLeft, stageTop, width, height);
        const image = element.querySelector("img");
        Object.defineProperties(image, {
            naturalWidth: { configurable: true, value: naturalWidth },
            naturalHeight: { configurable: true, value: naturalHeight },
        });
        image.getBoundingClientRect = () => new DOMRect(
            stageLeft + imageBox[0], stageTop + imageBox[1], imageBox[2], imageBox[3],
        );
        const [left, top, photoWidth, photoHeight] = painted;
        const points = [
            ["photo center", left + photoWidth / 2, top + photoHeight / 2, false],
            ["photo edge", left, top + photoHeight / 2, false],
        ];
        if (left > 0) points.push(["left gap", left / 2, height / 2, true]);
        if (left + photoWidth < width) points.push(["right gap", (left + photoWidth + width) / 2, height / 2, true]);
        if (top > 0) points.push(["above photo", width / 2, top / 2, true]);
        if (top + photoHeight < height) points.push(["below photo", width / 2, (top + photoHeight + height) / 2, true]);
        const targets = [element, image.parentElement, image.parentElement.parentElement, image];
        for (const target of targets) {
            for (const [label, x, y, closes] of points) {
                onBackdropActivate.mockClear();
                activatePoint(target, stageLeft + x, stageTop + y, input);
                expect(onBackdropActivate, `${target.className || target.tagName}: ${label}`)
                    .toHaveBeenCalledTimes(closes ? 1 : 0);
            }
        }
        disposeCardResources(element);
    });

    test("uses the current photo's bounds after navigation and removes backdrop handling on disposal", () => {
        const { element, onBackdropActivate } = createStage([
            { id: 1, filename: "square.jpg" }, { id: 2, filename: "wide.jpg" },
        ]);
        const setPhotoBounds = (width, height, bounds) => {
            const image = element.querySelector("img");
            Object.defineProperties(image, {
                naturalWidth: { configurable: true, value: width },
                naturalHeight: { configurable: true, value: height },
            });
            image.getBoundingClientRect = () => bounds;
        };
        const cluster = element.querySelector(".row_article_image_first_reveal_cluster");
        setPhotoBounds(400, 400, new DOMRect(270, 0, 900, 900));
        activatePoint(cluster, 100, 450, "mouse");
        expect(onBackdropActivate).toHaveBeenCalledOnce();
        element.querySelector("[data-testid='row-article-image-next']").click();
        setPhotoBounds(1600, 600, new DOMRect(0, 180, 1440, 540));
        activatePoint(cluster, 100, 450, "mouse");
        expect(onBackdropActivate).toHaveBeenCalledOnce();
        activatePoint(cluster, 720, 50, "touch");
        expect(onBackdropActivate).toHaveBeenCalledTimes(2);
        const removeListener = vi.spyOn(element, "removeEventListener");
        disposeCardResources(element);
        expect(removeListener).toHaveBeenCalledWith("click", expect.any(Function), undefined);
        activatePoint(cluster, 720, 50, "touch");
        expect(onBackdropActivate).toHaveBeenCalledTimes(2);
        removeListener.mockRestore();
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

    test.each(["app_service_catalog", "ordinary_dataset"])("closes from unused space around an image-backed logo in %s", (tableName) => {
        const { element, onBackdropActivate } = createStage(
            [{
                id: 1, filename: "service-logo.jpg", alt: "Service logo", type_id: 1,
                metadata_json: { logo_variant: "example", logo_render_mode: "normal_image" },
            }],
            { tableName, rowLabel: "Service" },
        );

        const mediaHost = element.querySelector(".row_article_image_first_media");
        expect(mediaHost?.dataset.serviceCatalogLogoRenderMode).toBe("image");

        mediaHost.querySelector("img").click();
        expect(onBackdropActivate).not.toHaveBeenCalled();

        mediaHost.click();
        expect(onBackdropActivate).toHaveBeenCalledOnce();
    });
});
