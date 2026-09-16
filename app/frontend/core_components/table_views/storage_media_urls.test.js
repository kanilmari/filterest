// @vitest-environment node
// storage_media_urls.test.js
// Verifies catalog/list/background URLs prefer display variants over originals.
// Bridges stored /storage paths and the 300/1000/2160 folders used on page load.
// Exists so a rooted original path cannot keep fetching multi-megabyte PNGs.

import { describe, expect, test } from "vitest";
import {
    displayFolderForSlot,
    encodeCssUrlValue,
    MEDIA_URL_SLOTS,
    mediaVariantFallbackOrder,
    resolveDatasetMediaDisplayPath,
    resolveMediaUrlForSlot,
    resolveRowMediaDisplayPath,
    slotAllowsOriginal,
} from "./storage_media_urls.js";

describe("resolveRowMediaDisplayPath", () => {
    test("rewrites rooted original storage paths onto the requested display folder", () => {
        expect(resolveRowMediaDisplayPath("/storage/9/1/original/9_1_1.png", "300"))
            .toBe("/storage/9/1/300/9_1_1.png");
        expect(resolveRowMediaDisplayPath("/storage/9/2/1000/9_2_1.png", "300"))
            .toBe("/storage/9/2/300/9_2_1.png");
    });

    test("keeps SVG and GIF on the requested display folder so catalog slots do not jump to original", () => {
        expect(resolveRowMediaDisplayPath("/storage/104/161/original/logo.svg", "300"))
            .toBe("/storage/104/161/300/logo.svg");
        expect(resolveRowMediaDisplayPath("/storage/104/161/300/anim.gif", "1000"))
            .toBe("/storage/104/161/1000/anim.gif");
        expect(resolveRowMediaDisplayPath("/storage/104/161/original/logo.svg", "original"))
            .toBe("/storage/104/161/original/logo.svg");
    });

    test("leaves external and unrecognized paths unchanged", () => {
        expect(resolveRowMediaDisplayPath("https://cdn.example/photo.png", "300"))
            .toBe("https://cdn.example/photo.png");
        expect(resolveRowMediaDisplayPath("/static/img.jpg", "300"))
            .toBe("/static/img.jpg");
    });
});

describe("resolveDatasetMediaDisplayPath", () => {
    test("uses 2160 for raster backgrounds and 1000 for raster covers", () => {
        expect(resolveDatasetMediaDisplayPath(
            "/storage/104/dataset_media/background/original/background.webp",
        )).toBe("/storage/104/dataset_media/background/2160/background.webp");
        expect(resolveDatasetMediaDisplayPath(
            "/storage/104/dataset_media/cover/original/cover.webp",
        )).toBe("/storage/104/dataset_media/cover/1000/cover.webp");
    });

    test("uses the named display folder for SVG dataset media instead of original", () => {
        expect(resolveDatasetMediaDisplayPath(
            "/storage/104/dataset_media/cover/original/mark.svg",
        )).toBe("/storage/104/dataset_media/cover/1000/mark.svg");
    });
});

describe("displayFolderForSlot", () => {
    test("guest catalog and list slots request sized variants", () => {
        expect(displayFolderForSlot(MEDIA_URL_SLOTS.GUEST_CATALOG)).toBe("1000");
        expect(displayFolderForSlot(MEDIA_URL_SLOTS.CATALOG)).toBe("1000");
        expect(displayFolderForSlot(MEDIA_URL_SLOTS.LIST)).toBe("300");
        expect(displayFolderForSlot(MEDIA_URL_SLOTS.BACKGROUND)).toBe("2160");
        expect(displayFolderForSlot(MEDIA_URL_SLOTS.COVER)).toBe("1000");
        expect(displayFolderForSlot(MEDIA_URL_SLOTS.SMALL_THUMBNAIL)).toBe("300");
        expect(slotAllowsOriginal(MEDIA_URL_SLOTS.GUEST_CATALOG)).toBe(false);
    });

    test("unknown slots still prefer a sized variant over original", () => {
        expect(displayFolderForSlot("unknown_slot")).toBe("1000");
        expect(displayFolderForSlot("")).toBe("1000");
        expect(slotAllowsOriginal("unknown_slot")).toBe(false);
    });

    test("article, lightbox, and download slots are allowed to use original", () => {
        expect(displayFolderForSlot(MEDIA_URL_SLOTS.ARTICLE)).toBe("original");
        expect(displayFolderForSlot(MEDIA_URL_SLOTS.LIGHTBOX)).toBe("original");
        expect(displayFolderForSlot(MEDIA_URL_SLOTS.DOWNLOAD)).toBe("original");
        expect(slotAllowsOriginal(MEDIA_URL_SLOTS.ARTICLE)).toBe(true);
        expect(slotAllowsOriginal(MEDIA_URL_SLOTS.LIGHTBOX)).toBe(true);
        expect(slotAllowsOriginal(MEDIA_URL_SLOTS.DOWNLOAD)).toBe(true);
    });
});

describe("mediaVariantFallbackOrder", () => {
    test("missing sized variants try a sibling size before original", () => {
        expect(mediaVariantFallbackOrder("2160")).toEqual(["2160", "1000", "300", "original"]);
        expect(mediaVariantFallbackOrder("1000")).toEqual(["1000", "300", "2160", "original"]);
        expect(mediaVariantFallbackOrder("300")).toEqual(["300", "1000", "2160", "original"]);
    });

    test("unknown variants still prefer sized files over original", () => {
        expect(mediaVariantFallbackOrder("640")).toEqual(["1000", "300", "2160", "original"]);
        expect(mediaVariantFallbackOrder("")).toEqual(["1000", "300", "2160", "original"]);
    });

    test("an allowed original request stays original", () => {
        expect(mediaVariantFallbackOrder("original")).toEqual(["original"]);
    });
});

describe("resolveMediaUrlForSlot", () => {
    test("guest catalog slot rewrites raster and SVG originals onto 1000", () => {
        expect(resolveMediaUrlForSlot(
            "/storage/104/392/original/firefox.svg",
            MEDIA_URL_SLOTS.GUEST_CATALOG,
        )).toBe("/storage/104/392/1000/firefox.svg");
        expect(resolveMediaUrlForSlot(
            "/storage/9/1/original/9_1_1.png",
            MEDIA_URL_SLOTS.GUEST_CATALOG,
        )).toBe("/storage/9/1/1000/9_1_1.png");
    });

    test("allowed original slots keep the original file", () => {
        expect(resolveMediaUrlForSlot(
            "/storage/9/1/300/9_1_1.png",
            MEDIA_URL_SLOTS.ARTICLE,
        )).toBe("/storage/9/1/original/9_1_1.png");
        expect(resolveMediaUrlForSlot(
            "/storage/104/dataset_media/background/2160/background.webp",
            MEDIA_URL_SLOTS.DOWNLOAD,
        )).toBe("/storage/104/dataset_media/background/original/background.webp");
    });

    test("unknown slots still rewrite onto a sized variant", () => {
        expect(resolveMediaUrlForSlot(
            "/storage/9/1/original/9_1_1.png",
            "not-a-slot",
        )).toBe("/storage/9/1/1000/9_1_1.png");
        expect(resolveMediaUrlForSlot(
            "/storage/media/174668a1-2efa-45a6-aa6c-d8a4ee8ec069/original/image.png",
            MEDIA_URL_SLOTS.LIST,
        )).toBe("/storage/media/174668a1-2efa-45a6-aa6c-d8a4ee8ec069/300/image.png");
    });
});

describe("encodeCssUrlValue", () => {
    test("quotes the rewritten URL for CSS backgrounds", () => {
        expect(encodeCssUrlValue("/storage/104/dataset_media/background/2160/bg.webp"))
            .toBe('url("/storage/104/dataset_media/background/2160/bg.webp")');
    });
});
