// @vitest-environment jsdom
// dataset_listing_filters.test.js
// Verifies the one statement of the conditions a dataset's listing is asked with.
// Uses the real query-parameter store, without fetching or rendering rows.
// Exists because the first page, the later pages and the remembered row list
// must all describe the same matches, so no reader may restate them.
import { beforeEach, expect, test, vi } from "vitest";

beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
});

test("the listing's conditions are the selected filters plus a committed search", async () => {
    // The query-parameter store reads committed searches when it loads.
    localStorage.setItem("dataset_query_params", JSON.stringify({ searched_orders: { search: "  api " } }));
    const { getDatasetListingFilters } = await import("./dataset_listing_filters.js");
    const selected = { status: "open" };

    expect(getDatasetListingFilters("browsed_orders", selected)).toEqual({ status: "open" });
    expect(getDatasetListingFilters("searched_orders", selected)).toEqual({ status: "open", search: "api" });
    expect(getDatasetListingFilters("searched_orders", undefined)).toEqual({ search: "api" });
    expect(selected).toEqual({ status: "open" });
});

test("listing/page signatures include modes, ordinary filters and sort, but not the page language", async () => {
    const { getDatasetListingSignature } = await import("./dataset_listing_filters.js");
    document.documentElement.lang = "fi";
    const filters = { row_group: "boat,train", row_group_mode: "1:all", status: "open" };
    const signature = getDatasetListingSignature("offers", filters, { column: "id", direction: "ASC" });
    expect(signature).toBe(getDatasetListingSignature("offers", { status: "open", row_group_mode: "1:all", row_group: "boat,train" }, { column: "id", direction: "ASC" }));
    expect(signature).not.toBe(getDatasetListingSignature("offers", { ...filters, row_group_mode: "" }, { column: "id", direction: "ASC" }));
    expect(signature).not.toBe(getDatasetListingSignature("offers", filters, { column: "id", direction: "DESC" }));
    // The first load sets <html lang> while its first request is in flight; that answer still belongs to the view.
    document.documentElement.lang = "en";
    expect(signature).toBe(getDatasetListingSignature("offers", filters, { column: "id", direction: "ASC" }));
});
