// dataset_access_registry.test.js
// Verifies latest-response ownership and authorization reset invalidation.
// Exercises the shared snapshot used by both startup and main tabs.
import { beforeEach, expect, test, vi } from "vitest";
import {
    beginDatasetAccessRefresh, clearDatasetAccessRegistry, primeDatasetAccessRegistry,
    canReadDatasetFromRegistry, getDatasetAccessResponseGeneration, subscribeDatasetAccessRegistry,
    resolveDataset, refreshDatasetCatalogue,
} from "./dataset_access_registry.js";
import { invalidateSessionGeneration } from '../../auth/session_generation_store.js';
const endpoint = vi.hoisted(() => vi.fn());
vi.mock('../../endpoints/endpoint_router.js', () => ({ endpoint_router: endpoint }));
beforeEach(clearDatasetAccessRegistry);
test('a session identity change clears readable names before optional login sync', () => {
    primeDatasetAccessRegistry({ datasets: [{ table_uid: 11, dataset_name: 'private_data', names: ['private-alias'] }] });
    invalidateSessionGeneration({ reason: 'login', revalidate: false });
    expect(resolveDataset({ name: 'private-alias' })).toEqual({ status: 'not_ready' });
});
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

test('all pool names and the stable uid resolve to the same frozen identity', () => {
    expect(resolveDataset({ name: 'orders' })).toEqual({ status: 'not_ready' });
    primeDatasetAccessRegistry({ datasets: [{ id: 900, table_uid: 11, dataset_name: 'app_orders',
        names: ['app_orders', 'orders', 'old-orders'], preferred_name: 'orders', can_read_rows: true }] });
    const found = resolveDataset({ uid: 11 });
    for (const name of ['app_orders', 'orders', 'old-orders']) {
        expect(resolveDataset({ name }).dataset).toBe(found.dataset);
        expect(canReadDatasetFromRegistry(name)).toBe(true);
    }
    expect(Object.isFrozen(found.dataset)).toBe(true);
    expect(Object.isFrozen(found.dataset.names)).toBe(true);
    expect(resolveDataset({ uid: 900 })).toEqual({ status: 'unknown' });
    expect(resolveDataset({ name: 'orders', uid: 900 })).toEqual({ status: 'unknown' });
});

test('empty lists and permission resets remove both indexes and all aliases', () => {
    const response = { datasets: [{ table_uid: 11, dataset_name: 'app_orders', names: ['orders'] }] };
    primeDatasetAccessRegistry(response);
    primeDatasetAccessRegistry({ datasets: [] });
    expect(resolveDataset({ uid: 11 })).toEqual({ status: 'unknown' });
    expect(resolveDataset({ name: 'orders' })).toEqual({ status: 'unknown' });
    clearDatasetAccessRegistry();
    expect(resolveDataset({ uid: 11 })).toEqual({ status: 'not_ready' });
});

test('logout rejects an older catalogue request even after a new principal loads', async () => {
    let answer;
    endpoint.mockImplementationOnce(() => new Promise(resolve => { answer = resolve; }));
    const pending = refreshDatasetCatalogue();
    clearDatasetAccessRegistry();
    primeDatasetAccessRegistry({ datasets: [{ table_uid: 22, dataset_name: 'guest_data' }] });
    answer({ datasets: [{ table_uid: 11, dataset_name: 'private_data' }] });
    await pending;
    expect(resolveDataset({ uid: 11 })).toEqual({ status: 'unknown' });
    expect(resolveDataset({ uid: 22 }).status).toBe('found');
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

test('page return refreshes a live catalogue but cold startup makes no request', async () => {
    endpoint.mockReset();
    const returnEvent = () => {
        const event = new Event('pageshow');
        Object.defineProperty(event, 'persisted', { value: true });
        window.dispatchEvent(event);
    };
    returnEvent();
    expect(endpoint).not.toHaveBeenCalled();
    primeDatasetAccessRegistry({ datasets: [{ table_uid: 11, dataset_name: 'before' }] });
    endpoint.mockResolvedValueOnce({ datasets: [{ table_uid: 22, dataset_name: 'after' }] });
    returnEvent();
    await vi.waitFor(() => expect(resolveDataset({ uid: 22 }).status).toBe('found'));
    expect(resolveDataset({ uid: 11 })).toEqual({ status: 'unknown' });
    expect(endpoint).toHaveBeenCalledTimes(1);
});
