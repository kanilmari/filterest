// backend_route_manifest_reader.js
// Reads the generated backend route manifest for frontend route registries.
// Bridges backend_route_manifest.json and logical frontend endpoint names.
// Exists so frontend routes can derive backend paths from handler names without duplicating URLs.

// The native Go-served frontend loads ES modules directly in the browser, so the
// generated manifest uses an explicit JSON-module import instead of Vite-only transforms.
import backendRouteManifest from '../../generated/backend_route_manifest.json' with { type: 'json' };

const BACKEND_ROUTE_MANIFEST_BY_HANDLER = Object.freeze(
    Object.fromEntries(
        backendRouteManifest.routes.map((routeDescriptor) => [routeDescriptor.handler_name, routeDescriptor])
    )
);

const PREFERRED_BACKEND_ROUTE_SCENARIO_ORDER = Object.freeze([
    ...backendRouteManifest.scenario_order,
]);

/**
 * Returns the manifest entry for a backend handler.
 *
 * @param {string} handlerName - Fully qualified backend handler name from the route manifest.
 * @returns {any}
 */
export function getBackendRouteManifestEntry(handlerName) {
    const manifestRouteDescriptor = BACKEND_ROUTE_MANIFEST_BY_HANDLER[handlerName] || null;
    if (!manifestRouteDescriptor) {
        throw new Error(`Missing backend route manifest entry for handler "${handlerName}"`);
    }
    return manifestRouteDescriptor;
}

/**
 * Returns the backend path pattern registered for a handler.
 *
 * @param {string} handlerName - Fully qualified backend handler name from the route manifest.
 * @returns {string}
 */
export function getBackendRoutePathByHandler(handlerName) {
    return getBackendRouteManifestEntry(handlerName).path_pattern;
}

/**
 * Selects the preferred scenario metadata for a route manifest entry.
 *
 * @param {{ handler_name: string, scenarios: readonly any[] }} manifestRouteDescriptor
 * @returns {any}
 */
export function getPreferredBackendRouteScenario(manifestRouteDescriptor) {
    for (const scenarioName of PREFERRED_BACKEND_ROUTE_SCENARIO_ORDER) {
        const matchingScenarioDescriptor = manifestRouteDescriptor.scenarios.find(
            (scenarioDescriptor) => scenarioDescriptor.name === scenarioName
        );
        if (matchingScenarioDescriptor) {
            return matchingScenarioDescriptor;
        }
    }

    const firstScenarioDescriptor = manifestRouteDescriptor.scenarios[0] || null;
    if (!firstScenarioDescriptor) {
        throw new Error(`Route "${manifestRouteDescriptor.handler_name}" has no manifest scenarios`);
    }
    return firstScenarioDescriptor;
}
