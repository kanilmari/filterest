/* @vitest-environment jsdom */
// svg_image_presentation.test.js
// Verifies shared SVG identification, labels, and safe DOM construction.
// Bridges URL/cache/metadata inputs with the presentation used by every record-image surface.
// Exists to keep raster media unchanged and prevent raw SVG markup injection.

import { describe, expect, test } from "vitest";

import {
    appendImageWithSvgPresentation,
    createSvgImagePresentation,
    isSvgImageAsset,
    resolveSvgImageLabel,
} from "./svg_image_presentation.js";

describe("shared SVG image presentation", () => {
    test.each([
        [{ imageSrc: "/storage/12/34/300/logo.svg?rev=2" }],
        [{ imageSrc: "https://cdn.example.test/cache/brand%2Esvg#mark" }],
        [{ imageSrc: "data:image/svg+xml,%3Csvg%3E%3C/svg%3E" }],
        [{ imageSrc: "/api/assets/42", imageMimeType: "image/svg+xml; charset=utf-8" }],
        [{ imageSrc: "/api/assets/42", imageOriginalName: "brand.svg" }],
        [{ imageSrc: "/cache/42", imageMetadata: JSON.stringify({ original_name: "brand.svg" }) }],
    ])("recognizes SVG media from path, URL, data source, or metadata: %o", (input) => {
        expect(isSvgImageAsset(input)).toBe(true);
    });

    test("leaves raster media outside the SVG presentation policy", () => {
        expect(isSvgImageAsset({
            imageSrc: "/storage/12/34/300/photo.webp?rev=2",
            imageMimeType: "image/webp",
        })).toBe(false);
    });

    test("prefers the record name and falls back to safe file-derived text", () => {
        expect(resolveSvgImageLabel({
            rowLabel: "Firefox",
            imageTitle: "Browser logo",
            imageOriginalName: "firefox.svg",
        })).toBe("Firefox");
        expect(resolveSvgImageLabel({ imageOriginalName: "open_street-map.svg" }))
            .toBe("open street map");
    });

    test("builds a labelled image wrapper without parsing SVG markup", () => {
        const image = document.createElement("img");
        image.src = "/storage/logo.svg";
        image.alt = "Picture: Firefox";

        const presentation = createSvgImagePresentation(image, {
            imageSrc: "/storage/logo.svg",
            rowLabel: "<strong>Firefox</strong>",
            altText: "Picture: Firefox",
            renderSlot: "image_first",
        });

        expect(presentation?.dataset.imagePresentationKind).toBe("svg-logo");
        expect(presentation?.classList.contains("record_image_logo_presentation")).toBe(true);
        expect(presentation?.getAttribute("aria-label")).toBe("Picture: Firefox");
        expect(presentation?.querySelector("strong")).toBeNull();
        expect(presentation?.querySelector(".record_svg_image_presentation__label")?.textContent)
            .toBe("<strong>Firefox</strong>");
        expect(image.getAttribute("aria-hidden")).toBe("true");
        expect(image.classList.contains("record_image_logo_presentation__mark")).toBe(true);
        expect(image.alt).toBe("");
    });

    test("keeps the shared name treatment in tiny navigation thumbnails", () => {
        const image = document.createElement("img");
        const presentation = createSvgImagePresentation(image, {
            imageSrc: "/storage/logo.svg",
            rowLabel: "Firefox",
            renderSlot: "small_thumbnail",
        });

        expect(presentation?.classList.contains("record_svg_image_presentation--mark-only"))
            .toBe(false);
        expect(presentation?.querySelector(".record_svg_image_presentation__label")?.textContent)
            .toBe("Firefox");
        expect(presentation?.querySelector(".record_image_logo_presentation__label"))
            .not.toBeNull();
    });

    test("appends raster images unchanged and marks SVG hosts centrally", () => {
        const rasterHost = document.createElement("div");
        const rasterImage = document.createElement("img");
        appendImageWithSvgPresentation(rasterHost, rasterImage, {
            imageSrc: "/storage/photo.png",
        });
        expect(rasterHost.dataset.imagePresentationKind).toBe("raster");
        expect(rasterHost.firstElementChild).toBe(rasterImage);

        const svgHost = document.createElement("div");
        const svgImage = document.createElement("img");
        appendImageWithSvgPresentation(svgHost, svgImage, {
            imageSrc: "/storage/logo.svg",
            rowLabel: "Logo",
        });
        expect(svgHost.dataset.imagePresentationKind).toBe("svg-logo");
        expect(svgHost.classList.contains("record_svg_image_frame")).toBe(true);
        expect(svgHost.querySelector(".record_svg_image_presentation__label")?.textContent)
            .toBe("Logo");
    });
});
