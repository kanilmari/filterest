// filters_arrival_request.js
// Carries one "open the filters when this dataset arrives" request to that dataset's filter bar.
// Bridges Home's "Filter results" link (an in-page click, or a page opened from its address) and the bar.
// Never becomes a dataset parameter, a row filter, a history entry's address or a saved preference.
//
// The link's address names the request as ?open-filters=1, so a new tab or a
// copied link opens the filters too. The name has a hyphen, which a column name
// cannot have, so it can never be taken for a row filter, and the query
// parameter readers leave it out like the sign-in markers. A page started from
// such an address removes the marker as soon as this module loads: the first
// navigation rewrites the address before anything is drawn, so the request is
// kept in memory instead and the dataset's filter bar takes it once it is ready.
//
// One request waits at a time. It carries its own token, so a navigation that
// ends can only settle or cancel its own request, and it expires: a request no
// filter bar took never opens the filters on some later, ordinary visit.

import { recordApplicationAddressWrite } from "./address_write_revision.js";

export const OPEN_FILTERS_QUERY_KEY = "open-filters";
const REQUEST_LIFETIME_MS = 60000;

let pending = null;
let nextToken = 1;

/**
 * Adds the open-filters marker to an application path.
 * @param {string} path - a path, optionally with a query and a fragment
 * @returns {string}
 */
export function withOpenFiltersRequest(path) {
    const address = new URL(path, location.origin);
    address.searchParams.set(OPEN_FILTERS_QUERY_KEY, "1");
    return address.pathname + address.search + address.hash;
}

function createRequest(target) {
    const request = { token: nextToken++, ...target, expiresAt: Date.now() + REQUEST_LIFETIME_MS,
        claim: null, settled: false, carried: false };
    pending = request;
    return request.token;
}

/**
 * An in-page click asks the named dataset to open its filters when it arrives.
 * @param {string} dataset - internal dataset name
 * @returns {number} the request's token
 */
export function requestFiltersOnArrival(dataset) {
    return createRequest({ dataset });
}

/**
 * The navigation finished. A request no filter bar took on the way is dropped,
 * so it cannot open the filters on a later visit.
 * @param {number} token
 */
export function settleFiltersArrivalRequest(token) {
    if (pending?.token !== token) return;
    if (pending.claim === null) pending = null;
    // A bar is opening it; should that bar be torn down, nothing takes it over.
    else pending.settled = true;
}

/**
 * The navigation was refused or failed: its request ends, even if a bar took it.
 * @param {number} token
 */
export function cancelFiltersArrivalRequest(token) {
    if (pending?.token === token) pending = null;
}

/**
 * A navigation is starting. The first one after a request is the one that
 * carries it; any later one before a filter bar took it supersedes that
 * navigation (the person went elsewhere meanwhile), so the request ends and a
 * later visit to the same dataset is an ordinary one.
 */
export function noteNavigationStarted() {
    if (!pending || pending.claim !== null) return;
    if (!pending.carried) pending.carried = true;
    else pending = null;
}

/**
 * A navigation finished. A request from the page's own address belongs to the
 * page's first navigation: if no filter bar took it on the way (the dataset
 * failed to load, say), it ends here instead of waiting for a later visit.
 */
export function settleAddressFiltersArrivalRequest() {
    if (!pending || !("pathSegment" in pending)) return;
    if (pending.claim === null) pending = null;
    else pending.settled = true;
}

/**
 * Lets the named dataset's active filter bar take the waiting request.
 * A request from a page's own address belongs to the first bar that becomes
 * active; any other dataset drops it. An in-page request waits for its own
 * dataset until its navigation settles.
 * @param {string} dataset - internal dataset name of the active bar
 * @param {(segment: string) => string | null} [resolvePathSegment] - address segment to dataset name
 * @returns {null | { isCurrent: () => boolean, complete: () => void, release: () => void }}
 */
export function claimFiltersArrivalRequest(dataset, resolvePathSegment = () => null) {
    const request = pending;
    if (!request) return null;
    if (Date.now() > request.expiresAt) {
        pending = null;
        return null;
    }
    if (request.claim !== null) return null;
    if ("pathSegment" in request) {
        const resolved = request.pathSegment === dataset || resolvePathSegment(request.pathSegment) === dataset;
        if (!resolved) {
            pending = null;
            return null;
        }
    } else if (request.dataset !== dataset) {
        return null;
    }
    const claim = Symbol("filters arrival claim");
    request.claim = claim;
    const owns = () => pending === request && request.claim === claim;
    return {
        isCurrent: owns,
        // Delivered, or no longer wanted: the request ends.
        complete() { if (owns()) pending = null; },
        // The receiving bar was torn down before delivery. During its own
        // navigation a rebuilt bar may take it over; afterwards it simply ends.
        release() {
            if (!owns()) return;
            if (request.settled) pending = null;
            else request.claim = null;
        },
    };
}

function firstPathSegment(pathname) {
    const segment = String(pathname || "").replace(/^\/+/, "").split("/")[0];
    try {
        return decodeURIComponent(segment);
    } catch {
        return segment;
    }
}

/**
 * Moves a marker from this page's address into memory, keeping the history
 * entry's state, the other parameters (?lang= among them) and the fragment.
 * @returns {boolean} whether the address asked for the filters
 */
function adoptOpenFiltersMarkerFromAddress() {
    if (typeof location === "undefined" || typeof history === "undefined") return false;
    const params = new URLSearchParams(location.search);
    if (!params.has(OPEN_FILTERS_QUERY_KEY)) return false;
    const wanted = params.get(OPEN_FILTERS_QUERY_KEY) === "1";
    params.delete(OPEN_FILTERS_QUERY_KEY);
    const search = params.toString();
    recordApplicationAddressWrite();
    history.replaceState(history.state, "", location.pathname + (search ? `?${search}` : "") + location.hash);
    if (wanted) createRequest({ pathSegment: firstPathSegment(location.pathname) });
    return wanted;
}

adoptOpenFiltersMarkerFromAddress();
