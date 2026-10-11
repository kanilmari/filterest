// permission_checker.test.js
// Verifies permission-editor reads preserve their table projection on every page.
// Connects the admin data reader to mocked authorized listing responses.
// Keeps rich row support decisions out of this nonvisual row consumer.
import { beforeEach, expect, test, vi } from "vitest";
const requestRows = vi.hoisted(() => vi.fn());
vi.mock("../endpoints/endpoint_data_fetcher.js", () => ({ fetchDatasetData: requestRows }));
import { fetch_all_functions, fetch_user_groups } from "./permission_checker.js";

beforeEach(() => requestRows.mockReset());

test.each([
    ["system_functions", fetch_all_functions, { disabled: false }],
    ["system_user_groups", fetch_user_groups, undefined],
])("permission editor pages %s with an explicit table projection", async (dataset, read, filters) => {
    requestRows.mockResolvedValueOnce({ data: [{ id: 1, name: "One" }], resultsPerLoad: 1 })
        .mockResolvedValueOnce({ data: [{ id: 2, name: "Two" }], resultsPerLoad: 1 })
        .mockResolvedValueOnce({ data: [] });
    expect((await read()).map(row => row.id)).toEqual([1, 2]);
    expect(requestRows.mock.calls.map(([request]) => request)).toEqual([0, 1, 2].map(offset => ({
        dataset_name: dataset, offset, view_key: "table", ...(filters ? { filters } : {}),
    })));
});
