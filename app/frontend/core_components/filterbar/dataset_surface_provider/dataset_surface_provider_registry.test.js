// dataset_surface_provider_registry.test.js
// Verifies explicit provider selection, capability gates, and safe fallback behavior.
// Bridges registered extensions with the provider chosen for one dataset surface.
// Exists to prevent table-name inference or missing capabilities from activating private UI.

import { describe, expect, test, vi } from "vitest";
import { defineDatasetSurfaceProvider } from "./dataset_surface_provider_contract.js";
import {
    getRegisteredDatasetSurfaceProvider,
    registerDatasetSurfaceProvider,
    resolveDatasetSurfaceProvider,
} from "./dataset_surface_provider_registry.js";
import { buildStandardFilterbarProvider } from "./standard_filterbar_provider_builder.js";

function buildProvider(providerKey, requiredCapabilityKeys = []) {
    return defineDatasetSurfaceProvider({
        providerKey,
        requiredCapabilityKeys,
        buildFilterbarContent: vi.fn(() => ({ destroy: vi.fn() })),
    });
}

describe("dataset surface provider registry", () => {
    test("rejects lookalike objects that bypass the contract definition", () => {
        expect(() => registerDatasetSurfaceProvider({
            providerKey: "timeline",
            contractVersion: 1,
            requiredCapabilityKeys: [],
            buildFilterbarContent: vi.fn(),
        })).toThrow("does not satisfy");
    });

    test("selects a registered provider only after an explicit capable request", () => {
        const fallbackProvider = buildStandardFilterbarProvider(vi.fn());
        const provider = buildProvider("timeline", ["dataset.timeline"]);
        const unregisterProvider = registerDatasetSurfaceProvider(provider);

        expect(resolveDatasetSurfaceProvider({ fallbackProvider }).reason)
            .toBe("no-provider-requested");
        expect(resolveDatasetSurfaceProvider({
            requestedProviderKey: "timeline",
            fallbackProvider,
        }).reason).toBe("required-capability-missing");

        const selected = resolveDatasetSurfaceProvider({
            requestedProviderKey: "timeline",
            availableCapabilityKeys: ["dataset.timeline"],
            fallbackProvider,
        });
        expect(selected.reason).toBe("provider-selected");
        expect(selected.provider).toBe(provider);

        unregisterProvider();
        expect(getRegisteredDatasetSurfaceProvider("timeline")).toBeNull();
    });

    test("falls back when a requested provider is not registered", () => {
        const fallbackProvider = buildStandardFilterbarProvider(vi.fn());
        const resolution = resolveDatasetSurfaceProvider({
            requestedProviderKey: "missing",
            availableCapabilityKeys: ["dataset.timeline"],
            fallbackProvider,
        });

        expect(resolution.provider).toBe(fallbackProvider);
        expect(resolution.reason).toBe("provider-not-registered");
    });

    test("rejects duplicate provider keys without replacing the first provider", () => {
        const provider = buildProvider("timeline");
        const unregisterProvider = registerDatasetSurfaceProvider(provider);

        expect(() => registerDatasetSurfaceProvider(buildProvider("timeline")))
            .toThrow("already registered");
        expect(getRegisteredDatasetSurfaceProvider("timeline")).toBe(provider);

        unregisterProvider();
    });
});
