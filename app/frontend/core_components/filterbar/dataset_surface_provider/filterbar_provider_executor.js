// filterbar_provider_executor.js
// Executes the selected dataset-surface provider with a safe standard fallback.
// Bridges registry resolution, provider lifecycle validation, and filterbar DOM assembly.
// Exists to keep extension mechanics out of the main filterbar host and view-specific code.

import {
    validateDatasetSurfaceProviderBuildResult,
} from "./dataset_surface_provider_contract.js";
import {
    resolveDatasetSurfaceProvider,
} from "./dataset_surface_provider_registry.js";
import {
    buildStandardFilterbarProvider,
} from "./standard_filterbar_provider_builder.js";

function removeProviderChildrenAfterFailedBuild(container, existingChildren) {
    for (const childNode of Array.from(container.childNodes)) {
        if (!existingChildren.has(childNode)) {
            childNode.remove();
        }
    }
}

/**
 * Builds filterbar content through one explicitly selected provider.
 * Between generic host inputs and provider-owned or standard DOM composition.
 * Exists to centralize capability gates, lifecycle ownership, and failure fallback.
 */
export function executeDatasetSurfaceFilterbarProvider({
    container,
    filterbarOptions,
    standardContentBuilder,
}) {
    const standardProvider = buildStandardFilterbarProvider(
        standardContentBuilder
    );
    const providerResolution = resolveDatasetSurfaceProvider({
        requestedProviderKey: filterbarOptions.surfaceProviderKey,
        availableCapabilityKeys: filterbarOptions.surfaceCapabilityKeys,
        fallbackProvider: standardProvider,
    });
    const selectedProvider = providerResolution.provider;
    const existingChildren = new Set(container.childNodes);
    const nestedStandardBuildResults = [];
    const surfaceCapabilityKeys = Array.isArray(
        filterbarOptions.surfaceCapabilityKeys
    )
        ? Object.freeze([...filterbarOptions.surfaceCapabilityKeys])
        : Object.freeze([]);
    const surfaceContext = Object.freeze({
        datasetName: filterbarOptions.tableName,
        datasetUID: filterbarOptions.tableUID,
        viewKey: filterbarOptions.currentView,
        capabilityKeys: surfaceCapabilityKeys,
    });
    const providerInvocation = Object.freeze({
        container,
        surfaceContext,
        filterbarOptions,
        buildStandardContent: (optionOverrides = {}) => {
            const nestedBuildResult = standardContentBuilder(container, {
                ...filterbarOptions,
                ...optionOverrides,
            });
            nestedStandardBuildResults.push(nestedBuildResult);
            return nestedBuildResult;
        },
    });

    try {
        const buildResult = validateDatasetSurfaceProviderBuildResult(
            selectedProvider.buildFilterbarContent(providerInvocation)
        );
        container.dataset.filterbarProviderResolution = providerResolution.reason;
        container.dataset.filterbarProviderKey = selectedProvider.providerKey;
        container.dataset.filterbarMode = selectedProvider.filterbarMode;
        return buildResult;
    } catch (error) {
        if (selectedProvider === standardProvider) {
            throw error;
        }
        nestedStandardBuildResults.forEach((nestedBuildResult) => {
            nestedBuildResult.destroy?.();
        });
        removeProviderChildrenAfterFailedBuild(container, existingChildren);
        console.error(
            `dataset-surface provider failed; using standard filterbar: ${selectedProvider.providerKey}`,
            error
        );
        const fallbackBuildResult = validateDatasetSurfaceProviderBuildResult(
            standardProvider.buildFilterbarContent(providerInvocation)
        );
        container.dataset.filterbarProviderResolution = "provider-build-failed";
        container.dataset.filterbarProviderKey = standardProvider.providerKey;
        container.dataset.filterbarMode = standardProvider.filterbarMode;
        return fallbackBuildResult;
    }
}
