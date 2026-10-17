// front_page_availability.js
// Defines the effective Home feature flag for menu, top navigation and routing.
// Server-confirmed custom-root readiness also provides Home without the SPA page.
// Missing or disabled settings never create a Home destination.
import { isCustomRootEnabled, setCustomRootEnabled } from './custom_root_navigation.js';

// Announced after authoritative auth/Home settings have replaced local policy.
export const HOME_AVAILABILITY_CHANGED_EVENT = 'home-availability-changed';
let separateEnabled = false;
let revision = 0;

/** Reserve policy order before starting any request that may change Home. */
export function beginFrontPageAvailabilityRequest() { return ++revision; }

/** Forget tab authority without broadcasting an invented server setting. */
export function resetFrontPageAvailability() {
    setFrontPageAvailability({}, beginFrontPageAvailabilityRequest(), false);
}

/** One ordering guard for auth, storage, unavailable responses and invalidation. */
export function setFrontPageAvailability(data, responseRevision = beginFrontPageAvailabilityRequest(), confirmed = true) {
    if (responseRevision !== revision) return false;
    separateEnabled = data.separate_front_page === true;
    setCustomRootEnabled(data.display_index_html_at_startup === true);
    if (confirmed) {
        localStorage.setItem('separate_front_page', String(separateEnabled));
        // Persist only a cross-tab refresh hint; custom-root authority stays in memory.
        localStorage.setItem('display_index_html_at_startup', String(data.display_index_html_at_startup === true));
        localStorage.setItem('front_page_button_site_name',
            typeof data.front_page_button_site_name === 'string' ? data.front_page_button_site_name : '');
    }
    window.dispatchEvent(new CustomEvent(HOME_AVAILABILITY_CHANGED_EVENT, { detail: { confirmed } }));
    return true;
}

export function isSeparateFrontPageEnabled() {
    return isCustomRootEnabled() || separateEnabled;
}

/** Internal Home media controls do not apply to an operator's custom document. */
export function isInternalFrontPageEnabled() { return separateEnabled; }

// Another tab's persisted policy is a refresh signal, never authority to enable
// a destination. Hide stale links immediately and re-read the server fail-closed.
window.addEventListener('storage', async event => {
    if (event.storageArea && event.storageArea !== localStorage) return;
    if (event.key !== null && !['separate_front_page', 'display_index_html_at_startup', 'front_page_button_site_name'].includes(event.key)) return;
    resetFrontPageAvailability();
    const refreshRevision = beginFrontPageAvailabilityRequest();
    try {
        const { endpoint_router } = await import('../endpoints/endpoint_router.js');
        const data = await endpoint_router('fetchAuthModes', { suppressErrorToast: true, suppressAuthRedirect: true });
        setFrontPageAvailability(data, refreshRevision);
    } catch { /* A failed policy refresh cannot restore a stale Home link. */ }
});
