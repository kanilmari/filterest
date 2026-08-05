// stable_api_inventory.test.js
// Verifies the typed stable route inventory that sits beside the generic endpoint router.
// Bridges the audited allowlist and the dynamic-route exclusions with deterministic assertions.
// Exists to keep the stable API island scope honest as Phase B route typing expands.

import { describe, expect, test } from 'vitest';
import backendRouteManifest from '../../generated/backend_route_manifest.json' with { type: 'json' };
import {
    ENDPOINT_ROUTE_NAMES,
    EXPLICIT_ENDPOINT_ROUTES,
    EXPLICIT_ENDPOINT_ROUTE_NAMES,
    MANIFEST_BACKED_ENDPOINT_ROUTE_HANDLERS,
    MANIFEST_BACKED_ENDPOINT_ROUTE_NAMES,
    getEndpointUrl,
} from '../pipeline/api_pipeline.js';

import {
    CLASSIFIED_ROUTE_NAMES,
    DYNAMIC_ROUTE_NAMES,
    STABLE_CANDIDATE_ROUTE_NAMES,
    getStableCandidateRouteDescriptor,
    TYPED_STABLE_ROUTE_NAMES,
    getTypedStableRouteDescriptor,
    isTypedStableRoute,
} from './stable_api_inventory.js';

describe('stable_api_inventory', () => {
    test('marks the current auth and maintenance island as typed stable', () => {
        expect(TYPED_STABLE_ROUTE_NAMES).toEqual(expect.arrayContaining([
            'fetchAuthModes',
            'fetchUserPermissions',
            'fkCacheTriggers',
            'fkCacheRefresh',
        ]));
        expect(isTypedStableRoute('fetchAuthModes')).toBe(true);
        expect(isTypedStableRoute('fkCacheRefresh')).toBe(true);
    });

    test('keeps dataset-shaped CRUD routes outside the typed island', () => {
        expect(DYNAMIC_ROUTE_NAMES).toEqual(expect.arrayContaining([
            'getResults',
            'fetchDynamicChildren',
            'datasetAliases',
            'datasetColumns',
            'updateRow',
            'createDataset',
            'getTaskTodoProgress',
        ]));
        expect(isTypedStableRoute('getResults')).toBe(false);
        expect(isTypedStableRoute('updateRow')).toBe(false);
    });

    test('returns a descriptor for typed stable routes only', () => {
        expect(getTypedStableRouteDescriptor('fetchUserPermissions')).toMatchObject({
            handlerName: 'auth.UserPermissionsHandler',
            backendPath: '/api/user-permissions',
            accessProfile: 'login_only',
            methods: ['GET'],
            methodSource: 'explicit_stable_contract',
            responseShape: 'UserPermissionsResponse',
        });
        expect(getTypedStableRouteDescriptor('getResults')).toBeNull();
    });

    test('returns manifest-backed descriptors for stable candidate routes', () => {
        expect(STABLE_CANDIDATE_ROUTE_NAMES).toEqual(expect.arrayContaining([
            'adminVersionInfo',
            'getDatasetAliasManagement',
            'saveDatasetAliasManagement',
            'getDatasetHeaderConfig',
            'saveDatasetHeaderConfig',
            'listColumnViewPresets',
            'checkJsonColumns',
        ]));

        expect(getStableCandidateRouteDescriptor('saveDatasetAliasManagement')).toMatchObject({
            handlerName: 'router.SaveDatasetAliasManagementHandler',
            backendPath: '/api/dataset-alias-management/save',
            accessProfile: 'admin',
            methods: ['POST'],
            methodSource: 'explicit_stable_contract',
            availableScenarios: ['production', 'development', 'api_language'],
        });

        expect(getStableCandidateRouteDescriptor('adminVersionInfo')).toMatchObject({
            handlerName: 'router.adminVersionInfoHandler',
            backendPath: '/api/admin/version-info',
            accessProfile: 'admin',
            methods: ['GET'],
            methodSource: 'explicit_stable_contract',
        });

        expect(getStableCandidateRouteDescriptor('saveDatasetHeaderConfig')).toMatchObject({
            handlerName: 'system_table_tools.SaveDatasetHeaderConfigHandler',
            backendPath: '/api/dataset-header-config/save',
            accessProfile: 'admin',
            methods: ['POST'],
            methodSource: 'explicit_stable_contract',
            availableScenarios: ['production', 'development', 'api_language'],
        });

        expect(getStableCandidateRouteDescriptor('checkJsonColumns')).toMatchObject({
            handlerName: 'devtools.CheckJsonInTextColumnsHandler',
            backendPath: '/api/check-json-columns',
            accessProfile: 'admin',
            methods: [],
            methodSource: null,
            availableScenarios: ['development'],
        });
    });

    test('keeps manifest-backed stable inventory paths aligned with api_pipeline', () => {
        const manifestBackedRouteNames = [
            ...TYPED_STABLE_ROUTE_NAMES,
            ...STABLE_CANDIDATE_ROUTE_NAMES,
        ];

        for (const routeName of manifestBackedRouteNames) {
            const descriptor = getTypedStableRouteDescriptor(routeName) || getStableCandidateRouteDescriptor(routeName);

            expect(descriptor, `missing manifest-backed descriptor for ${routeName}`).not.toBeNull();
            expect(getEndpointUrl(routeName)).toBe(descriptor.backendPath);
        }
    });

    test('keeps api_pipeline manifest-backed routes aligned with the backend manifest', () => {
        const manifestByHandlerName = new Map(
            backendRouteManifest.routes.map((routeDescriptor) => [
                routeDescriptor.handler_name,
                routeDescriptor,
            ])
        );
        const endpointRouteNames = new Set(ENDPOINT_ROUTE_NAMES);
        const explicitManifestOverlap = MANIFEST_BACKED_ENDPOINT_ROUTE_NAMES.filter(
            (routeName) => EXPLICIT_ENDPOINT_ROUTE_NAMES.includes(routeName)
        );

        expect(explicitManifestOverlap).toEqual([]);
        expect(new Set([
            ...MANIFEST_BACKED_ENDPOINT_ROUTE_NAMES,
            ...EXPLICIT_ENDPOINT_ROUTE_NAMES,
        ])).toEqual(endpointRouteNames);
        expect(EXPLICIT_ENDPOINT_ROUTES).toEqual({
            getIntelligentResultsStream: '/api/get-intelligent-results?stream=1',
            fetchConfig: '/config.json',
        });

        for (const [routeName, handlerName] of Object.entries(MANIFEST_BACKED_ENDPOINT_ROUTE_HANDLERS)) {
            const manifestRouteDescriptor = manifestByHandlerName.get(handlerName);

            expect(
                manifestRouteDescriptor,
                `missing backend route manifest entry for ${routeName} (${handlerName})`
            ).toBeDefined();
            expect(getEndpointUrl(routeName)).toBe(manifestRouteDescriptor.path_pattern);
        }
    });

    test('classifies every route in api_pipeline endpoint_map', () => {
        const classifiedRouteNames = new Set(CLASSIFIED_ROUTE_NAMES);
        const missingRouteNames = ENDPOINT_ROUTE_NAMES.filter((routeName) => !classifiedRouteNames.has(routeName));

        expect(missingRouteNames).toEqual([]);
    });
});
