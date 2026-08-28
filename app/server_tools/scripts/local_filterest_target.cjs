// local_filterest_target.cjs - Structural local Filterest target selection.
// Shares one synchronous resolver between Playwright configuration and Node ESM tools.
// Keeps the public installation on 8100 while the private Easelect composition stays on 8082.
// Exists as CommonJS because Playwright loads its TypeScript configuration synchronously.

const fs = require("node:fs");
const path = require("node:path");
const process = require("node:process");
const { URL } = require("node:url");

const localHostnames = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const embeddedEaselectBaseUrl = "https://localhost:8082";
const standaloneFilterestBaseUrl = "https://localhost:8100";

// Recognizes only loopback hostnames accepted by guarded local browser tools.
function isLocalFilterestHostname(hostname) {
    return localHostnames.has(hostname);
}

// Detects the private composition only from both durable outer source markers.
function isEmbeddedEaselectApplication(applicationRoot) {
    const resolvedApplicationRoot = path.resolve(applicationRoot || ".");
    const productRoot = path.basename(resolvedApplicationRoot) === "app"
        ? path.dirname(resolvedApplicationRoot)
        : resolvedApplicationRoot;
    const possibleEaselectRoot = path.dirname(productRoot);
    const gitMarker = path.join(possibleEaselectRoot, ".git");
    const versionMarker = path.join(possibleEaselectRoot, "VERSION_EASELECT");
    return fs.existsSync(gitMarker)
        && fs.existsSync(versionMarker)
        && fs.statSync(versionMarker).isFile();
}

// Selects the product-owned local origin before any explicit test override.
function defaultLocalFilterestBaseUrl(applicationRoot) {
    return isEmbeddedEaselectApplication(applicationRoot)
        ? embeddedEaselectBaseUrl
        : standaloneFilterestBaseUrl;
}

// Resolves and validates the one local HTTPS origin used by browser tooling.
function resolveLocalFilterestBaseUrl({
    applicationRoot = ".",
    environment = process.env,
} = {}) {
    const embeddedEaselect = isEmbeddedEaselectApplication(applicationRoot);
    const filterestTarget = String(environment.FILTEREST_E2E_BASE_URL || "").trim();
    const easelectCompatibilityTarget = embeddedEaselect
        ? String(environment.EASELECT_E2E_BASE_URL || "").trim()
        : "";
    const configured = filterestTarget || easelectCompatibilityTarget;
    const rawUrl = configured || defaultLocalFilterestBaseUrl(applicationRoot);
    let parsed;
    try {
        parsed = new URL(rawUrl);
    } catch {
        parsed = null;
    }
    if (
        !parsed
        || parsed.protocol !== "https:"
        || parsed.username
        || parsed.password
        || !isLocalFilterestHostname(parsed.hostname)
    ) {
        throw new Error(
            "FILTEREST_E2E_BASE_URL (or embedded Easelect's legacy EASELECT_E2E_BASE_URL) must be a credential-free local HTTPS origin.",
        );
    }
    return parsed.origin;
}

// Builds the three loopback host forms accepted by guarded browser runners.
function localAllowedHostsForBaseUrl(baseUrl) {
    const parsed = new URL(baseUrl);
    const suffix = parsed.port ? `:${parsed.port}` : "";
    return [`localhost${suffix}`, `127.0.0.1${suffix}`, `[::1]${suffix}`];
}

exports.isEmbeddedEaselectApplication = isEmbeddedEaselectApplication;
exports.isLocalFilterestHostname = isLocalFilterestHostname;
exports.defaultLocalFilterestBaseUrl = defaultLocalFilterestBaseUrl;
exports.resolveLocalFilterestBaseUrl = resolveLocalFilterestBaseUrl;
exports.localAllowedHostsForBaseUrl = localAllowedHostsForBaseUrl;
