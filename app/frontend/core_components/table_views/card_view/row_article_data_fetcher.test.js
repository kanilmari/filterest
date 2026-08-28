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
