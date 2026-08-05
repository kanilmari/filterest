// current_user_profile_fetcher.js
// Short-lived profile fetch dedupe for authenticated UI startup.
// Bridges repeated fetchUserProfile callers and the shared API pipeline with a tiny safe cache window.
// Exists to stop adjacent startup features from requesting the same user profile twice during one screen open.

import { endpoint_router } from "../endpoints/endpoint_router.js";

const PROFILE_CACHE_TTL_MS = 1500;

let cachedProfile = null;
let cachedProfileAt = 0;
let hasCachedProfile = false;
let inFlightProfileRequest = null;

function isKnownAnonymousAuthShell() {
    try {
        return globalThis.localStorage?.getItem("button_state") === "login";
    } catch (_) {
        return false;
    }
}

export function resetCurrentUserProfileCache() {
    cachedProfile = null;
    cachedProfileAt = 0;
    hasCachedProfile = false;
    inFlightProfileRequest = null;
}

export async function fetchCurrentUserProfile({ forceRefresh = false } = {}) {
    const now = Date.now();
    if (!forceRefresh && isKnownAnonymousAuthShell()) {
        resetCurrentUserProfileCache();
        return null;
    }

    if (!forceRefresh && hasCachedProfile && (now - cachedProfileAt) < PROFILE_CACHE_TTL_MS) {
        return cachedProfile;
    }

    if (!forceRefresh && inFlightProfileRequest) {
        return inFlightProfileRequest;
    }

    inFlightProfileRequest = endpoint_router("fetchUserProfile")
        .then((profile) => {
            cachedProfile = profile;
            cachedProfileAt = Date.now();
            hasCachedProfile = true;
            return profile;
        })
        .catch((err) => {
            resetCurrentUserProfileCache();
            throw err;
        })
        .finally(() => {
            inFlightProfileRequest = null;
        });

    return inFlightProfileRequest;
}
