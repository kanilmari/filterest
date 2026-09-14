// @vitest-environment jsdom
// dataset_loaded_rows.test.js
// Exercises transfer of a committed paginated list into classic article navigation.
// Uses real view state and access invalidation, without fetching or rendering rows.
// Covers query identity, raw offset, duplicate boundaries and rejected stale transfers.
import { beforeEach, expect, test, vi } from "vitest";
vi.mock("../navigation/nav_engine/query_params.js", () => ({ getParams: () => JSON.parse(localStorage.getItem("test_params") || "{}") }));
import { getUnifiedTableState, setUnifiedTableState } from "../state_stores/table_state_store.js";
import { clearDatasetAccessRegistry, primeDatasetAccessRegistry } from "../navigation/nav_engine/dataset_access_registry.js";
import { getDatasetViewContainerId } from "./dataset_view_registry.js";
import {
    rememberLoadedDatasetRows, appendLoadedDatasetRows, captureLoadedDatasetRows,
    resolveLoadedDatasetRows, filterLoadedDatasetDuplicates, clearLoadedDatasetRows,
} from "./dataset_loaded_rows.js";

function prepare(view = "card") {
    primeDatasetAccessRegistry({ datasets: [{ dataset_name: "events" }] });
    localStorage.setItem("events_view", view);
    setUnifiedTableState("events", { offset: 4, filters: { category: "travel" }, sort: { column: "id", direction: "ASC" } });
    const host = document.createElement("div");
    host.id = getDatasetViewContainerId(view, "events");
    document.body.append(host);
    rememberLoadedDatasetRows(host, "events", {
        data: [{ id: 1 }, { id: 2 }], columns: ["id"], types: { id: { card_element: "header" } },
        row_count: 8, table_meta: { name: "events" },
    }, view);
    appendLoadedDatasetRows(host, "events", [{ id: 2 }, { id: 3 }], 4);
    return host;
}
beforeEach(() => {
    localStorage.clear();
    document.body.replaceChildren();
    document.documentElement.lang = "fi";
    clearDatasetAccessRegistry();
});

test.each(["card", "table", "normal"])("reuses the entire committed %s prefix and keeps raw next offset across duplicate pages", (view) => {
    const host = prepare(view);
    expect(filterLoadedDatasetDuplicates(host, "events", [{ id: "3" }, { id: 4 }, { id: 4 }])).toEqual([{ id: 4 }]);
    const token = captureLoadedDatasetRows("events");
    expect(token).not.toBeNull();
    localStorage.setItem("events_view", "article_view");
    const entry = resolveLoadedDatasetRows("events", token);
    expect(entry).toMatchObject({ projectionView: view, offset: 4, result: {
        data: [{ id: 1 }, { id: 2 }, { id: 3 }], columns: ["id"], row_count: 8,
        types: { id: { card_element: "header" } }, table_meta: { name: "events" },
    } });
    expect(resolveLoadedDatasetRows("other", token)).toBeNull();
    expect(getUnifiedTableState("events").offset).toBe(4);
});

test.each(["filter", "sort", "language", "search", "access"])("rejects a captured prefix after %s changes", (change) => {
    prepare();
    const token = captureLoadedDatasetRows("events");
    localStorage.setItem("events_view", "article_view");
    if (change === "filter") setUnifiedTableState("events", { filters: { category: "news" } });
    if (change === "sort") setUnifiedTableState("events", { sort: { column: "id", direction: "DESC" } });
    if (change === "language") document.documentElement.lang = "en";
    if (change === "search") localStorage.setItem("test_params", JSON.stringify({ search: "query" }));
    if (change === "access") clearDatasetAccessRegistry();
    expect(resolveLoadedDatasetRows("events", token)).toBeNull();
});

test.each(["detached", "hidden", "display", "offset", "cleared", "search"])("does not transfer an uncommitted or unavailable list: %s", (change) => {
    const host = prepare();
    if (change === "detached") host.remove();
    if (change === "hidden") host.hidden = true;
    if (change === "display") host.style.display = "none";
    if (change === "offset") setUnifiedTableState("events", { offset: 5 });
    if (change === "cleared") clearLoadedDatasetRows(host);
    if (change === "search") localStorage.setItem("test_params", JSON.stringify({ search: "pending" }));
    expect(captureLoadedDatasetRows("events")).toBeNull();
});

test.each([true, false])("initial pending access keeps a fresh rendered prefix only after an allowed snapshot (%s)", async allowed => {
    vi.resetModules();
    const access = await import("../navigation/nav_engine/dataset_access_registry.js");
    const loaded = await import("./dataset_loaded_rows.js");
    localStorage.setItem("events_view", "card");
    setUnifiedTableState("events", { offset: 1 });
    document.body.innerHTML = '<div id="events_card_view_container"></div>';
    loaded.rememberLoadedDatasetRows(document.querySelector("div"), "events", { data: [{ id: 1 }] }, "card");
    expect(loaded.captureLoadedDatasetRows("events")).toBeNull();
    access.primeDatasetAccessRegistry({ datasets: [{ dataset_name: "events", can_read_rows: allowed }] });
    const token = loaded.captureLoadedDatasetRows("events");
    if (!allowed) { expect(token).toBeNull(); return; }
    expect(token).not.toBeNull();
    localStorage.setItem("events_view", "article_view");
    expect(loaded.resolveLoadedDatasetRows("events", token)?.result.data).toEqual([{ id: 1 }]);
    access.clearDatasetAccessRegistry();
    access.primeDatasetAccessRegistry({ datasets: [{ dataset_name: "events" }] });
    expect(loaded.resolveLoadedDatasetRows("events", token)).toBeNull();
    localStorage.setItem("events_view", "card");
    expect(loaded.captureLoadedDatasetRows("events")).toBeNull();
});

test("a completed access refresh keeps only newly rendered rows, never its old token", async () => {
    vi.resetModules();
    const access = await import("../navigation/nav_engine/dataset_access_registry.js");
    const loaded = await import("./dataset_loaded_rows.js");
    access.primeDatasetAccessRegistry({ datasets: [{ dataset_name: "events" }] });
    localStorage.setItem("events_view", "card");
    setUnifiedTableState("events", { offset: 1 });
    document.body.innerHTML = '<div id="events_card_view_container"></div>';
    const host = document.querySelector("div");
    loaded.rememberLoadedDatasetRows(host, "events", { data: [{ id: 1 }] }, "card");
    const oldToken = loaded.captureLoadedDatasetRows("events");
    const generation = access.beginDatasetAccessRefresh();
    expect(loaded.captureLoadedDatasetRows("events")).toBeNull();
    loaded.rememberLoadedDatasetRows(host, "events", { data: [{ id: 2 }] }, "card");
    access.primeDatasetAccessRegistry({ datasets: [{ dataset_name: "events" }] }, generation);
    const freshToken = loaded.captureLoadedDatasetRows("events");
    expect(freshToken).not.toBeNull();
    localStorage.setItem("events_view", "article_view");
    expect(loaded.resolveLoadedDatasetRows("events", oldToken)).toBeNull();
    expect(loaded.resolveLoadedDatasetRows("events", freshToken)?.result.data).toEqual([{ id: 2 }]);
});
