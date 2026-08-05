// dataset_selection_saver_helpers.js
// Pure helper functions extracted from dataset_selection_saver.js for testability.
// Zero DOM access — all functions are pure input→output or operate on injected storage objects.

/**
 * Safely write a value to a storage object (sessionStorage/localStorage).
 * Swallows quota-exceeded and security errors.
 *
 * @param {Storage} storage - Storage object to write to
 * @param {string} key - Storage key
 * @param {string} value - Value to store
 */
export function safeSetItem(storage, key, value) {
    try {
        storage.setItem(key, value);
    } catch (err) {
        console.warn(`[dataset_selection_store] setItem failed for ${key}`, err);
    }
}

/**
 * Safely remove a key from a storage object.
 * Swallows security errors.
 *
 * @param {Storage} storage - Storage object to remove from
 * @param {string} key - Storage key to remove
 */
export function safeRemoveItem(storage, key) {
    try {
        storage.removeItem(key);
    } catch (err) {
        console.warn(`[dataset_selection_store] removeItem failed for ${key}`, err);
    }
}

/**
 * Safely read a value from a storage object.
 * Returns null on error.
 *
 * @param {Storage} storage - Storage object to read from
 * @param {string} key - Storage key
 * @returns {string|null}
 */
export function safeGetItem(storage, key) {
    try {
        return storage.getItem(key);
    } catch (err) {
        console.warn(`[dataset_selection_store] getItem failed for ${key}`, err);
        return null;
    }
}

/**
 * Parse a JSON string safely, returning fallback on failure.
 *
 * @param {string|null} str - JSON string to parse
 * @param {*} fallback - Value to return on parse failure or null input
 * @returns {*}
 */
export function parseJsonSafely(str, fallback) {
    if (str == null) return fallback;
    try {
        return JSON.parse(str);
    } catch {
        return fallback;
    }
}

/**
 * Serialize an object to JSON safely, returning null on failure.
 *
 * @param {*} obj - Object to serialize
 * @returns {string|null}
 */
export function serializeJsonSafely(obj) {
    if (obj == null) return null;
    try {
        return JSON.stringify(obj);
    } catch {
        return null;
    }
}

/**
 * Migrate a value from local storage to session storage.
 * Reads from session first; if missing, falls back to local and migrates.
 *
 * @param {Storage} sessionStore - Session storage object
 * @param {Storage} localStore - Local storage object
 * @param {string} key - Storage key
 * @returns {string|null} The resolved value
 */
export function migrateToSession(sessionStore, localStore, key) {
    const sessionValue = safeGetItem(sessionStore, key);
    if (sessionValue) return sessionValue;

    const localValue = safeGetItem(localStore, key);
    if (localValue) {
        safeSetItem(sessionStore, key, localValue);
        safeRemoveItem(localStore, key);
        return localValue;
    }
    return null;
}
