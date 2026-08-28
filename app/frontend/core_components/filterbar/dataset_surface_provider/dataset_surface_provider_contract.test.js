// dataset_surface_provider_contract.test.js
// Verifies provider definitions remain versioned, immutable, and lifecycle-safe.
// Bridges extension declarations with the generic dataset-surface contract validator.
// Exists to prevent malformed specialized providers from entering filterbar rendering.

import { describe, expect, test, vi } from "vitest";
import {
    DATASET_SURFACE_FILTERBAR_MODES,
    DATASET_SURFACE_PROVIDER_CONTRACT_VERSION,
    defineDatasetSurfaceProvider,
    validateDatasetSurfaceProviderBuildResult,
} from "./dataset_surface_provider_contract.js";

describe("dataset surface provider contract", () => {
    test("normalizes and freezes one compatible provider", () => {
        const buildFilterbarContent = vi.fn();
        const provider = defineDatasetSurfaceProvider({
            providerKey: "timeline.compact",
            requiredCapabilityKeys: ["dataset.timeline", "view.timeline"],
            filterbarMode: DATASET_SURFACE_FILTERBAR_MODES.REDUCED,
            buildFilterbarContent,
        });

        expect(provider).toEqual({
            providerKey: "timeline.compact",
            contractVersion: DATASET_SURFACE_PROVIDER_CONTRACT_VERSION,
            requiredCapabilityKeys: ["dataset.timeline", "view.timeline"],
            filterbarMode: "reduced",
            buildFilterbarContent,
        });
        expect(Object.isFrozen(provider)).toBe(true);
        expect(Object.isFrozen(provider.requiredCapabilityKeys)).toBe(true);
    });

    test.each([
        [{ providerKey: "Timeline", buildFilterbarContent: vi.fn() }, "providerKey"],
        [{ providerKey: "timeline", contractVersion: 2, buildFilterbarContent: vi.fn() }, "version"],
        [{ providerKey: "timeline", requiredCapabilityKeys: "dataset.timeline", buildFilterbarContent: vi.fn() }, "array"],
        [{ providerKey: "timeline", requiredCapabilityKeys: ["dataset.timeline", "dataset.timeline"], buildFilterbarContent: vi.fn() }, "duplicates"],
        [{ providerKey: "timeline", filterbarMode: "sidebar-only", buildFilterbarContent: vi.fn() }, "filterbarMode"],
        [{ providerKey: "timeline" }, "buildFilterbarContent"],
    ])("rejects an invalid provider declaration (%s)", (definition, expectedMessage) => {
        expect(() => defineDatasetSurfaceProvider(definition)).toThrow(expectedMessage);
    });

    test("requires providers to return a destroyable lifecycle shape", () => {
        const destroy = vi.fn();
        expect(validateDatasetSurfaceProviderBuildResult({ destroy }))
            .toEqual({ destroy });
        expect(() => validateDatasetSurfaceProviderBuildResult(null))
            .toThrow("lifecycle object");
        expect(() => validateDatasetSurfaceProviderBuildResult(Promise.resolve({ destroy })))
            .toThrow("lifecycle object");
        expect(() => validateDatasetSurfaceProviderBuildResult({}))
            .toThrow("destroy must be a function");
        expect(() => validateDatasetSurfaceProviderBuildResult({ destroy: true }))
            .toThrow("destroy must be a function");
    });
});
