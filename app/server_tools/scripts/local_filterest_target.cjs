// local_filterest_target.cjs - Structural local Filterest target selection.
// Shares one synchronous resolver between Playwright configuration and Node ESM tools.
// Reads the native development ports from ../lib/native_development_ports.env, which
// the Python and shell tools read too, and owns the JavaScript side of that rule.
// Exists as CommonJS because Playwright loads its TypeScript configuration synchronously.
/* global __dirname */

const fs = require("node:fs");
const path = require("node:path");
const process = require("node:process");
const { URL } = require("node:url");
// Standalone or private Easelect is decided by the one shared project-folder rule.
const { isEmbeddedEaselectApplication } = require("../lib/filterest_project_boundary.cjs");

const localHostnames = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const nativeDevelopmentPortsFile = path.join(__dirname, "..", "lib", "native_development_ports.env");

// Reads both native ports once, refusing a missing or malformed file.
function readNativeDevelopmentPorts(file = nativeDevelopmentPortsFile) {
    const values = new Map();
    for (const rawLine of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith("#")) {
            continue;
        }
        const separator = line.indexOf("=");
        if (separator < 1) {
            throw new Error(`${file}: every setting must be KEY=VALUE`);
        }
        values.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim());
    }
    const port = (key) => {
        const value = values.get(key) || "";
        if (!/^[0-9]+$/.test(value) || Number(value) < 1 || Number(value) > 65535) {
            throw new Error(`${file}: ${key} must be a port number`);
        }
        return Number(value);
    };
    return Object.freeze({
        filterest: port("FILTEREST_NATIVE_PORT"),
        easelect: port("EASELECT_NATIVE_PORT"),
    });
}

const nativeDevelopmentPorts = readNativeDevelopmentPorts();

// Maps the kind of checkout to the port its own native development server uses.
function nativeDevelopmentPort(privateEaselect) {
    return privateEaselect ? nativeDevelopmentPorts.easelect : nativeDevelopmentPorts.filterest;
}

// Recognizes only loopback hostnames accepted by guarded local browser tools.
function isLocalFilterestHostname(hostname) {
    return localHostnames.has(hostname);
}

// Selects the product-owned local origin before any explicit test override.
function defaultLocalFilterestBaseUrl(applicationRoot, environment = process.env) {
    const privateEaselect = isEmbeddedEaselectApplication(applicationRoot, environment);
    return `https://localhost:${nativeDevelopmentPort(privateEaselect)}`;
}

// Resolves and validates the one local HTTPS origin used by browser tooling.
function resolveLocalFilterestBaseUrl({
    applicationRoot = ".",
    environment = process.env,
} = {}) {
    const embeddedEaselect = isEmbeddedEaselectApplication(applicationRoot, environment);
    const filterestTarget = String(environment.FILTEREST_E2E_BASE_URL || "").trim();
    const easelectCompatibilityTarget = embeddedEaselect
        ? String(environment.EASELECT_E2E_BASE_URL || "").trim()
        : "";
    const configured = filterestTarget || easelectCompatibilityTarget;
    const rawUrl = configured || defaultLocalFilterestBaseUrl(applicationRoot, environment);
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
exports.nativeDevelopmentPort = nativeDevelopmentPort;
exports.readNativeDevelopmentPorts = readNativeDevelopmentPorts;
exports.isLocalFilterestHostname = isLocalFilterestHostname;
exports.defaultLocalFilterestBaseUrl = defaultLocalFilterestBaseUrl;
exports.resolveLocalFilterestBaseUrl = resolveLocalFilterestBaseUrl;
exports.localAllowedHostsForBaseUrl = localAllowedHostsForBaseUrl;
