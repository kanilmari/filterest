// test_runtime_paths.mjs - Canonical paths for mutable public test artifacts.
// Keeps reports, screenshots, traces, registries, and browser auth state outside app/.
// Easelect may point the same public tools at its private artifact area with one override.

import path from "node:path";
import { fileURLToPath } from "node:url";

export const FILTEREST_TEST_RUNTIME_ROOT_ENV = "FILTEREST_TEST_RUNTIME_ROOT";

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultApplicationRoot = path.resolve(moduleDirectory, "../..");

function isWithin(candidatePath, parentPath) {
    const relative = path.relative(parentPath, candidatePath);
    return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
}

export function resolveFilterestProductRoot(applicationRoot = defaultApplicationRoot) {
    const resolvedApplicationRoot = path.resolve(applicationRoot);
    return path.basename(resolvedApplicationRoot) === "app"
        ? path.dirname(resolvedApplicationRoot)
        : resolvedApplicationRoot;
}

export function resolveFilterestTestRuntimeRoot({
    applicationRoot = defaultApplicationRoot,
    environment = process.env,
} = {}) {
    const resolvedApplicationRoot = path.resolve(applicationRoot);
    const productRoot = resolveFilterestProductRoot(resolvedApplicationRoot);
    const configuredRoot = String(environment[FILTEREST_TEST_RUNTIME_ROOT_ENV] || "").trim();
    const runtimeRoot = configuredRoot
        ? path.resolve(productRoot, configuredRoot)
        : path.join(productRoot, "data", "testing");

    if (isWithin(runtimeRoot, resolvedApplicationRoot)) {
        throw new Error(
            `${FILTEREST_TEST_RUNTIME_ROOT_ENV} must resolve outside the immutable app directory: `
            + `${resolvedApplicationRoot}`,
        );
    }
    return runtimeRoot;
}

export function resolveFilterestTestRuntimePaths(options = {}) {
    const root = resolveFilterestTestRuntimeRoot(options);
    const authDirectory = path.join(root, "e2e", ".auth");
    return Object.freeze({
        root,
        authDirectory,
        authStorageState: path.join(authDirectory, "user.json"),
        artifactRunRegistry: path.join(authDirectory, "artifact-runs"),
        playwrightReport: path.join(root, "playwright-report"),
        playwrightResults: path.join(root, "test-results"),
        visualResults: path.join(root, "test-results-visual"),
        visualGuardian: path.join(root, "test-results", "visual_guardian"),
        humanQa: path.join(root, "human_qa"),
        aiAcceptance: path.join(root, "human_qa", "ai_acceptance"),
        computerUseAcceptance: path.join(root, "human_qa", "computer_use"),
        browserAudits: path.join(root, "browser_audits"),
    });
}
