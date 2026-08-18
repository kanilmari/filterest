// Validates user-provided external links before a card renderer makes them clickable.
// Explicit internal application routes are handled separately by their callers.
// Exists so semantic link fields never turn arbitrary text or executable URL schemes into links.

export function resolveSafeExternalHttpUrl(value) {
    const candidate = String(value ?? "").trim();
    if (!candidate) {
        return "";
    }

    try {
        const parsedUrl = new URL(candidate);
        if (parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:") {
            return candidate;
        }
    } catch {
        // Plain text and relative paths are not external URL fields.
    }

    return "";
}
