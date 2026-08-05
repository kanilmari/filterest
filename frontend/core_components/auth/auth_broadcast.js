// auth_broadcast.js
// Synchronizes cross-tab auth invalidation events such as logout and forced session reset.
// Bridges local auth lifecycle actions with other browser tabs via BroadcastChannel and storage events.
// Exists to let one tab proactively invalidate stale authenticated shells in sibling tabs.

const AUTH_BROADCAST_CHANNEL = "easelect-auth";
const AUTH_BROADCAST_STORAGE_KEY = "easelect:auth-broadcast";
const MAX_SEEN_EVENTS = 100;

const localTabId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

let eventCounter = 0;
let broadcastChannel = null;
let listenersInitialized = false;
let storageListener = null;
let channelListener = null;

const subscribers = new Set();
const seenEventIds = [];

function rememberEvent(eventId) {
    if (!eventId) {
        return false;
    }
    if (seenEventIds.includes(eventId)) {
        return true;
    }
    seenEventIds.push(eventId);
    if (seenEventIds.length > MAX_SEEN_EVENTS) {
        seenEventIds.shift();
    }
    return false;
}

function buildAuthEvent(type, detail = {}) {
    eventCounter += 1;
    return {
        type,
        detail,
        tabId: localTabId,
        eventId: `${localTabId}:${Date.now()}:${eventCounter}`,
        emittedAt: Date.now(),
    };
}

function notifySubscribers(event) {
    if (!event || !event.type || !event.eventId) {
        return;
    }
    if (event.tabId === localTabId) {
        return;
    }
    if (rememberEvent(event.eventId)) {
        return;
    }
    subscribers.forEach((subscriber) => {
        Promise.resolve()
            .then(() => subscriber(event))
            .catch((error) => {
                console.warn("Auth broadcast subscriber failed:", error);
            });
    });
}

function ensureListeners() {
    if (listenersInitialized || typeof window === "undefined") {
        return;
    }

    if (typeof globalThis.BroadcastChannel === "function") {
        broadcastChannel = new globalThis.BroadcastChannel(AUTH_BROADCAST_CHANNEL);
        channelListener = (messageEvent) => {
            notifySubscribers(messageEvent?.data);
        };
        broadcastChannel.addEventListener("message", channelListener);
    }

    storageListener = (storageEvent) => {
        if (storageEvent.key !== AUTH_BROADCAST_STORAGE_KEY || !storageEvent.newValue) {
            return;
        }
        try {
            notifySubscribers(JSON.parse(storageEvent.newValue));
        } catch (error) {
            console.warn("Failed to parse auth broadcast storage event:", error);
        }
    };
    window.addEventListener("storage", storageListener);

    listenersInitialized = true;
}

export function subscribeToAuthBroadcast(handler) {
    if (typeof handler !== "function") {
        throw new Error("subscribeToAuthBroadcast requires a function handler");
    }

    ensureListeners();
    subscribers.add(handler);

    return () => {
        subscribers.delete(handler);
    };
}

function emitAuthEvent(event) {
    if (!event) {
        return;
    }

    if (broadcastChannel) {
        broadcastChannel.postMessage(event);
    }

    if (typeof localStorage !== "undefined") {
        try {
            localStorage.setItem(AUTH_BROADCAST_STORAGE_KEY, JSON.stringify(event));
            localStorage.removeItem(AUTH_BROADCAST_STORAGE_KEY);
        } catch (error) {
            console.warn("Failed to write auth broadcast storage event:", error);
        }
    }
}

export function publishAuthLogout(detail = {}) {
    emitAuthEvent(buildAuthEvent("logout", detail));
}

export function publishAuthLogin(detail = {}) {
    emitAuthEvent(buildAuthEvent("login", detail));
}
