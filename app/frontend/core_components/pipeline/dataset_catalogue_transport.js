// One in-flight GET and one bounded recovery clock per document for /api/datasets.
// The API pipeline still handles each caller's own permissions, parsing and notices.
import { createRateLimitError } from './api_pipeline_helpers.js';

const RETRY_DELAYS = [2000, 4000, 8000, 16000];
const MAX_SERVER_WAIT_MS = 30 * 60 * 1000;
// Keep only the waiting time across a full reload in this tab. No identity or
// permission-filtered catalogue ever goes into browser storage.
const DEADLINE_KEY = 'dataset_catalogue_retry_after_v1';
function readDeadline() {
    try {
        const stored = Number(sessionStorage.getItem(DEADLINE_KEY));
        const now = Date.now();
        if (!Number.isSafeInteger(stored) || stored <= now) return 0;
        const deadline = Math.min(stored, now + MAX_SERVER_WAIT_MS);
        // Repair an older tab's unbounded deadline once; reloads retain that instant.
        if (deadline !== stored) {
            try { sessionStorage.setItem(DEADLINE_KEY, String(deadline)); }
            catch { /* Keep the corrected deadline in memory if storage is read-only. */ }
        }
        return deadline;
    } catch { return 0; }
}
function saveDeadline(value) {
    retryAt = value;
    try {
        if (value) sessionStorage.setItem(DEADLINE_KEY, String(value));
        else sessionStorage.removeItem(DEADLINE_KEY);
    } catch { /* Storage can be disabled. The in-memory deadline still holds. */ }
}
let flight = null, retryAt = readDeadline(), refusals = 0, timer = null, recover;
let recovery = null;

/** A startup waiting for this retry sequence must detach when the sequence ends. */
export function getDatasetCatalogueRecoverySignal() {
    return recovery?.signal;
}

function finishRecovery(sequence = recovery) {
    if (!sequence || recovery !== sequence) return;
    recovery = null;
    sequence.abort();
}

function stopTimer() {
    clearTimeout(timer);
    timer = null;
}

async function recoverWhenDue() {
    stopTimer();
    if (Date.now() < retryAt) { scheduleRecovery(); return; }
    const sequence = recovery;
    try {
        await recover(); // the registry publishes a valid response before this settles
    } finally {
        if (timer === null) finishRecovery(sequence);
    }
}

function scheduleRecovery() {
    if (refusals > RETRY_DELAYS.length) { finishRecovery(); return; }
    if (!recover || timer !== null) return;
    recovery ??= new AbortController();
    timer = setTimeout(recoverWhenDue, Math.max(0, retryAt - Date.now()));
}

function waitFromHeader(header, now) {
    const value = (header || '').trim();
    if (/^\d+$/.test(value)) return Number(value) * 1000;
    if (/^[A-Za-z]/.test(value)) return Date.parse(value) - now;
    return NaN;
}

export function registerDatasetCatalogueRecovery(callback) {
    recover = callback;
    if (refusals) scheduleRecovery();
}

// A save supersedes the old read; a changed identity also cancels its retries.
// Neither may shorten a waiting period set by the server (the limit is per IP).
export function invalidateDatasetCatalogueRead({ identityChanged = false } = {}) {
    flight?.controller.abort();
    flight = null;
    if (identityChanged) {
        stopTimer();
        finishRecovery();
        refusals = 0;
    }
}

function joinRead(entry, signal) {
    entry.waiters++;
    return new Promise((resolve, reject) => {
        let active = true;
        function finish() {
            if (!active) return false;
            active = false;
            signal?.removeEventListener('abort', onAbort);
            entry.waiters--;
            return true;
        }
        function onAbort() {
            if (!finish()) return;
            if (!entry.waiters && flight === entry) invalidateDatasetCatalogueRead();
            reject(signal.reason);
        }
        signal?.addEventListener('abort', onAbort, { once: true });
        entry.result.then(response => active ? response.clone() : null).then(response => { if (finish()) resolve(response); },
            error => { if (finish()) reject(error); });
    });
}

/** Return the first refusal promptly so public navigation can show its fallback. */
export async function readDatasetCatalogue(send, signal) {
    if (signal?.aborted) throw signal.reason;
    if (Date.now() < retryAt || refusals > RETRY_DELAYS.length) {
        if (!refusals) refusals = 1; // new identity requested data during the embargo
        scheduleRecovery();
        throw createRateLimitError('fetchContentTables');
    }
    // If another consumer reaches the deadline before the timer task, have the
    // registry join that read so the pending startup always sees its outcome.
    if (timer !== null) void recoverWhenDue();
    if (!flight) {
        const entry = { controller: new AbortController(), waiters: 0 };
        flight = entry;
        entry.result = Promise.resolve().then(() => send(entry.controller.signal)).then(response => {
            if (flight !== entry) throw new DOMException('Obsolete catalogue request', 'AbortError');
            if (response.status === 429) {
                const now = Date.now();
                const headerWait = waitFromHeader(response.headers.get('Retry-After'), now);
                const minimum = RETRY_DELAYS[Math.min(refusals, RETRY_DELAYS.length - 1)];
                if (!refusals) finishRecovery();
                refusals++;
                const wait = Math.max(minimum, Math.min(headerWait || 0, MAX_SERVER_WAIT_MS));
                saveDeadline(now + wait);
                scheduleRecovery();
            } else {
                refusals = 0;
                if (retryAt) saveDeadline(0);
            }
            return response;
        }).finally(() => { if (flight === entry) flight = null; });
    }
    return joinRead(flight, signal);
}
