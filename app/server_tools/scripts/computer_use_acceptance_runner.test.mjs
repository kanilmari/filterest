import assert from "node:assert/strict";
import test from "node:test";

import {
    buildComputerUseResult,
    createComputerUseRunIdentity,
    keypressSequences,
    normalizeKey,
} from "./computer_use_acceptance_runner.mjs";

test("normalizeKey maps common Computer Use modifier aliases to Playwright names", () => {
    assert.equal(normalizeKey("CTRL"), "Control");
    assert.equal(normalizeKey("cmd"), "Meta");
    assert.equal(normalizeKey("OPTION"), "Alt");
    assert.equal(normalizeKey("SHIFT"), "Shift");
});

test("keypressSequences combines modifier chords into Playwright press strings", () => {
    assert.deepEqual(keypressSequences(["CTRL", "L"]), ["Control+L"]);
    assert.deepEqual(keypressSequences(["CTRL", "SHIFT", "P"]), ["Control+Shift+P"]);
});

test("keypressSequences preserves ordinary sequential keypresses", () => {
    assert.deepEqual(keypressSequences(["Tab", "Enter"]), ["Tab", "Enter"]);
    assert.deepEqual(keypressSequences(["Space"]), [" "]);
});

test("normalizeKey maps navigation aliases to Playwright names", () => {
    assert.equal(normalizeKey("HOME"), "Home");
    assert.equal(normalizeKey("page_down"), "PageDown");
    assert.equal(normalizeKey("left"), "ArrowLeft");
});

test("Computer Use result embeds the same exact source identity as its sidecar", () => {
    const options = {
        ticketId: "0",
        target: "https://localhost:8100/",
        promptProfile: "release-readiness",
        model: "test-model",
        viewport: { width: 1440, height: 900, name: "desktop" },
        checks: ["release identity is visible"],
        goals: ["return a verdict"],
        dryRun: false,
    };
    const head = "313f71876f9e817e356b5bad5e2de38c10440e78";
    const runIdentity = createComputerUseRunIdentity(options, head);
    const result = buildComputerUseResult({
        options,
        outputDir: "/tmp/computer-use-evidence",
        auth: { status: "authenticated" },
        evidence: { actions: [], blockedRequests: [], console: [], pageErrors: [] },
        modelOutcome: {
            stoppedReason: "model_finished",
            finalText: "{}",
            decision: {
                verdict: "pass",
                summary: "passed",
                coveredChecks: [],
                findings: [],
                nextRecommendedMode: "structured",
            },
        },
        finalScreenshot: { path: "/tmp/computer-use-evidence/final.png" },
        startedAt: "2026-08-25T10:00:00.000Z",
        finalUrl: options.target,
        repoRoot: "/tmp/repo",
        runIdentity,
    });

    assert.deepEqual(result.cache, {
        head,
        fingerprint: runIdentity.fingerprint,
    });
    assert.equal(runIdentity.target, options.target);
    assert.equal(runIdentity.profile, "release-readiness");
});
