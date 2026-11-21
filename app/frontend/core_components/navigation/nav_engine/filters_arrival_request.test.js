// @vitest-environment jsdom
// filters_arrival_request.test.js
// Proves Home's open-filters request: address capture before any address write, and a one-visit lifetime.
// Connects the link's address marker, in-page tokens and filter bar claims without a running application.
// Guards that a request nobody took never opens the filters on a later, ordinary visit.

import { afterEach, beforeEach, expect, test, vi } from "vitest";

async function load(address = "/") {
    window.history.replaceState({ entry: "landing", returnId: 7 }, "", address);
    vi.resetModules();
    return import("./filters_arrival_request.js");
}

beforeEach(() => {
    vi.useRealTimers();
});

afterEach(() => {
    vi.useRealTimers();
    window.history.replaceState(null, "", "/");
});

test("a page opened from the link takes the marker off its address before anything reads it", async () => {
    const arrival = await load("/news?sort_column=__newest&open-filters=1&lang=en#top");
    expect(window.location.pathname + window.location.search + window.location.hash)
        .toBe("/news?sort_column=__newest&lang=en#top");
    // The history entry keeps its own state; only the marker left the address.
    expect(window.history.state).toEqual({ entry: "landing", returnId: 7 });
    const claim = arrival.claimFiltersArrivalRequest("app_news", segment => segment === "news" ? "app_news" : null);
    expect(claim?.isCurrent()).toBe(true);
    claim.complete();
    expect(arrival.claimFiltersArrivalRequest("app_news", () => "app_news")).toBeNull();
});

test("a marker with another value is removed without asking for the filters", async () => {
    const arrival = await load("/news?open-filters=0");
    expect(window.location.search).toBe("");
    expect(arrival.claimFiltersArrivalRequest("news")).toBeNull();
});

test("an address request belongs to the first active bar; another dataset drops it", async () => {
    const arrival = await load("/news?open-filters=1");
    expect(arrival.claimFiltersArrivalRequest("other")).toBeNull();
    expect(arrival.claimFiltersArrivalRequest("news")).toBeNull();
});

test("a cold start's request ends with its navigation when no bar took it", async () => {
    const arrival = await load("/news?open-filters=1");
    arrival.settleAddressFiltersArrivalRequest();
    expect(arrival.claimFiltersArrivalRequest("news")).toBeNull();
});

test("a claimed cold-start request survives its navigation, and a later teardown ends it", async () => {
    const arrival = await load("/news?open-filters=1");
    const claim = arrival.claimFiltersArrivalRequest("news");
    arrival.settleAddressFiltersArrivalRequest();
    expect(claim.isCurrent()).toBe(true);
    claim.release();
    expect(arrival.claimFiltersArrivalRequest("news")).toBeNull();
});

test("the link adds the marker to the Show all address", async () => {
    const arrival = await load();
    expect(arrival.withOpenFiltersRequest("/news?sort_column=__newest&sort_order=DESC&view=card"))
        .toBe("/news?sort_column=__newest&sort_order=DESC&view=card&open-filters=1");
    expect(arrival.OPEN_FILTERS_QUERY_KEY).toMatch(/-/);
});

test("an in-page request waits for its dataset and ends when its navigation settles unclaimed", async () => {
    const arrival = await load();
    const token = arrival.requestFiltersOnArrival("news");
    // Another dataset's bar does not take or drop it.
    expect(arrival.claimFiltersArrivalRequest("other")).toBeNull();
    arrival.settleFiltersArrivalRequest(token);
    expect(arrival.claimFiltersArrivalRequest("news")).toBeNull();
});

test("tokens keep an older navigation from ending a newer request", async () => {
    const arrival = await load();
    const older = arrival.requestFiltersOnArrival("news");
    const newer = arrival.requestFiltersOnArrival("news");
    arrival.cancelFiltersArrivalRequest(older);
    arrival.settleFiltersArrivalRequest(older);
    const claim = arrival.claimFiltersArrivalRequest("news");
    expect(claim?.isCurrent()).toBe(true);
    arrival.cancelFiltersArrivalRequest(newer);
    expect(claim.isCurrent()).toBe(false);
});

test("a bar torn down during its own navigation hands the request to its successor", async () => {
    const arrival = await load();
    const token = arrival.requestFiltersOnArrival("news");
    const first = arrival.claimFiltersArrivalRequest("news");
    expect(arrival.claimFiltersArrivalRequest("news")).toBeNull();
    first.release();
    const second = arrival.claimFiltersArrivalRequest("news");
    expect(second?.isCurrent()).toBe(true);
    expect(first.isCurrent()).toBe(false);
    // The first bar's late result can no longer end the successor's claim.
    first.complete();
    expect(second.isCurrent()).toBe(true);
    arrival.settleFiltersArrivalRequest(token);
    expect(second.isCurrent()).toBe(true);
    second.release();
    expect(arrival.claimFiltersArrivalRequest("news")).toBeNull();
});

test("a request nobody took expires", async () => {
    vi.useFakeTimers({ now: 1000 });
    const arrival = await load();
    arrival.requestFiltersOnArrival("news");
    vi.setSystemTime(1000 + 60001);
    expect(arrival.claimFiltersArrivalRequest("news")).toBeNull();
});

test("a later navigation before any bar took the request supersedes the one that carried it", async () => {
    const arrival = await load();
    arrival.requestFiltersOnArrival("news");
    arrival.noteNavigationStarted(); // the click's own navigation
    // The person goes Home while the dataset is still loading, then uses Show all.
    arrival.noteNavigationStarted();
    expect(arrival.claimFiltersArrivalRequest("news")).toBeNull();
});

test("a claimed request is not ended by a later navigation start; leaving ends it instead", async () => {
    const arrival = await load();
    arrival.requestFiltersOnArrival("news");
    arrival.noteNavigationStarted();
    const claim = arrival.claimFiltersArrivalRequest("news");
    arrival.noteNavigationStarted();
    expect(claim.isCurrent()).toBe(true);
});

test("a cold start's request rides on the page's first navigation only", async () => {
    const arrival = await load("/news?open-filters=1");
    arrival.noteNavigationStarted();
    arrival.noteNavigationStarted();
    expect(arrival.claimFiltersArrivalRequest("news")).toBeNull();
});
