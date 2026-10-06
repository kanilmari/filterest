// @vitest-environment node
// Keeps favorite reads and writes within the normal authenticated API pipeline.
import { expect, test, vi } from 'vitest';
import { endpoint_router } from '../../endpoints/endpoint_router.js';
import { registerEndpointRoute } from '../../pipeline/api_pipeline.js';
import { fetchFavorites, addAdminToolFavorite, removeAdminToolFavorite } from './favorites_api.js';
vi.mock('../../endpoints/endpoint_router.js', () => ({ endpoint_router: vi.fn() }));
vi.mock('../../pipeline/api_pipeline.js', () => ({ registerEndpointRoute: vi.fn() }));

test('registers and uses the typed route for all methods', () => {
    expect(registerEndpointRoute).toHaveBeenCalledWith('favorites', '/api/favorites');
    fetchFavorites();
    addAdminToolFavorite('/tool');
    removeAdminToolFavorite('/tool');
    expect(endpoint_router).toHaveBeenNthCalledWith(1, 'favorites', { suppressAuthRedirect: true, suppressErrorToast: true });
    expect(endpoint_router).toHaveBeenNthCalledWith(2, 'favorites', { method: 'POST', body_data: { type: 'admin_tool', route: '/tool' }, suppressAuthRedirect: true, suppressErrorToast: true });
    expect(endpoint_router).toHaveBeenNthCalledWith(3, 'favorites', { method: 'DELETE', body_data: { type: 'admin_tool', route: '/tool' }, suppressAuthRedirect: true, suppressErrorToast: true });
});
