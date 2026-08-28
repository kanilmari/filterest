// dataset_surface_provider_contract.js
// Defines the versioned frontend contract for dataset-specific filterbar providers.
// Bridges generic dataset metadata with optional specialized filterbar composition code.
// Exists so specialized views can extend Filterest without hardcoded view checks in the filterbar host.

export const DATASET_SURFACE_PROVIDER_CONTRACT_VERSION = 1;

export const DATASET_SURFACE_FILTERBAR_MODES = Object.freeze({
    FULL: "full",
    REDUCED: "reduced",
    CUSTOM: "custom",
});

const PROVIDER_KEY_PATTERN = /^[a-z][a-z0-9._-]*$/;
const CAPABILITY_KEY_PATTERN = /^[a-z][a-z0-9._:-]*$/;
const FILTERBAR_MODES = new Set(Object.values(DATASET_SURFACE_FILTERBAR_MODES));
const definedDatasetSurfaceProviders = new WeakSet();

function normalizeContractKey(value, label, pattern) {
    const normalizedValue = typeof value === "string" ? value.trim() : "";
    if (!normalizedValue || !pattern.test(normalizedValue)) {
        throw new TypeError(`${label} must be a stable lowercase key`);
    }
    return normalizedValue;
}

function normalizeRequiredCapabilityKeys(requiredCapabilityKeys) {
    if (!Array.isArray(requiredCapabilityKeys)) {
        throw new TypeError("requiredCapabilityKeys must be an array");
    }

    const normalizedKeys = requiredCapabilityKeys.map((capabilityKey) => (
        normalizeContractKey(
            capabilityKey,
            "required capability key",
            CAPABILITY_KEY_PATTERN
        )
    ));
    if (new Set(normalizedKeys).size !== normalizedKeys.length) {
        throw new TypeError("requiredCapabilityKeys must not contain duplicates");
    }
    return Object.freeze(normalizedKeys);
}

/**
 * Defines one immutable dataset-surface provider.
 * Between a server-selected provider key and the generic filterbar host.
 * Exists to validate extension code before it can participate in dataset rendering.
 */
export function defineDatasetSurfaceProvider({
    providerKey,
    contractVersion = DATASET_SURFACE_PROVIDER_CONTRACT_VERSION,
    requiredCapabilityKeys = [],
    filterbarMode = DATASET_SURFACE_FILTERBAR_MODES.CUSTOM,
    buildFilterbarContent,
}) {
    const normalizedProviderKey = normalizeContractKey(
        providerKey,
        "providerKey",
        PROVIDER_KEY_PATTERN
    );
    if (contractVersion !== DATASET_SURFACE_PROVIDER_CONTRACT_VERSION) {
        throw new TypeError(
            `unsupported dataset-surface provider contract version: ${contractVersion}`
        );
    }
    if (!FILTERBAR_MODES.has(filterbarMode)) {
        throw new TypeError(`unsupported filterbarMode: ${filterbarMode}`);
    }
    if (typeof buildFilterbarContent !== "function") {
        throw new TypeError("buildFilterbarContent must be a function");
    }

    const provider = Object.freeze({
        providerKey: normalizedProviderKey,
        contractVersion,
        requiredCapabilityKeys: normalizeRequiredCapabilityKeys(
            requiredCapabilityKeys
        ),
        filterbarMode,
        buildFilterbarContent,
    });
    definedDatasetSurfaceProviders.add(provider);
    return provider;
}

export function isDefinedDatasetSurfaceProvider(provider) {
    return Boolean(
        provider
        && typeof provider === "object"
        && definedDatasetSurfaceProviders.has(provider)
    );
}

/**
 * Validates the lifecycle result returned after a provider builds filterbar content.
 * Between provider-owned DOM assembly and the host-owned teardown lifecycle.
 * Exists so a malformed extension fails before the host loses cleanup ownership.
 */
export function validateDatasetSurfaceProviderBuildResult(buildResult) {
    if (
        !buildResult
        || typeof buildResult !== "object"
        || typeof buildResult.then === "function"
    ) {
        throw new TypeError("dataset-surface provider must return a lifecycle object");
    }
    if (typeof buildResult.destroy !== "function") {
        throw new TypeError("dataset-surface provider destroy must be a function");
    }
    return buildResult;
}
