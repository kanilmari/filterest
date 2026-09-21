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
