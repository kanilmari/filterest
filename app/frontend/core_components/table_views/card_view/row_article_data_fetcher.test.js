// row_article_data_fetcher.test.js
// Verifies that expanded articles use a fresh permission-filtered row projection.
// Connects authorized row results, UID appearance and article cancellation.
// Exists so small-card field choices cannot remove article-only content or revive private state.
import { datasetAppearanceState } from '../dataset_appearance_state.js';
import { DEFAULT_DATASET_APPEARANCE } from '../../../shared/dataset_appearance/validator.js';
import { setAllSpecs } from '../../state_stores/table_specs_reader.js';

test.each(['ownership', 'mismatched snapshot'])('article row fetch discards %s before building another owner', async reason => {
    datasetAppearanceState.clear(); setAllSpecs({ private_article: { table_uid: 91 } });
    const snapshot = { dataset_uid: 91, schema_version: 1, effective: DEFAULT_DATASET_APPEARANCE,
        overrides: {}, version: '1' };
    datasetAppearanceState.accept('private_article', snapshot);
    let complete;
    const pending = fetchPermittedRowArticleData({ tableName: 'private_article', rowItem: { id: 7 },
        requestRows: () => new Promise(resolve => { complete = resolve; }) });
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    if (reason === 'ownership') setAllSpecs({ private_article: { table_uid: 22 }, renamed: { table_uid: 91 } });
    complete({ data: [{ id: 7 }], dataset_appearance: { ...snapshot, dataset_uid: reason === 'ownership' ? 91 : 22 } });
    await rejected; setAllSpecs({}); datasetAppearanceState.clear();
});
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

test("carries fresh article roles and languages independently of the source list projection", async () => {
    const types = { description: { card_element: "description", is_multilingual: true } };
    const row = await fetchPermittedRowArticleData({
        tableName: "travel_info",
        rowItem: { id: 7, title: "Preview" },
        requestRows: async () => ({
            columns: ["description"], types,
            data: [{ id: 7, description: '{"fi":"Artikkeli","en":"Article"}' }],
        }),
    });
    expect(row.__articleTypes).toBe(types);
    expect(row.__articleColumns).toEqual(["description"]);
    expect(Object.keys(row)).toEqual(["id", "description"]);
    expect(JSON.stringify(row)).not.toContain("__articleTypes");
});


test.each(['caller cancellation', 'dataset deletion', 'sign-out'])('does not install a late article appearance after %s', async reason => {
    datasetAppearanceState.clear();
    let resolve;
    let current = true;
    const pending = fetchPermittedRowArticleData({ tableName: 'private_article', rowItem: { id: 7 },
        isCurrent: () => current, requestRows: () => new Promise(done => { resolve = done; }) });
    if (reason === 'caller cancellation') current = false;
    else if (reason === 'dataset deletion') datasetAppearanceState.forget('private_article');
    else datasetAppearanceState.clear();
    resolve({ data: [{ id: 7 }], dataset_appearance: { dataset_uid: 91, schema_version: 1,
        effective: DEFAULT_DATASET_APPEARANCE, overrides: {}, version: '1' } });
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    const surface = document.createElement('section'); datasetAppearanceState.bind(surface, 'private_article');
    expect(surface.dataset.datasetAppearanceUid).toBeUndefined();
});
