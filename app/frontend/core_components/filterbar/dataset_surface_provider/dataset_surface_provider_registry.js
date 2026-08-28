// dataset_surface_provider_registry.js
// Registers and resolves optional dataset-surface filterbar providers.
// Bridges explicit server-owned capability metadata with frontend provider implementations.
// Exists to keep specialized view selection out of the generic filterbar host.

import {
    isDefinedDatasetSurfaceProvider,
} from "./dataset_surface_provider_contract.js";

const registeredDatasetSurfaceProviders = new Map();

function isCompatibleProvider(provider) {
    return isDefinedDatasetSurfaceProvider(provider);
}

function normalizeAvailableCapabilityKeys(availableCapabilityKeys) {
    if (!Array.isArray(availableCapabilityKeys)) {
        return new Set();
    }
    return new Set(
        availableCapabilityKeys
            .filter((capabilityKey) => typeof capabilityKey === "string")
            .map((capabilityKey) => capabilityKey.trim())
            .filter(Boolean)
    );
}

function providerHasRequiredCapabilities(provider, availableCapabilityKeys) {
    const availableCapabilities = normalizeAvailableCapabilityKeys(
        availableCapabilityKeys
    );
    return provider.requiredCapabilityKeys.every((requiredCapabilityKey) => (
        availableCapabilities.has(requiredCapabilityKey)
    ));
}

/**
 * Registers one already validated provider and returns its cleanup callback.
 * Between optional extension loading and later dataset filterbar resolution.
 * Exists so private or project-specific modules can plug in without editing core host code.
 */
export function registerDatasetSurfaceProvider(provider) {
    if (!isCompatibleProvider(provider)) {
        throw new TypeError("provider does not satisfy the dataset-surface contract");
    }
    if (registeredDatasetSurfaceProviders.has(provider.providerKey)) {
        throw new Error(
            `dataset-surface provider is already registered: ${provider.providerKey}`
        );
    }

    registeredDatasetSurfaceProviders.set(provider.providerKey, provider);
    return () => {
        if (registeredDatasetSurfaceProviders.get(provider.providerKey) === provider) {
            registeredDatasetSurfaceProviders.delete(provider.providerKey);
        }
    };
}

/**
 * Resolves an explicitly requested provider or safely returns the built-in fallback.
 * Between server-owned dataset capabilities and the filterbar content builder.
 * Exists to fail closed when a provider is absent, incompatible, or lacks capabilities.
 */
export function resolveDatasetSurfaceProvider({
    requestedProviderKey = "",
    availableCapabilityKeys = [],
    fallbackProvider,
} = {}) {
    if (!isCompatibleProvider(fallbackProvider)) {
        throw new TypeError("fallbackProvider must satisfy the dataset-surface contract");
    }

    const normalizedRequestedKey = typeof requestedProviderKey === "string"
        ? requestedProviderKey.trim()
        : "";
    if (!normalizedRequestedKey) {
        return Object.freeze({
            provider: fallbackProvider,
            reason: "no-provider-requested",
        });
    }

    const requestedProvider = registeredDatasetSurfaceProviders.get(
        normalizedRequestedKey
    );
    if (!requestedProvider) {
        return Object.freeze({
            provider: fallbackProvider,
            reason: "provider-not-registered",
        });
    }
    if (!providerHasRequiredCapabilities(
        requestedProvider,
        availableCapabilityKeys
    )) {
        return Object.freeze({
            provider: fallbackProvider,
            reason: "required-capability-missing",
        });
    }

    return Object.freeze({
        provider: requestedProvider,
        reason: "provider-selected",
    });
}

export function getRegisteredDatasetSurfaceProvider(providerKey) {
    return registeredDatasetSurfaceProviders.get(providerKey) || null;
}
