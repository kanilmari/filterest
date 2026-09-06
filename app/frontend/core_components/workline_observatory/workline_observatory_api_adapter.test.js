// workline_observatory_api_adapter.test.js
// Verifies report history stays on the authenticated Observatory board route.
// Bridges one selected workline ID with the shared frontend endpoint pipeline.
// Exists so history browsing cannot silently widen into an unscoped report fetch.

import { beforeEach, describe, expect, test, vi } from 'vitest';

const { endpointRouterMock, registerEndpointRouteMock } = vi.hoisted(() => ({
    endpointRouterMock: vi.fn(),
    registerEndpointRouteMock: vi.fn(),
}));

vi.mock('../endpoints/endpoint_router.js', () => ({ endpoint_router: endpointRouterMock }));
vi.mock('../pipeline/api_pipeline.js', () => ({ registerEndpointRoute: registerEndpointRouteMock }));

import { fetchWorklineObservatoryReportHistory } from './workline_observatory_api_adapter.js';

beforeEach(() => vi.clearAllMocks());

describe('workline observatory API adapter', () => {
    test('fetches and unwraps the bounded history of one selected workline', async () => {
        endpointRouterMock.mockResolvedValue({ workline_id: 34, reports: [{ id: 129 }] });

        await expect(fetchWorklineObservatoryReportHistory(34)).resolves.toEqual([{ id: 129 }]);
        expect(endpointRouterMock).toHaveBeenCalledWith('worklineObservatoryBoard', {
            url_params: '?workline_id=34',
            suppressAuthRedirect: true,
        });
    });

    test('returns an empty history for a malformed response shape', async () => {
        endpointRouterMock.mockResolvedValue({ reports: null });

        await expect(fetchWorklineObservatoryReportHistory(34)).resolves.toEqual([]);
    });
});
