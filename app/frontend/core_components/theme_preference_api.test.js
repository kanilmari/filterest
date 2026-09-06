// theme_preference_api.test.js
// Verifies account theme reads and writes use the shared authenticated endpoint pipeline.
// Bridges semantic theme choices with the self-scoped visual-preference API.
// Exists so browser persistence cannot regress to an unvalidated generic database write.

import { beforeEach, describe, expect, test, vi } from 'vitest';

const { endpointRouterMock, registerEndpointRouteMock } = vi.hoisted(() => ({
    endpointRouterMock: vi.fn(),
    registerEndpointRouteMock: vi.fn(),
}));

vi.mock('./endpoints/endpoint_router.js', () => ({ endpoint_router: endpointRouterMock }));
vi.mock('./pipeline/api_pipeline.js', () => ({ registerEndpointRoute: registerEndpointRouteMock }));

import { fetchUserVisualPreference, saveUserVisualPreference } from './theme_preference_api.js';

beforeEach(() => vi.clearAllMocks());

describe('theme preference API', () => {
    test('loads the current account preference', async () => {
        endpointRouterMock.mockResolvedValue({ theme_mode: 'system' });

        await fetchUserVisualPreference();

        expect(endpointRouterMock).toHaveBeenCalledWith('userVisualPreference', {
            suppressAuthRedirect: true,
        });
    });

    test('patches only the semantic theme choice', async () => {
        endpointRouterMock.mockResolvedValue({ theme_mode: 'dark' });

        await saveUserVisualPreference('dark');

        expect(endpointRouterMock).toHaveBeenCalledWith('userVisualPreference', {
            method: 'PATCH',
            body_data: { theme_mode: 'dark' },
            suppressAuthRedirect: true,
        });
    });
});
