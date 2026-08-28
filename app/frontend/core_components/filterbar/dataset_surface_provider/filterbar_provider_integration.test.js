// filterbar_provider_integration.test.js
// Verifies the filterbar host selects capable providers and safely restores standard content.
// Bridges the provider registry with the real createFilterBarContent orchestration seam.
// Exists to prove specialized providers need no hardcoded branch in the generic host.

// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
    cleanupFilterBarBuilderTestDom,
    resetFilterBarBuilderTestDom,
} from "../filter_bar_builder_test_setup.js";

function buildFilterbarOptions(optionOverrides = {}) {
    return {
        tableName: "demo",
        tableUID: "demo_uid",
        columns: ["id"],
        dataTypes: { id: "INTEGER" },
        rowCount: 1,
        hasGeo: false,
        currentView: "card",
        includeOverviewSearch: false,
        ...optionOverrides,
    };
}

describe("filterbar dataset-surface provider integration", () => {
    beforeEach(() => {
        resetFilterBarBuilderTestDom();
    });

    afterEach(() => {
        cleanupFilterBarBuilderTestDom();
    });

    test("uses an explicitly selected provider when its capability is present", async () => {
        const { defineDatasetSurfaceProvider } = await import(
            "./dataset_surface_provider_contract.js"
        );
        const { registerDatasetSurfaceProvider } = await import(
            "./dataset_surface_provider_registry.js"
        );
        const providerBuilder = vi.fn(({ container, surfaceContext }) => {
            const marker = document.createElement("div");
            marker.dataset.testid = "specialized-filterbar";
            marker.dataset.datasetName = surfaceContext.datasetName;
            container.appendChild(marker);
            return { destroy: vi.fn() };
        });
        const provider = defineDatasetSurfaceProvider({
            providerKey: "specialized.timeline",
            requiredCapabilityKeys: ["dataset.timeline"],
            buildFilterbarContent: providerBuilder,
        });
        const unregisterProvider = registerDatasetSurfaceProvider(provider);
        const { createFilterBarContent } = await import("../filter_bar_builder.js");
        const container = document.createElement("div");

        createFilterBarContent(container, buildFilterbarOptions({
            surfaceProviderKey: "specialized.timeline",
            surfaceCapabilityKeys: ["dataset.timeline"],
        }));

        expect(providerBuilder).toHaveBeenCalledTimes(1);
        expect(container.querySelector('[data-testid="specialized-filterbar"]')?.dataset.datasetName)
            .toBe("demo");
        expect(container.dataset.filterbarProviderKey).toBe("specialized.timeline");
        expect(container.dataset.filterbarProviderResolution).toBe("provider-selected");
        expect(container.dataset.filterbarMode).toBe("custom");
        expect(container.querySelector(".dataset-filter-top-grid")).toBeNull();

        unregisterProvider();
    });

    test("uses standard content when the requested capability is absent", async () => {
        const { defineDatasetSurfaceProvider } = await import(
            "./dataset_surface_provider_contract.js"
        );
        const { registerDatasetSurfaceProvider } = await import(
            "./dataset_surface_provider_registry.js"
        );
        const providerBuilder = vi.fn(() => ({ destroy: vi.fn() }));
        const unregisterProvider = registerDatasetSurfaceProvider(
            defineDatasetSurfaceProvider({
                providerKey: "specialized.timeline",
                requiredCapabilityKeys: ["dataset.timeline"],
                buildFilterbarContent: providerBuilder,
            })
        );
        const { createFilterBarContent } = await import("../filter_bar_builder.js");
        const container = document.createElement("div");

        createFilterBarContent(container, buildFilterbarOptions({
            surfaceProviderKey: "specialized.timeline",
            surfaceCapabilityKeys: [],
        }));

        expect(providerBuilder).not.toHaveBeenCalled();
        expect(container.querySelector(".dataset-filter-top-grid")).toBeTruthy();
        expect(container.dataset.filterbarProviderKey).toBe("standard");
        expect(container.dataset.filterbarMode).toBe("full");
        expect(container.dataset.filterbarProviderResolution)
            .toBe("required-capability-missing");

        unregisterProvider();
    });

    test("removes partial provider output before falling back after a build error", async () => {
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
        const { defineDatasetSurfaceProvider } = await import(
            "./dataset_surface_provider_contract.js"
        );
        const { registerDatasetSurfaceProvider } = await import(
            "./dataset_surface_provider_registry.js"
        );
        const unregisterProvider = registerDatasetSurfaceProvider(
            defineDatasetSurfaceProvider({
                providerKey: "specialized.broken",
                requiredCapabilityKeys: ["dataset.broken"],
                buildFilterbarContent: ({ container }) => {
                    const partialOutput = document.createElement("div");
                    partialOutput.dataset.testid = "partial-provider-output";
                    container.appendChild(partialOutput);
                    throw new Error("broken provider");
                },
            })
        );
        const { createFilterBarContent } = await import("../filter_bar_builder.js");
        const container = document.createElement("div");

        createFilterBarContent(container, buildFilterbarOptions({
            surfaceProviderKey: "specialized.broken",
            surfaceCapabilityKeys: ["dataset.broken"],
        }));

        expect(container.querySelector('[data-testid="partial-provider-output"]')).toBeNull();
        expect(container.querySelector(".dataset-filter-top-grid")).toBeTruthy();
        expect(container.dataset.filterbarProviderKey).toBe("standard");
        expect(container.dataset.filterbarMode).toBe("full");
        expect(container.dataset.filterbarProviderResolution).toBe("provider-build-failed");
        expect(consoleError).toHaveBeenCalledTimes(1);

        unregisterProvider();
        consoleError.mockRestore();
    });
});
