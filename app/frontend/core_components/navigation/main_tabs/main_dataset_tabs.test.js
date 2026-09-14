// main_dataset_tabs.test.js
// Verifies the existing ordered main-tab model as one metadata-backed dataset projection.
// Covers legacy ordering, auth exclusions and old response rejection without a second registry.
import { beforeEach, expect, test, vi } from "vitest";
const endpoint = vi.hoisted(() => vi.fn());
vi.mock("../../endpoints/endpoint_router.js", () => ({ endpoint_router: endpoint }));
import { fetchProjectTabs, acceptMainDatasetTabs, getMainDatasetTabs, subscribeMainDatasetTabs } from "./main_dataset_tabs.js";
import { clearDatasetAccessRegistry, canReadDatasetFromRegistry } from "../nav_engine/dataset_access_registry.js";
beforeEach(() => { clearDatasetAccessRegistry(); endpoint.mockReset(); });
const response = {
    datasets: [
        { dataset_name: "alpha", is_main_table: true, is_top_level_in_current_project: true },
        { dataset_name: "beta", is_top_level_in_current_project: true },
        { dataset_name: "child", is_top_level_in_current_project: false },
        { dataset_name: "denied", is_top_level_in_current_project: true, can_read_rows: false },
        { dataset_name: "system_users" }, { dataset_name: "system_about" },
    ],
    tab_order: [{ dataset_name: "beta", sort_order: 0 }, { dataset_name: "alpha", sort_order: 1 }],
};
test("uses the original order, Users and About exceptions, and readable metadata only", async () => {
    endpoint.mockResolvedValue(response);
    const fetched = await fetchProjectTabs();
    expect(acceptMainDatasetTabs(fetched, true)).toBe(true);
    const tabs = getMainDatasetTabs();
    expect(tabs.map(t => t.dataset)).toEqual(["beta", "alpha", "system_users", "system_about"]);
    expect(Object.isFrozen(tabs)).toBe(true);
    expect(tabs.every(Object.isFrozen)).toBe(true);
    expect(canReadDatasetFromRegistry("denied")).toBe(false);
});
test("guest snapshot excludes user-only dataset tabs; failed fetch adds no static targets", async () => {
    endpoint.mockResolvedValueOnce(response).mockRejectedValueOnce(new Error("403"));
    acceptMainDatasetTabs(await fetchProjectTabs(), false);
    expect(getMainDatasetTabs().map(t => t.dataset)).toEqual(["beta", "alpha"]);
    acceptMainDatasetTabs(await fetchProjectTabs(), false);
    expect(getMainDatasetTabs()).toEqual([]);
});
test("latest response and logout guard both the projection and access registry", async () => {
    let finishOld;
    endpoint.mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; }));
    const oldPromise = fetchProjectTabs();
    endpoint.mockResolvedValueOnce({ datasets: [{ dataset_name: "new", is_top_level_in_current_project: true }] });
    acceptMainDatasetTabs(await fetchProjectTabs(), true);
    finishOld(response);
    expect(acceptMainDatasetTabs(await oldPromise, true)).toBe(false);
    expect(getMainDatasetTabs().map(t => t.dataset)).toEqual(["new"]);
    expect(canReadDatasetFromRegistry("alpha")).toBe(false);
    const listener = vi.fn();
    const unsubscribe = subscribeMainDatasetTabs(listener);
    clearDatasetAccessRegistry();
    expect(getMainDatasetTabs()).toEqual([]);
    expect(listener).toHaveBeenLastCalledWith([]);
    unsubscribe();
});
