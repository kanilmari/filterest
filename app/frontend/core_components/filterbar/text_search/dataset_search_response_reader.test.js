// dataset_search_response_reader.test.js
// Verifies incremental decoding and cancellation at the search response boundary.
// Connects mocked endpoint streams to the same async iterator used by both search phases.
// Prevents stale or split packets from corrupting the active query's result set.
// @vitest-environment jsdom
import { expect, test, vi } from "vitest";
const endpoint = vi.hoisted(() => vi.fn());
vi.mock("../../endpoints/endpoint_router.js", () => ({ endpoint_router: endpoint }));
vi.mock("../filter_list/row_group_facet_printer.js", () => ({ ROW_GROUP_FILTER_KEY: "row_group" }));
import { readDatasetSearchResponse } from "./dataset_search_response_reader.js";
import { datasetAppearanceState } from '../../table_views/dataset_appearance_state.js';
import { setAllSpecs } from '../../state_stores/table_specs_reader.js';
import { invalidateSessionGeneration } from '../../auth/session_generation_store.js';

test.each(['sign-out', 'deletion', 'ownership'])('late stream headers and packets are discarded after %s', async reason => {
    datasetAppearanceState.clear(); setAllSpecs({ tasks: { table_uid: 11 } });
    let complete;
    endpoint.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    const iterator = readDatasetSearchResponse('tasks', 'private', {}, () => true);
    const pending = iterator.next();
    if (reason === 'sign-out') invalidateSessionGeneration({ reason: 'logout' });
    else if (reason === 'deletion') datasetAppearanceState.forget('tasks');
    else setAllSpecs({ tasks: { table_uid: 22 }, renamed: { table_uid: 11 } });
    const cancel = vi.fn();
    complete({ body: new ReadableStream({ start(controller) {
        controller.enqueue(new TextEncoder().encode('{"stage":"ai","data":[{"id":1}]}\n'));
    }, cancel }) });
    expect(await pending).toMatchObject({ done: true });
    expect(cancel).toHaveBeenCalledOnce();
    setAllSpecs({});
});

test("decodes split UTF-8 and the final packet without a newline", async () => {
    const bytes = new TextEncoder().encode('{"stage":"text","data":[{"title":"Hyvää"}]}');
    endpoint.mockResolvedValueOnce({ body: new ReadableStream({
        start(controller) {
            controller.enqueue(bytes.slice(0, 37)); controller.enqueue(bytes.slice(37)); controller.close();
        },
    }) });
    const packets = [];
    for await (const packet of readDatasetSearchResponse("tasks", "Hyvää", {}, () => true)) packets.push(packet);
    expect(packets).toEqual([{ stage: "text", data: [{ title: "Hyvää" }] }]);
});

test("cancels an obsolete response before reading any row", async () => {
    const cancel = vi.fn();
    endpoint.mockResolvedValueOnce({ body: { getReader: () => ({ cancel, read: vi.fn(), releaseLock: vi.fn() }) } });
    const packets = [];
    for await (const packet of readDatasetSearchResponse("tasks", "old", {}, () => false)) packets.push(packet);
    expect(packets).toEqual([]);
    expect(cancel).toHaveBeenCalledOnce();
});


test("aborts pending response headers through the existing endpoint pipeline", async () => {
    const controller = new AbortController();
    endpoint.mockImplementationOnce((_route, options) => new Promise((_resolve, reject) => {
        options.signal.addEventListener("abort", () => reject(new DOMException("Cancelled", "AbortError")));
    }));
    const iterator = readDatasetSearchResponse("other", "query", {
        signal: controller.signal, suppressAuthRedirect: true, suppressErrorToast: true,
    }, () => true);
    const pending = iterator.next();
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(endpoint.mock.calls.at(-1)[1]).toMatchObject({
        signal: controller.signal, suppressAuthRedirect: true, suppressErrorToast: true,
    });
});
test("cancels a pending stream read immediately and ignores later chunks", async () => {
    const controller = new AbortController();
    const cancel = vi.fn();
    endpoint.mockResolvedValueOnce({ body: new ReadableStream({ cancel }) });
    const iterator = readDatasetSearchResponse("other", "query", { signal: controller.signal }, () => true);
    const pending = iterator.next();
    await Promise.resolve(); await Promise.resolve();
    controller.abort();
    await expect(pending).resolves.toMatchObject({ done: true });
    expect(cancel).toHaveBeenCalledOnce();
});

test("sends the interface language as the reader's language", async () => {
    localStorage.setItem("chosen_language", "fi");
    try {
        endpoint.mockResolvedValueOnce({ body: new ReadableStream({ start(controller) { controller.close(); } }) });
        for await (const packet of readDatasetSearchResponse("app_service_catalog", "auto", {}, () => true)) void packet;
        const { url_params } = endpoint.mock.calls.at(-1)[1];
        expect(new URLSearchParams(url_params).get("lang")).toBe("fi");
        expect(new URLSearchParams(url_params).get("query")).toBe("auto");
    } finally {
        localStorage.removeItem("chosen_language");
    }
});

test("transports modes beside category slugs and outside ordinary filters", async () => {
    endpoint.mockResolvedValueOnce({ body: new ReadableStream({ start(controller) { controller.close(); } }) });
    for await (const _packet of readDatasetSearchResponse("offers", "trip", {
        rowGroupSlug: "boat,train", rowGroupMode: "0:all,12:all", filters: { status: "open" },
    }, () => true)) { /* empty stream */ }
    const params = new URLSearchParams(endpoint.mock.calls.at(-1)[1].url_params);
    expect(params.get("row_group")).toBe("boat,train");
    expect(params.get("row_group_mode")).toBe("0:all,12:all");
    expect(JSON.parse(params.get("filters"))).toEqual({ status: "open" });
});
