// theme_preference_api.js
// Reads and saves the authenticated account's allowlisted visual preference.
// Bridges theme controls with the shared authenticated API request pipeline.
// Exists so theme.js never owns CSRF, session, or response parsing details.

import { endpoint_router } from './endpoints/endpoint_router.js';
import { registerEndpointRoute } from './pipeline/api_pipeline.js';

const USER_VISUAL_PREFERENCE_ROUTE = 'userVisualPreference';

registerEndpointRoute(USER_VISUAL_PREFERENCE_ROUTE, '/api/user-visual-preference');

export function fetchUserVisualPreference() {
    return endpoint_router(USER_VISUAL_PREFERENCE_ROUTE, {
        suppressAuthRedirect: true,
    });
}

export function saveUserVisualPreference(themeMode) {
    return endpoint_router(USER_VISUAL_PREFERENCE_ROUTE, {
        method: 'PATCH',
        body_data: { theme_mode: themeMode },
        suppressAuthRedirect: true,
    });
}
