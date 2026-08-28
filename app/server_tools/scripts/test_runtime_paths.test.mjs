import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
    resolveFilterestProductRoot,
    resolveFilterestTestRuntimePaths,
    resolveFilterestTestRuntimeRoot,
} from "./test_runtime_paths.mjs";

const applicationRoot = path.resolve("/repo/filterest/app");
const productRoot = path.resolve("/repo/filterest");

test("nested public source defaults all mutable test paths below product data/testing", () => {
    assert.equal(resolveFilterestProductRoot(applicationRoot), productRoot);
    assert.deepEqual(
        resolveFilterestTestRuntimePaths({ applicationRoot, environment: {} }),
        {
            root: path.join(productRoot, "data/testing"),
            authDirectory: path.join(productRoot, "data/testing/e2e/.auth"),
            authStorageState: path.join(productRoot, "data/testing/e2e/.auth/user.json"),
            artifactRunRegistry: path.join(productRoot, "data/testing/e2e/.auth/artifact-runs"),
            playwrightReport: path.join(productRoot, "data/testing/playwright-report"),
            playwrightResults: path.join(productRoot, "data/testing/test-results"),
            visualResults: path.join(productRoot, "data/testing/test-results-visual"),
            visualGuardian: path.join(productRoot, "data/testing/test-results/visual_guardian"),
            humanQa: path.join(productRoot, "data/testing/human_qa"),
            aiAcceptance: path.join(productRoot, "data/testing/human_qa/ai_acceptance"),
            computerUseAcceptance: path.join(productRoot, "data/testing/human_qa/computer_use"),
            browserAudits: path.join(productRoot, "data/testing/browser_audits"),
        },
    );
});

test("one external runtime-root override supports Easelect private artifacts", () => {
    assert.equal(
        resolveFilterestTestRuntimeRoot({
            applicationRoot,
            environment: { FILTEREST_TEST_RUNTIME_ROOT: "/repo/agent_tasks/_artifacts/testing" },
        }),
        path.resolve("/repo/agent_tasks/_artifacts/testing"),
    );
    assert.equal(
        resolveFilterestTestRuntimeRoot({
            applicationRoot,
            environment: { FILTEREST_TEST_RUNTIME_ROOT: "../private-testing" },
        }),
        path.resolve("/repo/private-testing"),
    );
});

test("runtime-root override cannot reintroduce writes below immutable app", () => {
    assert.throws(
        () => resolveFilterestTestRuntimeRoot({
            applicationRoot,
            environment: { FILTEREST_TEST_RUNTIME_ROOT: "app/testing-output" },
        }),
        /must resolve outside the immutable app directory/,
    );
});
