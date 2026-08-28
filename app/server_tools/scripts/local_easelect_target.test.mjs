// local_easelect_target.test.mjs
// Verifies local browser target resolution and credential-safe URL handling.
// Bridges standalone defaults, explicit operator targets, and browser-test configuration.
// Exists so tests cannot silently target an unsafe or Easelect-specific endpoint.
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import os from "node:os";
import path from "node:path";

import {
    addTargetHostToAllowedHosts,
    authStatePathForTarget,
    defaultLocalFilterestBaseUrl,
    isLocalEaselectUrl,
    localAllowedHostsForBaseUrl,
    resolveLocalFilterestBaseUrl,
    slugifyAuthStateHost,
} from "./local_easelect_target.mjs";

const filterestRoot = "/repo/filterest/app";
const authDirectory = "/repo/filterest/data/testing/e2e/.auth";
const nativeAuthState = path.join(authDirectory, "user.json");

test("isLocalEaselectUrl accepts local Easelect-like targets on any local port", () => {
    assert.equal(isLocalEaselectUrl("https://localhost:8082/service_catalog"), true);
    assert.equal(isLocalEaselectUrl("https://localhost:8095/app_cloud_services"), true);
    assert.equal(isLocalEaselectUrl("https://127.0.0.1:18182/system_about"), true);
    assert.equal(isLocalEaselectUrl("https://[::1]:8095/system_about"), true);
    assert.equal(isLocalEaselectUrl("https://example.com/app_cloud_services"), false);
    assert.equal(isLocalEaselectUrl("file:///tmp/report.html"), false);
});

test("structural local target defaults separate standalone Filterest from embedded Easelect", () => {
    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "filterest-local-target-"));
    try {
        const standaloneApp = path.join(fixtureRoot, "standalone", "app");
        const embeddedRoot = path.join(fixtureRoot, "easelect");
        const embeddedApp = path.join(embeddedRoot, "filterest", "app");
        const markerOnlyRoot = path.join(fixtureRoot, "marker-only");
        const markerOnlyApp = path.join(markerOnlyRoot, "filterest", "app");
        const invalidMarkerRoot = path.join(fixtureRoot, "invalid-marker");
        const invalidMarkerApp = path.join(invalidMarkerRoot, "filterest", "app");
        fs.mkdirSync(standaloneApp, { recursive: true });
        fs.mkdirSync(embeddedApp, { recursive: true });
        fs.mkdirSync(markerOnlyApp, { recursive: true });
        fs.mkdirSync(invalidMarkerApp, { recursive: true });
        fs.mkdirSync(path.join(embeddedRoot, ".git"));
        fs.writeFileSync(path.join(embeddedRoot, "VERSION_EASELECT"), "9.0.0\n");
        fs.writeFileSync(path.join(markerOnlyRoot, "VERSION_EASELECT"), "9.0.0\n");
        fs.mkdirSync(path.join(invalidMarkerRoot, ".git"));
        fs.mkdirSync(path.join(invalidMarkerRoot, "VERSION_EASELECT"));

        assert.equal(defaultLocalFilterestBaseUrl(standaloneApp), "https://localhost:8100");
        assert.equal(defaultLocalFilterestBaseUrl(embeddedApp), "https://localhost:8082");
        assert.equal(defaultLocalFilterestBaseUrl(markerOnlyApp), "https://localhost:8100");
        assert.equal(defaultLocalFilterestBaseUrl(invalidMarkerApp), "https://localhost:8100");
        assert.equal(
            resolveLocalFilterestBaseUrl({ applicationRoot: standaloneApp, environment: {} }),
            "https://localhost:8100",
        );
        assert.equal(
            resolveLocalFilterestBaseUrl({ applicationRoot: embeddedApp, environment: {} }),
            "https://localhost:8082",
        );
    } finally {
        fs.rmSync(fixtureRoot, { recursive: true, force: true });
    }
});

test("Filterest target overrides ambient state and legacy target applies only to embedded Easelect", () => {
    assert.equal(
        resolveLocalFilterestBaseUrl({
            applicationRoot: filterestRoot,
            environment: {
                FILTEREST_E2E_BASE_URL: "https://127.0.0.1:8199/path",
                EASELECT_E2E_BASE_URL: "https://localhost:8082",
            },
        }),
        "https://127.0.0.1:8199",
    );
    assert.equal(
        resolveLocalFilterestBaseUrl({
            applicationRoot: filterestRoot,
            environment: { EASELECT_E2E_BASE_URL: "https://127.0.0.1:8188/path" },
        }),
        "https://localhost:8100",
    );
    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "easelect-local-target-"));
    try {
        const embeddedApp = path.join(fixtureRoot, "easelect", "filterest", "app");
        fs.mkdirSync(embeddedApp, { recursive: true });
        fs.mkdirSync(path.join(fixtureRoot, "easelect", ".git"));
        fs.writeFileSync(
            path.join(fixtureRoot, "easelect", "VERSION_EASELECT"),
            "9.0.0\n",
        );
        assert.equal(
            resolveLocalFilterestBaseUrl({
                applicationRoot: embeddedApp,
                environment: { EASELECT_E2E_BASE_URL: "https://127.0.0.1:8188/path" },
            }),
            "https://127.0.0.1:8188",
        );
    } finally {
        fs.rmSync(fixtureRoot, { recursive: true, force: true });
    }
    for (const invalidUrl of [
        "http://localhost:8100",
        "https://example.com:8100",
        "https://user:secret@localhost:8100",
    ]) {
        assert.throws(
            () => resolveLocalFilterestBaseUrl({
                applicationRoot: filterestRoot,
                environment: { FILTEREST_E2E_BASE_URL: invalidUrl },
            }),
            /credential-free local HTTPS origin/,
        );
    }
});

test("authStatePathForTarget treats standalone 8100 as native and splits other ports", () => {
    assert.equal(
        authStatePathForTarget(
            filterestRoot,
            "https://localhost:8100/service_catalog",
            nativeAuthState,
            {},
        ),
        nativeAuthState,
    );
    assert.equal(
        authStatePathForTarget(
            filterestRoot,
            "https://localhost:8082/service_catalog",
            nativeAuthState,
            {},
        ),
        path.join(authDirectory, "user-localhost-8082.json"),
    );
    assert.equal(
        authStatePathForTarget(
            filterestRoot,
            "https://localhost:8095/app_cloud_services",
            nativeAuthState,
            {},
        ),
        path.join(authDirectory, "user-localhost-8095.json"),
    );
    assert.equal(
        authStatePathForTarget(filterestRoot, "https://127.0.0.1:18182/system_about", nativeAuthState),
        path.join(authDirectory, "user-127-0-0-1-18182.json"),
    );
});

test("addTargetHostToAllowedHosts allows the explicit browser target host once", () => {
    const allowedHosts = ["localhost:8082"];
    addTargetHostToAllowedHosts(allowedHosts, "https://localhost:8095/app_cloud_services");
    addTargetHostToAllowedHosts(allowedHosts, "https://localhost:8095/app_cloud_services");
    assert.deepEqual(allowedHosts, ["localhost:8082", "localhost:8095"]);
});

test("localAllowedHostsForBaseUrl keeps the selected port on every loopback form", () => {
    assert.deepEqual(localAllowedHostsForBaseUrl("https://localhost:8100"), [
        "localhost:8100",
        "127.0.0.1:8100",
        "[::1]:8100",
    ]);
});

test("slugifyAuthStateHost removes URL punctuation from auth-state names", () => {
    assert.equal(slugifyAuthStateHost("[::1]:8095"), "1-8095");
    assert.equal(slugifyAuthStateHost("LOCALHOST:8095"), "localhost-8095");
});
