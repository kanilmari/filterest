// address_write_revision.js
// Records every application address write, including same-address replacements.
// Bridges shared history writers and the few shell/view callers of the native API.
// Keeps pending row presentations cancelled even after an address round trip.

let addressWriteRevision = 0;
const pendingAddressChecks = new Set();

/** Abort the controller when the work watching this visit has finished. */
export function trackApplicationVisit() {
    const visit = new AbortController();
    const address = location.href;
    const leave = () => visit.abort();
    const check = () => { if (location.href !== address) leave(); };
    pendingAddressChecks.add(check);
    visit.signal.addEventListener('abort', () => pendingAddressChecks.delete(check), { once: true });
    window.addEventListener('popstate', leave, { signal: visit.signal });
    window.addEventListener('pagehide', leave, { signal: visit.signal });
    return visit;
}

function checkPendingAddresses() {
    for (const check of pendingAddressChecks) check();
}

/** Capture at activation and compare before any asynchronous opening commits. */
export function getApplicationAddressWriteRevision() {
    return addressWriteRevision;
}

/** Call at the write boundary, including a shared writer's suppressed no-op.
 * This records intent only: native History API arguments and behaviour stay owned
 * by each existing writer. The revision lasts for this document and never rewinds.
 */
export function recordApplicationAddressWrite() {
    addressWriteRevision += 1;
    if (pendingAddressChecks.size) {
        // Native pushState/replaceState run immediately after this boundary and
        // do not fire popstate. Check the last write before another can undo it,
        // then check this write after it commits. Same-URL Home repairs survive.
        checkPendingAddresses();
        queueMicrotask(checkPendingAddresses);
    }
}
