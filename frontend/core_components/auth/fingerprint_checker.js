// fingerprint_checker.js
// Validates the browser fingerprint against the stored session on page load.
// Bridges browser-identity checks and session auth by running after setAuthModes() to avoid a CookieStore race.
// Exists to detect session hijacking early; silently skips on 429 rate-limit responses.
import { gather_browser_fingerprint_hash } from "../../reusable_components/browser_identity_builder.js";
import { endpoint_router } from "../endpoints/endpoint_router.js";
import { clearClientAuthArtifacts } from "./logout_shell_reset.js";
import { buildLoginEntryPath, navigateToLoginEntry } from "./login_shell_entry.js";
import { publishAuthLogout } from "./auth_broadcast.js";

function getFingerprintErrorDetails(err) {
    return {
        name: err?.name || null,
        status: Number.isFinite(err?.status) ? err.status : null,
        message: err?.message || String(err),
    };
}

function isNetworkLikeFingerprintError(err) {
    const name = err?.name || "";
    const message = (err?.message || String(err) || "").toLowerCase();

    return name === "AbortError"
        || name === "TypeError"
        || message.includes("networkerror")
        || message.includes("failed to fetch")
        || message.includes("load failed")
        || message.includes("network request failed")
        || message.includes("fetch resource")
        || message.includes("aborted")
        || message.includes("terminated");
}

// Reset session when stuck in a loop (e.g., corrupted session causing 429 errors)
function applyPostSessionResetNavigation() {
    const buttonState = localStorage.getItem("button_state");
    if (buttonState === "logout") {
        navigateToLoginEntry();
        return;
    }

    // Guest sessions already have their cookie state cleared by the server.
    // The main SPA bootstrap will continue after checkFingerprint() returns.
    console.info("[FingerprintCheck] session reset complete for guest user; continuing SPA bootstrap");
}

async function resetSessionAndRedirect() {
    try {
        const response = await endpoint_router('resetSession', { method: 'POST', returnResponse: true });
        if (response.ok) {
            publishAuthLogout({
                reason: 'session_reset',
                postLogoutPath: buildLoginEntryPath(),
            });
            applyPostSessionResetNavigation();
        } else {
            console.warn("Session reset failed:", response.status);
            await clearClientAuthArtifacts();
        }
    } catch (e) {
        console.warn("Session reset error:", e);
        await clearClientAuthArtifacts();
    }
}

/**
 * Validate the browser fingerprint against the server session.
 * Must be called AFTER setAuthModes() to serialize CookieStore session writes.
 */
export async function checkFingerprint() {
    try {
        // The fingerprint cookie is now HttpOnly — JS cannot read it.
        // Instead, generate a fresh fingerprint hash and send it to the check endpoint.
        // The server will HMAC the submitted value and compare it with the session.
        const fp = await gather_browser_fingerprint_hash();
        if (fp) {
            await endpoint_router("checkFingerprint", {
                method: "POST",
                body_data: { fingerprint: fp },
            });
        }
    } catch (err) {
        console.warn("Fingerprint validation error", err);
        const details = getFingerprintErrorDetails(err);

        // Rate limit (429) — do NOT reset session. The fingerprint check is a
        // background security validation; resetting the session on 429 creates a
        // vicious cycle: reload → 429 → session cleared → guest → confused user
        // reloads → 429 again. Just skip silently and let the next page load retry.
        if (err.isRateLimited || err.status === 429 || (err.message && err.message.includes("429"))) {
            console.debug("Fingerprint check rate-limited — skipping, will retry on next page load");
            return;
        }

        // Generic network failures are not evidence of session corruption.
        // Resetting the session on transient fetch errors creates a hard reload
        // loop on mobile devices where the startup request path is less stable.
        if (isNetworkLikeFingerprintError(err)) {
            console.error("[FingerprintCheck] network-like startup failure; skipping session reset", details);
            return;
        }

        // Auth redirect (401/403) already handled by the API pipeline's
        // authRedirectStage — no need to double-reset here.
        if (err.message && err.message.includes('auth_redirect')) {
            return;
        }

        // Genuine fingerprint mismatch or session corruption — reset session.
        console.error("[FingerprintCheck] resetting session after fingerprint failure", details);
        await resetSessionAndRedirect();
    }
}
