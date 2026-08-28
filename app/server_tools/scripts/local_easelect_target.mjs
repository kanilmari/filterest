// local_easelect_target.mjs - Shared local Filterest/Easelect QA target helpers.
// Connects Playwright and browser-acceptance tools to the product they belong to.
// Keeps structural defaults, per-port auth state, and host allowlists consistent.
// Exists so standalone Filterest never falls through to Easelect's native port.

import path from "path";
import { fileURLToPath } from "url";
import {
    defaultLocalFilterestBaseUrl,
    isEmbeddedEaselectApplication,
    isLocalFilterestHostname,
    localAllowedHostsForBaseUrl,
    resolveLocalFilterestBaseUrl,
} from "./local_filterest_target.cjs";

export {
    defaultLocalFilterestBaseUrl,
    isEmbeddedEaselectApplication,
    localAllowedHostsForBaseUrl,
    resolveLocalFilterestBaseUrl,
};

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
    return ["http:", "https:"].includes(parsed.protocol)
        && isLocalFilterestHostname(parsed.hostname);
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
export function authStatePathForTarget(
    repoRoot,
    target,
    nativeAuthStatePath,
    environment = process.env,
) {
    const parsed = parseTargetUrl(target);
    if (!parsed || !isLocalEaselectUrl(parsed)) {
        return nativeAuthStatePath;
    }
    const nativeBaseUrl = resolveLocalFilterestBaseUrl({
        applicationRoot: repoRoot,
        environment,
    });
    if (parsed.port === "" || parsed.origin === nativeBaseUrl) {
        return nativeAuthStatePath;
    }
    return path.join(
        path.dirname(nativeAuthStatePath),
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

// Gives shell QA the same structural default without duplicating path logic.
const executedModule = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (executedModule === fileURLToPath(import.meta.url)) {
    if (process.argv[2] !== "--print-base-url" || !process.argv[3]) {
        process.stderr.write("usage: local_easelect_target.mjs --print-base-url APP_ROOT\n");
        process.exitCode = 2;
    } else {
        process.stdout.write(`${resolveLocalFilterestBaseUrl({ applicationRoot: process.argv[3] })}\n`);
    }
}
