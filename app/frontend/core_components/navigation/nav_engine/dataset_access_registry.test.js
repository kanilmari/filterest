// dataset_access_registry.test.js
// Verifies latest-response ownership and authorization reset invalidation.
// Exercises the shared snapshot used by both startup and main tabs.
import { beforeEach, expect, test } from "vitest";
import {
    beginDatasetAccessRefresh, clearDatasetAccessRegistry, primeDatasetAccessRegistry,
    canReadDatasetFromRegistry, getDatasetAccessResponseGeneration, subscribeDatasetAccessRegistry,
} from "./dataset_access_registry.js";
beforeEach(clearDatasetAccessRegistry);
test("an older startup response cannot replace the latest permitted datasets", () => {
    const old = beginDatasetAccessRefresh();
    const current = beginDatasetAccessRefresh();
    const response = { datasets: [{ dataset_name: "new" }, { dataset_name: "denied", can_read_rows: false }] };
    expect(primeDatasetAccessRegistry(response, current)).toBe(true);
    expect(primeDatasetAccessRegistry({ datasets: [{ dataset_name: "old" }] }, old)).toBe(false);
    expect(canReadDatasetFromRegistry("new")).toBe(true);
    expect(canReadDatasetFromRegistry("denied")).toBe(false);
    expect(canReadDatasetFromRegistry("old")).toBe(false);
    expect(getDatasetAccessResponseGeneration(response)).toBe(current);
});
test("logout invalidates an in-flight response and notifies subscribers", () => {
    const events = [];
    const unsubscribe = subscribeDatasetAccessRegistry(() => events.push(canReadDatasetFromRegistry("old")));
    const pending = beginDatasetAccessRefresh();
    clearDatasetAccessRegistry();
    expect(primeDatasetAccessRegistry({ datasets: [{ dataset_name: "old" }] }, pending)).toBe(false);
    expect(canReadDatasetFromRegistry("old")).toBeNull();
    unsubscribe();
    const count = events.length;
    clearDatasetAccessRegistry();
    expect(events).toHaveLength(count);
});
