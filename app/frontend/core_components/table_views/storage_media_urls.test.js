// @vitest-environment node
// storage_media_urls.test.js
// Verifies catalog/list/background URLs prefer display variants over originals.
// Bridges stored /storage paths and the 300/1000/2160 folders used on page load.
// Exists so a rooted original path cannot keep fetching multi-megabyte PNGs.

import { describe, expect, test } from "vitest";
import {
    encodeCssUrlValue,
    resolveDatasetMediaDisplayPath,
    resolveRowMediaDisplayPath,
} from "./storage_media_urls.js";

describe("resolveRowMediaDisplayPath", () => {
    test("rewrites rooted original storage paths onto the requested display folder", () => {
        expect(resolveRowMediaDisplayPath("/storage/9/1/original/9_1_1.png", "300"))
            .toBe("/storage/9/1/300/9_1_1.png");
        expect(resolveRowMediaDisplayPath("/storage/9/2/1000/9_2_1.png", "300"))
            .toBe("/storage/9/2/300/9_2_1.png");
    });

    test("keeps SVG and GIF on original so vector/animated assets are not resized", () => {
        expect(resolveRowMediaDisplayPath("/storage/104/161/original/logo.svg", "300"))
            .toBe("/storage/104/161/original/logo.svg");
        expect(resolveRowMediaDisplayPath("/storage/104/161/300/anim.gif", "1000"))
            .toBe("/storage/104/161/original/anim.gif");
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

    test("keeps SVG dataset media on original", () => {
        expect(resolveDatasetMediaDisplayPath(
            "/storage/104/dataset_media/cover/original/mark.svg",
        )).toBe("/storage/104/dataset_media/cover/original/mark.svg");
    });
});

describe("encodeCssUrlValue", () => {
    test("quotes the rewritten URL for CSS backgrounds", () => {
        expect(encodeCssUrlValue("/storage/104/dataset_media/background/2160/bg.webp"))
            .toBe('url("/storage/104/dataset_media/background/2160/bg.webp")');
    });
});
