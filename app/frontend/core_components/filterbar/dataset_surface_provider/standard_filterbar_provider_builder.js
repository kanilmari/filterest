// standard_filterbar_provider_builder.js
// Adapts Filterest's existing full filterbar builder to the dataset-surface provider contract.
// Bridges the generic provider registry with the behavior-preserving standard filterbar path.
// Exists so the current implementation is an explicit fallback provider rather than a host special case.

import {
    DATASET_SURFACE_FILTERBAR_MODES,
    defineDatasetSurfaceProvider,
} from "./dataset_surface_provider_contract.js";

export const STANDARD_FILTERBAR_PROVIDER_KEY = "standard";

/**
 * Creates the built-in provider around the existing standard content builder.
 * Between the provider invocation shape and the legacy-compatible builder arguments.
 * Exists to preserve current behavior while specialized providers use the same host seam.
 */
export function buildStandardFilterbarProvider(standardContentBuilder) {
    if (typeof standardContentBuilder !== "function") {
        throw new TypeError("standardContentBuilder must be a function");
    }

    return defineDatasetSurfaceProvider({
        providerKey: STANDARD_FILTERBAR_PROVIDER_KEY,
        filterbarMode: DATASET_SURFACE_FILTERBAR_MODES.FULL,
        buildFilterbarContent: ({ container, filterbarOptions }) => (
            standardContentBuilder(container, filterbarOptions)
        ),
    });
}
