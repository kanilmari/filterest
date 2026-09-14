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
