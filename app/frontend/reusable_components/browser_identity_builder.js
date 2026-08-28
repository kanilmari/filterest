// browser_identity_builder.js
// Generates a hashed browser identity from client-visible properties.
// Between the authentication UI and backend session-binding security checks.
// Exists to provide a stable non-PII token for fingerprint-based device protection.
/**
 * Collects stable browser attributes that are safe to expose to client scripts.
 * Bridges the authentication UI and backend session binding by avoiding PII while
 * still producing a consistent input for hashing.
 */
export function gather_browser_fingerprint_data() {
    return {
        user_agent: navigator.userAgent,
        // language: navigator.language,
        platform: navigator.platform,
        cookie_enabled: navigator.cookieEnabled,
        // screen_width: screen.width,
        // screen_height: screen.height,
        // color_depth: screen.colorDepth,
    };
}

/**
 * Produces a SHA-256 hex digest from the gathered browser attributes.
 * Connects the raw attribute collection to login flows that need a stable,
 * extension-friendly token for session validation.
 */
export async function gather_browser_fingerprint_hash() {
    const data_obj = gather_browser_fingerprint_data();
    const json_str = JSON.stringify(data_obj);

    const encoder = new TextEncoder();
    const encoded_data = encoder.encode(json_str);
    const hash_buffer = await crypto.subtle.digest("SHA-256", encoded_data);
    const hash_array = Array.from(new Uint8Array(hash_buffer));
    const hash_hex = hash_array.map((b) => b.toString(16).padStart(2, "0")).join("");
    return hash_hex;
}
