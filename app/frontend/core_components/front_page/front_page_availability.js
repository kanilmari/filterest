// front_page_availability.js
// Defines the effective Home feature flag for menu, top navigation and routing.
// Server-confirmed custom-root readiness also provides Home without the SPA page.
// Missing or disabled settings never create a Home destination.
import { isCustomRootEnabled } from './custom_root_navigation.js';

// Announced after authoritative auth/Home settings have replaced local policy.
export const HOME_AVAILABILITY_CHANGED_EVENT = 'home-availability-changed';

export function isSeparateFrontPageEnabled() {
    return isCustomRootEnabled() || localStorage.getItem('separate_front_page') === 'true';
}
