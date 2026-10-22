// background_media_hold.js
// Coordinates temporary holds on background playback without owning a player.
// Connects article/navigation lifecycles to mounted media through boolean notifications.
// Keeps overlapping reasons held until the last owner releases its key.

const holds = new Set();
const listeners = new Set();

/** Adds a reason once; subscribers only see the first hold and final release. */
export function acquire(key) {
    const wasHeld = holds.size > 0;
    holds.add(key);
    if (!wasHeld) listeners.forEach(listener => listener(true));
}

/** Releases a reason idempotently, including repeated cleanup calls. */
export function release(key) {
    if (holds.delete(key) && holds.size === 0) listeners.forEach(listener => listener(false));
}

/** Immediately reports the current hold state and returns an unsubscribe function. */
export function subscribe(listener) {
    listeners.add(listener);
    listener(holds.size > 0);
    return () => listeners.delete(listener);
}
