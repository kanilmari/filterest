// row_article_data_fetcher.test.js
// Verifies that expanded articles use a fresh permission-filtered row projection.
// Exists so small-card field choices cannot silently remove article-only content.
import { expect, test, vi } from "vitest";

import {
    fetchPermittedRowArticleData,
    ROW_ARTICLE_VIEW_KEY,
} from "./row_article_data_fetcher.js";

test("fetches the requested row through the independent article projection", async () => {
    const requestRows = vi.fn(async () => ({
        data: [{ id: 7, title: "Trip", description: "Full article description" }],
    }));

    const row = await fetchPermittedRowArticleData({
        tableName: "travel_info",
        rowItem: { id: 7, title: "Trip" },
        requestRows,
    });

    expect(requestRows).toHaveBeenCalledWith({
        dataset_name: "travel_info",
        filters: { id: 7 },
        view_key: ROW_ARTICLE_VIEW_KEY,
        callerName: "openRowArticleView",
    });
    expect(row.description).toBe("Full article description");
});

test("keeps repaired column metadata articles distinct by generic row id", async () => {
    const rowsByID = new Map([
        [473, { id: 473, column_uid: 473, column_name: "description" }],
        [526, { id: 526, column_uid: 526, column_name: "keywords" }],
    ]);
    const requestRows = vi.fn(async ({ filters }) => ({
        data: [rowsByID.get(filters.id)],
    }));

    const description = await fetchPermittedRowArticleData({
        tableName: "system_column_details",
        rowItem: rowsByID.get(473),
        requestRows,
    });
    const keywords = await fetchPermittedRowArticleData({
        tableName: "system_column_details",
        rowItem: rowsByID.get(526),
        requestRows,
    });

    expect(description).toEqual({
        id: 473,
        column_uid: 473,
        column_name: "description",
    });
    expect(keywords).toEqual({
        id: 526,
        column_uid: 526,
        column_name: "keywords",
    });
    expect(requestRows).toHaveBeenNthCalledWith(1, expect.objectContaining({
        filters: { id: 473 },
    }));
    expect(requestRows).toHaveBeenNthCalledWith(2, expect.objectContaining({
        filters: { id: 526 },
    }));
});

test("does not reuse the card snapshot when the authorized row is missing", async () => {
    await expect(fetchPermittedRowArticleData({
        tableName: "travel_info",
        rowItem: { id: 7, title: "Stale card" },
        requestRows: vi.fn(async () => ({ data: [] })),
    })).rejects.toThrow("row article is no longer available");
});

test("keeps a local preview that has no stable row identifier", async () => {
    const requestRows = vi.fn();
    const preview = { title: "Unsaved preview", description: "Draft" };

    await expect(fetchPermittedRowArticleData({
        tableName: "travel_info",
        rowItem: preview,
        requestRows,
    })).resolves.toBe(preview);
    expect(requestRows).not.toHaveBeenCalled();
});


test("keeps article field-set order and never fills hidden fields from an old card", async () => {
    const row = await fetchPermittedRowArticleData({
        tableName: "travel_info",
        rowItem: { id: 7, title: "Old", hidden: "Old hidden value" },
        requestRows: async () => ({
            columns: ["description", "title"],
            data: [{ id: 7, title: "New", description: "Body" }],
        }),
    });
    expect(row.__articleColumns).toEqual(["description", "title"]);
    expect(row.hidden).toBeUndefined();
    expect(Object.keys(row)).not.toContain("__articleColumns");
    expect(ROW_ARTICLE_VIEW_KEY).toBe("article_view");
});
