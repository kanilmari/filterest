// address_write_revision.js
// Records every application address write, including same-address replacements.
// Bridges shared history writers and the few shell/view callers of the native API.
// Keeps pending row presentations cancelled even after an address round trip.

let addressWriteRevision = 0;

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
}
