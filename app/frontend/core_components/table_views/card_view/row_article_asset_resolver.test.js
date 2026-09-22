/* @vitest-environment jsdom */

import { describe, expect, test } from "vitest";
import {
    filterRowArticleNonMediaChildTables,
    isMediaChildTable,
    isImageAssetChildTable,
    isSharedAssetChildTable,
    resolveRowArticleAttachmentListChild,
    resolveRowArticleDynamicAssetChildren,
    resolveRowArticleImageGalleryChild,
    resolveRowArticleParentImageRows,
} from "./row_article_asset_resolver.js";

describe("resolveRowArticleParentImageRows", () => {
    test("converts every populated parent image-role value into a gallery row", () => {
        const rows = resolveRowArticleParentImageRows(
            {
                cached_image: " 10_2_1.webp ",
                secondary_image: "10_2_2.webp",
                empty_image: "",
                title: "Ticket",
            },
            ["cached_image", "secondary_image", "empty_image"],
        );

        expect(rows).toEqual([
            expect.objectContaining({
                filename: "10_2_1.webp",
                is_parent_row_image: true,
                is_primary: true,
                parent_image_column: "cached_image",
            }),
            expect.objectContaining({
                filename: "10_2_2.webp",
                is_parent_row_image: true,
                is_primary: false,
                parent_image_column: "secondary_image",
            }),
        ]);
    });
});

describe("resolveRowArticleDynamicAssetChildren", () => {
    test("splits image-asset and shared-asset child tables from fetchDynamicChildren payload", () => {
        const childTables = [
            { dataset: "app_service_catalog_comments", column: "app_service_catalog_id", rows: [] },
            { dataset: "app_service_catalog_gallery", column: "app_service_catalog_id", relation_kind: "image_asset", rows: [] },
            { dataset: "app_service_catalog_assets", column: "app_service_catalog_id", relation_kind: "shared_asset", rows: [] },
        ];

        const resolved = resolveRowArticleDynamicAssetChildren(childTables);

        expect(resolved.imagesChild?.dataset).toBe("app_service_catalog_gallery");
        expect(resolved.assetsChild?.dataset).toBe("app_service_catalog_assets");
    });

    test("uses explicit relation_kind helpers for narrow caller logic", () => {
        expect(isImageAssetChildTable({ dataset: "articles_gallery" })).toBe(false);
        expect(isImageAssetChildTable({ dataset: "articles_assets" })).toBe(false);
        expect(isImageAssetChildTable({ dataset: "articles_media", relation_kind: "image_asset" })).toBe(true);
        expect(isImageAssetChildTable({ dataset: "articles_gallery", relation_kind: "rows" })).toBe(false);
        expect(isSharedAssetChildTable({ dataset: "articles_assets" })).toBe(false);
        expect(isSharedAssetChildTable({ dataset: "articles_gallery" })).toBe(false);
        expect(isSharedAssetChildTable({ dataset: "articles_media", relation_kind: "shared_asset" })).toBe(true);
        expect(isSharedAssetChildTable({ dataset: "articles_assets", relation_kind: "rows" })).toBe(false);
        expect(isMediaChildTable({ dataset: "articles_gallery" })).toBe(false);
        expect(isMediaChildTable({ dataset: "articles_assets" })).toBe(false);
        expect(isMediaChildTable({ dataset: "articles_media", relation_kind: "image_asset" })).toBe(true);
        expect(isMediaChildTable({ dataset: "articles_gallery", relation_kind: "rows" })).toBe(false);
        expect(isMediaChildTable({ dataset: "articles_comments" })).toBe(false);
    });

    test("filters asset child tables out of generic related-tab candidate lists", () => {
        const childTables = [
            { dataset: "app_service_catalog_gallery", column: "app_service_catalog_id", relation_kind: "image_asset", rows: [{ id: 1 }] },
            { dataset: "app_service_catalog_assets", column: "app_service_catalog_id", relation_kind: "shared_asset", rows: [{ id: 2 }] },
            { dataset: "app_service_catalog_riskienhallinta_relation", column: "app_service_catalog_id", rows: [{ id: 4 }] },
            { dataset: "app_service_catalog_comments", column: "app_service_catalog_id", rows: [{ id: 3 }] },
        ];

        expect(filterRowArticleNonMediaChildTables(childTables)).toEqual([
            { dataset: "app_service_catalog_comments", column: "app_service_catalog_id", rows: [{ id: 3 }] },
        ]);
    });
});

describe("resolveRowArticleImageGalleryChild", () => {
    test("prefers shared assets when image linking points to _assets", () => {
        const assetsChild = {
            dataset: "app_service_catalog_assets",
            column: "app_service_catalog_id",
            relation_kind: "shared_asset",
            rows: [],
        };

        expect(
            resolveRowArticleImageGalleryChild(
                "app_service_catalog",
                true,
                { child_table: "app_service_catalog_assets" },
                {
                    dataset: "app_service_catalog_gallery",
                    column: "app_service_catalog_id",
                    relation_kind: "image_asset",
                    rows: [{ id: 1, filename: "legacy.png" }],
                },
                assetsChild,
            ),
        ).toEqual(assetsChild);
    });

    test("prefers shared assets when image linking points to a relation_kind tagged shared asset child without _assets suffix", () => {
        const assetsChild = {
            dataset: "app_service_catalog_media",
            column: "app_service_catalog_id",
            relation_kind: "shared_asset",
            rows: [],
        };

        expect(
            resolveRowArticleImageGalleryChild(
                "app_service_catalog",
                true,
                { child_table: "app_service_catalog_media" },
                null,
                assetsChild,
            ),
        ).toEqual(assetsChild);
    });

    test("prefers shared assets when they already contain image rows", () => {
        const assetsChild = {
            dataset: "app_service_catalog_assets",
            column: "app_service_catalog_id",
            relation_kind: "shared_asset",
            rows: [
                { id: 1, asset_kind: "image", filename: "canonical.png" },
                { id: 2, asset_kind: "pdf", filename: "brochure.pdf" },
            ],
        };
        const imagesChild = {
            dataset: "app_service_catalog_gallery",
            column: "app_service_catalog_id",
            relation_kind: "image_asset",
            rows: [{ id: 3, filename: "legacy.png" }],
        };

        expect(
            resolveRowArticleImageGalleryChild(
                "app_service_catalog",
                true,
                null,
                imagesChild,
                assetsChild,
            ),
        ).toEqual(assetsChild);
    });

    test("falls back to legacy images when shared assets only contain attachments", () => {
        const imagesChild = {
            dataset: "app_service_catalog_gallery",
            column: "app_service_catalog_id",
            relation_kind: "image_asset",
            rows: [{ id: 3, filename: "legacy.png" }],
        };
        const assetsChild = {
            dataset: "app_service_catalog_assets",
            column: "app_service_catalog_id",
            relation_kind: "shared_asset",
            rows: [{ id: 2, asset_kind: "pdf", filename: "brochure.pdf" }],
        };

        expect(
            resolveRowArticleImageGalleryChild(
                "app_service_catalog",
                true,
                null,
                imagesChild,
                assetsChild,
            ),
        ).toEqual(imagesChild);
    });

    test("uses shared assets as the upload target when image linking is enabled and no legacy child exists", () => {
        const assetsChild = {
            dataset: "app_service_catalog_assets",
            column: "app_service_catalog_id",
            relation_kind: "shared_asset",
            rows: [],
        };

        expect(
            resolveRowArticleImageGalleryChild(
                "app_service_catalog",
                true,
                { enabled: true },
                null,
                assetsChild,
            ),
        ).toEqual(assetsChild);
    });

    test("does not route image uploads into attachment-only shared assets without image linking", () => {
        const assetsChild = {
            dataset: "app_service_catalog_assets",
            column: "app_service_catalog_id",
            relation_kind: "shared_asset",
            rows: [{ id: 9, asset_kind: "pdf", filename: "brochure.pdf" }],
        };

        expect(
            resolveRowArticleImageGalleryChild(
                "app_service_catalog",
                true,
                null,
                null,
                assetsChild,
            ),
        ).toBeNull();
    });
});

describe("resolveRowArticleAttachmentListChild", () => {
    test("prefers a relation_kind tagged shared asset child even without _assets suffix", () => {
        const assetsChild = {
            dataset: "app_service_catalog_media",
            column: "app_service_catalog_id",
            relation_kind: "shared_asset",
            rows: [{ id: 9, asset_kind: "pdf", filename: "brochure.pdf" }],
        };

        expect(
            resolveRowArticleAttachmentListChild(
                "app_service_catalog",
                { child_table: "app_service_catalog_media", enabled: true },
                assetsChild,
            ),
        ).toEqual(assetsChild);
    });

    test("builds a shared asset stub from attachment linking metadata when no child rows were fetched yet", () => {
        expect(
            resolveRowArticleAttachmentListChild(
                "app_service_catalog",
                { child_table: "app_service_catalog_assets", enabled: true },
                null,
            ),
        ).toEqual({
            dataset: "app_service_catalog_assets",
            column: "app_service_catalog_id",
            rows: [],
            relation_kind: "shared_asset",
        });
    });

    test("uses relation_kind + foreign_key_column from attachment status metadata for shared stubs", () => {
        expect(
            resolveRowArticleAttachmentListChild(
                "app_service_catalog",
                {
                    child_table: "app_service_catalog_media",
                    enabled: true,
                    relation_kind: "shared_asset",
                    foreign_key_column: "catalog_entry_id",
                },
                null,
            ),
        ).toEqual({
            dataset: "app_service_catalog_media",
            column: "catalog_entry_id",
            rows: [],
            relation_kind: "shared_asset",
        });
    });

    test("returns null when attachment linking is not configured and no shared child exists", () => {
        expect(resolveRowArticleAttachmentListChild("app_service_catalog", null, null)).toBeNull();
    });

    test("does not build a shared-asset stub when attachment status metadata says related_rows", () => {
        expect(
            resolveRowArticleAttachmentListChild(
                "app_service_catalog",
                {
                    child_table: "app_service_catalog_files",
                    enabled: true,
                    relation_kind: "related_rows",
                },
                null,
            ),
        ).toBeNull();
    });
});

describe("resolveRowArticleImageGalleryChild relation metadata", () => {
    test("uses relation_kind + foreign_key_column from image status metadata for shared stubs", () => {
        expect(
            resolveRowArticleImageGalleryChild(
                "app_service_catalog",
                true,
                {
                    child_table: "app_service_catalog_media",
                    enabled: true,
                    relation_kind: "shared_asset",
                    foreign_key_column: "catalog_entry_id",
                },
                null,
                null,
            ),
        ).toEqual({
            dataset: "app_service_catalog_media",
            column: "catalog_entry_id",
            rows: [],
            relation_kind: "shared_asset",
        });
    });

    test("does not force shared assets when image status metadata says image_asset", () => {
        expect(
            resolveRowArticleImageGalleryChild(
                "app_service_catalog",
                true,
                {
                    child_table: "app_service_catalog_assets",
                    enabled: true,
                    relation_kind: "image_asset",
                },
                null,
                null,
            ),
        ).toBeNull();
    });
});
