/* @vitest-environment jsdom */

import { describe, expect, test } from "vitest";
import {
    filterRowArticleNonMediaChildTables,
    isMediaChildTable,
    isImageAssetChildTable,
    isSharedAssetChildTable,
    resolveRowArticleAttachmentListChild,
    resolveRowArticleDisplayedImageRows,
    resolveRowArticleImageGalleryChild,
    resolveRowArticleParentImageRows,
    resolveRowArticleSharedAssetChild,
} from "./row_article_asset_resolver.js";

describe("resolveRowArticleParentImageRows", () => {
    test("converts every populated parent image-role value into a gallery row in column order", () => {
        const rows = resolveRowArticleParentImageRows(
            {
                cached_image: " 10_2_1.webp ",
                secondary_image: "10_2_2.webp",
                empty_image: "",
                title: "Ticket",
            },
            ["cached_image", "secondary_image", "empty_image"],
        );

        // No artificial primary: the server's card picture rule alone decides the card picture.
        expect(rows).toEqual([
            {
                asset_kind: "image",
                filename: "10_2_1.webp",
                is_parent_row_image: true,
                parent_image_column: "cached_image",
            },
            {
                asset_kind: "image",
                filename: "10_2_2.webp",
                is_parent_row_image: true,
                parent_image_column: "secondary_image",
            },
        ]);
    });
});

describe("resolveRowArticleImageGalleryChild", () => {
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
        rows: [{ id: 1, asset_kind: "image", filename: "canonical.png" }],
    };

    test("uses the child_tables entry the response names, whatever the other children hold", () => {
        expect(resolveRowArticleImageGalleryChild({
            gallery_relation: { dataset: "app_service_catalog_gallery", column: "app_service_catalog_id" },
            child_tables: [assetsChild, imagesChild],
        })).toBe(imagesChild);
    });

    test("matches the named dataset and column together", () => {
        const ownerPictures = { dataset: "people_assets", column: "owner_id", rows: [] };
        const subjectPictures = { dataset: "people_assets", column: "subject_id", rows: [] };

        expect(resolveRowArticleImageGalleryChild({
            gallery_relation: { dataset: "people_assets", column: "subject_id" },
            child_tables: [ownerPictures, subjectPictures],
        })).toBe(subjectPictures);
    });

    test("returns null rather than another relation when the response lists no entry for the named gallery", () => {
        expect(resolveRowArticleImageGalleryChild({
            gallery_relation: { dataset: "app_service_catalog_media", column: "app_service_catalog_id" },
            child_tables: [assetsChild, imagesChild],
        })).toBeNull();
    });

    // The server leaves out the name of a gallery this viewer may not read, so a
    // response without one has no gallery, even when its children hold pictures.
    test.each([
        ["names no gallery", { child_tables: [assetsChild, imagesChild] }],
        ["names a gallery without a dataset", {
            gallery_relation: { dataset: "", column: "app_service_catalog_id" },
            child_tables: [imagesChild],
        }],
        ["is missing", null],
    ])("finds no gallery when the response %s", (_label, response) => {
        expect(resolveRowArticleImageGalleryChild(response)).toBeNull();
    });
});

describe("resolveRowArticleDisplayedImageRows", () => {
    const relation = { dataset: "tickets_assets", column: "tickets_id" };
    const second = { id: 2, asset_kind: "image", filename: "second.png", sort_order: 9 };
    const first = { id: 1, asset_kind: "image", filename: "first.png", is_primary: true };
    const staleRowImage = {
        asset_kind: "image",
        filename: "deleted.png",
        is_parent_row_image: true,
        parent_image_column: "cached_image",
    };
    const displayed = (response, rowImageRows) => resolveRowArticleDisplayedImageRows(
        response,
        resolveRowArticleImageGalleryChild(response),
        rowImageRows,
    );

    test("shows the named gallery in the server's order, a card-only picture first, never the row fields", () => {
        const gallery = { ...relation, relation_kind: "shared_asset", rows: [second, first] };
        const response = { gallery_relation: relation, card_picture: "https://cdn.example/card.png", child_tables: [gallery] };

        expect(displayed(response, [staleRowImage])).toEqual([
            { asset_kind: "image", filename: "https://cdn.example/card.png", is_card_only_picture: true },
            second,
            first,
        ]);
    });

    test("does not bring back a deleted picture from the row fields once the response carries the gallery", () => {
        const response = { gallery_relation: relation, card_picture: "", child_tables: [{ ...relation, rows: [] }] };

        expect(displayed(response, [staleRowImage])).toEqual([]);
    });

    test("without a gallery shows only the picture the card shows, never the row fields", () => {
        const logo = { asset_kind: "image", filename: "logo.png", is_parent_row_image: true, parent_image_column: "logo_image" };
        const hero = { asset_kind: "image", filename: "hero.png", is_parent_row_image: true, parent_image_column: "hero_image" };

        expect(displayed({ child_tables: [], card_picture: "hero.png" }, [logo, hero]))
            .toEqual([{ asset_kind: "image", filename: "hero.png", is_card_only_picture: true }]);
    });

    test.each([
        ["an empty card picture", { child_tables: [], card_picture: "" }],
        ["no card picture", { child_tables: [] }],
    ])("without a gallery and with %s shows nothing, not the row fields", (_label, response) => {
        expect(displayed(response, [staleRowImage])).toEqual([]);
    });

    test("shows only the card picture for a gallery this viewer may not read, whose name the server leaves out", () => {
        // Real server answer: neither the blocked gallery's name nor its rows, only the card picture.
        const response = { card_picture: "10_2_1.webp", child_tables: [] };

        expect(displayed(response, [staleRowImage])).toEqual([
            { asset_kind: "image", filename: "10_2_1.webp", is_card_only_picture: true },
        ]);
    });

    test("lets the row fields stand in only when there is no response at all", () => {
        const duplicate = { ...staleRowImage, filename: "/storage/deleted.png" };

        expect(resolveRowArticleDisplayedImageRows(null, null, [staleRowImage, duplicate])).toEqual([staleRowImage]);
        expect(resolveRowArticleDisplayedImageRows(null, null)).toEqual([]);
    });
});

describe("resolveRowArticleSharedAssetChild", () => {
    test("picks the first shared-asset child of the response for the attachment list", () => {
        const childTables = [
            { dataset: "app_service_catalog_comments", column: "app_service_catalog_id", rows: [] },
            { dataset: "app_service_catalog_gallery", column: "app_service_catalog_id", relation_kind: "image_asset", rows: [] },
            { dataset: "app_service_catalog_assets", column: "app_service_catalog_id", relation_kind: "shared_asset", rows: [] },
        ];

        expect(resolveRowArticleSharedAssetChild(childTables)).toBe(childTables[2]);
        expect(resolveRowArticleSharedAssetChild(childTables.slice(0, 2))).toBeNull();
        expect(resolveRowArticleSharedAssetChild(undefined)).toBeNull();
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
