// dataset_search_queue.js
// Shares the two-request budget between supplemental search and phone Home search.
// Replacement rounds wait for aborted transports to settle before taking a slot.
// Queued obsolete work is discarded without making a request.

const queue = [];
let activeRequests = 0;

function pump() {
    while (activeRequests < 2 && queue.length) {
        const task = queue.shift();
        if (task.signal.aborted) { task.resolve(); continue; }
        activeRequests += 1;
        Promise.resolve().then(task.run).then(task.resolve, task.reject).finally(() => {
            activeRequests -= 1;
            pump();
        });
    }
}

/** Schedule an authorized search; the caller still checks its generation before drawing. */
export function scheduleDatasetSearch(run, signal) {
    return new Promise((resolve, reject) => {
        queue.push({ run, signal, resolve, reject });
        pump();
    });
}
