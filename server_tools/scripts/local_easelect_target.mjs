// local_easelect_target.mjs - Shared local Easelect QA target helpers.
// Connects human_qa, AI acceptance, and Computer Use runners to local instances.
// Keeps per-port auth-state and host allowlist behavior consistent.
// Exists so non-8082 management/application instances can be tested like native.

import path from "path";

const localHostnames = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

// Parses a browser target into a URL object when possible.
export function parseTargetUrl(target) {
    try {
        return target instanceof URL ? target : new URL(String(target || ""));
    } catch (_error) {
        return null;
    }
}

// Identifies local Easelect URLs that can use the dev login refresh flow.
export function isLocalEaselectUrl(target) {
    const parsed = parseTargetUrl(target);
    if (!parsed) {
        return false;
    }
    return ["http:", "https:"].includes(parsed.protocol) && localHostnames.has(parsed.hostname);
}

// Adds the explicit target host to a guarded browser allowlist.
export function addTargetHostToAllowedHosts(allowedHosts, target) {
    const parsed = parseTargetUrl(target);
    if (!parsed || !["http:", "https:"].includes(parsed.protocol)) {
        return allowedHosts;
    }
    if (!allowedHosts.includes(parsed.host)) {
        allowedHosts.push(parsed.host);
    }
    return allowedHosts;
}

// Picks a stable per-target auth-state path for local non-native ports.
export function authStatePathForTarget(repoRoot, target, nativeAuthStatePath) {
    const parsed = parseTargetUrl(target);
    if (!parsed || !isLocalEaselectUrl(parsed)) {
        return nativeAuthStatePath;
    }
    if (parsed.port === "" || parsed.port === "8082") {
        return nativeAuthStatePath;
    }
    return path.join(
        repoRoot,
        "testing/e2e/.auth",
        `user-${slugifyAuthStateHost(parsed.host)}.json`,
    );
}

// Converts a host:port pair into a filesystem-safe auth-state label.
export function slugifyAuthStateHost(host) {
    return String(host || "")
        .toLowerCase()
        .replace(/^\[(.*)\]/, "$1")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 80) || "local";
}
