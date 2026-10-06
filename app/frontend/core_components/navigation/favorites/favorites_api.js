// favorites_api.js
// Reads and changes the current administrator's typed favorites.
// Bridges the quick list with the shared authenticated request pipeline.
// Exists so navigation owns no session, CSRF or response parsing details.
import { endpoint_router } from '../../endpoints/endpoint_router.js';
import { registerEndpointRoute } from '../../pipeline/api_pipeline.js';

registerEndpointRoute('favorites', '/api/favorites');

export function fetchFavorites() {
    return endpoint_router('favorites', { suppressAuthRedirect: true, suppressErrorToast: true });
}

export function addAdminToolFavorite(route) {
    return endpoint_router('favorites', {
        method: 'POST', body_data: { type: 'admin_tool', route }, suppressAuthRedirect: true, suppressErrorToast: true,
    });
}

export function removeAdminToolFavorite(route) {
    return endpoint_router('favorites', {
        method: 'DELETE', body_data: { type: 'admin_tool', route }, suppressAuthRedirect: true, suppressErrorToast: true,
    });
}
