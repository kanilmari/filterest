// translation_helper_view.test.js
// Verifies translation repair reads the selected dataset's table projection.
// Connects the admin dataset picker and text-column metadata to authorized rows.
// Keeps the existing repair field selection independent of picture support.
import { beforeEach, expect, test, vi } from "vitest";
const { requestRows, requestColumns, endpoint } = vi.hoisted(() => ({
    requestRows: vi.fn(), requestColumns: vi.fn(), endpoint: vi.fn(),
}));
vi.mock("../core_components/endpoints/endpoint_data_fetcher.js", () => ({ fetchDatasetData: requestRows }));
vi.mock("../core_components/endpoints/endpoint_column_fetcher.js", () => ({ fetch_columns_for_table: requestColumns }));
vi.mock("../core_components/endpoints/endpoint_router.js", () => ({ endpoint_router: endpoint }));
vi.mock("../core_components/route_permission_checker.js", () => ({ applyPermission: vi.fn() }));
import { generate_translation_helper_view } from "./translation_helper_view.js";

beforeEach(() => { vi.clearAllMocks(); document.body.replaceChildren(); });

test("the selected dataset uses the table projection and keeps its text columns", async () => {
    endpoint.mockResolvedValue(["examples"]);
    requestColumns.mockResolvedValue([{ column_name: "title", data_type: "text" },
        { column_name: "cached_image", data_type: "text" }]);
    requestRows.mockResolvedValue({ data: [{ id: 7, title: "Example" }] });
    const container = document.createElement("section"); document.body.append(container);
    await generate_translation_helper_view(container);
    const picker = container.querySelector("select");
    picker.value = "examples"; picker.dispatchEvent(new Event("change"));
    await vi.waitFor(() => expect(container.querySelector("table")).not.toBeNull());
    expect(requestRows).toHaveBeenCalledWith({ dataset_name: "examples", view_key: "table" });
    expect([...container.querySelectorAll("th")].map(th => th.textContent)).toEqual(["Fix", "id", "title"]);
});
