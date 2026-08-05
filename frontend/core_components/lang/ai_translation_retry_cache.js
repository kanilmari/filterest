// ai_translation_retry_cache.js
// Remembers unresolved AI translation requests across reloads in the same tab.
// Bridges the translation mutation observer with sessionStorage-backed cooldowns.
// Exists so an unavailable translator is not asked for the same keys every iteration.

const STORAGE_KEY = "easelect_ai_translation_retry_cache_v1";
export const AI_TRANSLATION_RETRY_COOLDOWN_MS = 15 * 60 * 1000;

function resolveSessionStorage(storage) {
    if (storage) return storage;

    try {
        return globalThis.sessionStorage || null;
    } catch {
        return null;
    }
}

function readEntries(storage) {
    const resolvedStorage = resolveSessionStorage(storage);
    if (!resolvedStorage) return [];

    try {
        const parsed = JSON.parse(resolvedStorage.getItem(STORAGE_KEY) || "{}");
        return Array.isArray(parsed.entries) ? parsed.entries : [];
    } catch {
        return [];
    }
}

function writeEntries(storage, entries) {
    const resolvedStorage = resolveSessionStorage(storage);
    if (!resolvedStorage) return;

    try {
        resolvedStorage.setItem(STORAGE_KEY, JSON.stringify({
            version: 1,
            entries,
        }));
    } catch {
        // Translation remains functional when browser storage is unavailable.
    }
}

function normalizeLanguage(language) {
    return String(language || "").trim().toLowerCase();
}

function activeEntries(storage, now) {
    return readEntries(storage).filter((entry) => (
        entry
        && typeof entry.key === "string"
        && entry.key.trim() !== ""
        && typeof entry.language === "string"
        && Number.isFinite(entry.retryAfter)
        && entry.retryAfter > now
    ));
}

export function getSuppressedAITranslationKeys(
    language,
    { storage = null, now = Date.now() } = {}
) {
    const normalizedLanguage = normalizeLanguage(language);
    return new Set(
        activeEntries(storage, now)
            .filter((entry) => entry.language === normalizedLanguage)
            .map((entry) => entry.key)
    );
}

export function suppressUnresolvedAITranslationKeys(
    language,
    keys,
    {
        storage = null,
        now = Date.now(),
        cooldownMs = AI_TRANSLATION_RETRY_COOLDOWN_MS,
    } = {}
) {
    const normalizedLanguage = normalizeLanguage(language);
    const normalizedKeys = [...new Set(
        (Array.isArray(keys) ? keys : [])
            .map((key) => String(key || "").trim())
            .filter(Boolean)
    )];
    if (!normalizedLanguage || normalizedKeys.length === 0 || cooldownMs <= 0) {
        return;
    }

    const entriesByIdentity = new Map(
        activeEntries(storage, now).map((entry) => [
            `${entry.language}\u0000${entry.key}`,
            entry,
        ])
    );
    normalizedKeys.forEach((key) => {
        const entry = {
            language: normalizedLanguage,
            key,
            retryAfter: now + cooldownMs,
        };
        entriesByIdentity.set(`${normalizedLanguage}\u0000${key}`, entry);
    });

    writeEntries(storage, [...entriesByIdentity.values()]);
}
