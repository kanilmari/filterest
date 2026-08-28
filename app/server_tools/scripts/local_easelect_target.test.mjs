import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";

import {
    addTargetHostToAllowedHosts,
    authStatePathForTarget,
    isLocalEaselectUrl,
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

test("authStatePathForTarget keeps native 8082 path and splits non-native local ports", () => {
    assert.equal(
        authStatePathForTarget(filterestRoot, "https://localhost:8082/service_catalog", nativeAuthState),
        nativeAuthState,
    );
    assert.equal(
        authStatePathForTarget(filterestRoot, "https://localhost:8095/app_cloud_services", nativeAuthState),
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

test("slugifyAuthStateHost removes URL punctuation from auth-state names", () => {
    assert.equal(slugifyAuthStateHost("[::1]:8095"), "1-8095");
    assert.equal(slugifyAuthStateHost("LOCALHOST:8095"), "localhost-8095");
});
