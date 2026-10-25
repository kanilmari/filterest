// auth_mode_handler.js
// Manages authentication state and route permissions on the frontend.
// Bridges the auth-modes endpoint with localStorage and DOM visibility toggles.
// Exists to centralize permission-checking logic consumed across the frontend.
import { count_this_function } from "../dev_tools/function_counter.js";
import { fetchAuthModes, fetchUserPermissions } from "../endpoints/stable_endpoint_router.js";
import { hasRoutePermission } from "../route_permission_checker.js";
import { synchronizeThemePreferenceForAuthState } from "../theme.js";
import { getSessionGeneration, invalidateSessionGeneration, subscribeToSessionGeneration } from '../auth/session_generation_store.js';
import { beginFrontPageAvailabilityRequest, resetFrontPageAvailability, setFrontPageAvailability } from '../front_page/front_page_availability.js';

// Use the existing session invalidation channel; route sets stay local to this
// tab and are replaced only by its authoritative bootstrap, never merged.
subscribeToSessionGeneration(reason => {
    if (['bootstrap', 'login', 'logout', 'expiry', 'session-change', 'session-invalidated'].includes(reason)) {
        sessionStorage.removeItem('user_permissions');
        resetFrontPageAvailability();
    }
});

export async function setAuthModes() {
    invalidateSessionGeneration({ reason: 'bootstrap', revalidate: false });
    const generation = getSessionGeneration();
    sessionStorage.removeItem('user_permissions');
    count_this_function("setAuthModes");
    const homeRevision = beginFrontPageAvailabilityRequest();
    // Startup security checks need this response's identity, never a persisted
    // button state left by an earlier sign-in when the current request fails.
    let bootButtonState;
    try {
        const data = await fetchAuthModes();
        if (generation !== getSessionGeneration()) return;

        if (data && ['login', 'logout'].includes(data.needs_button)) {
            bootButtonState = data.needs_button;
            localStorage.setItem("button_state", data.needs_button);

            // These flags describe site policy, not whether this browser is signed in.
            // Missing fields from an older server reset stale values to compatible defaults.
            localStorage.setItem('show_login_button', String(data.show_login_button !== false));
            localStorage.setItem('only_admin_can_login', String(data.only_admin_can_login === true));

            // Store registration_enabled flag for tab visibility
            if (typeof data.registration_enabled === 'boolean') {
                localStorage.setItem('registration_enabled', String(data.registration_enabled));
            }

            if (typeof data.login_required_for_browse === 'boolean') {
                localStorage.setItem('login_required_for_browse', String(data.login_required_for_browse));
            } else {
                localStorage.removeItem('login_required_for_browse');
            }

            // Home availability does not depend on the later permissions/theme
            // requests succeeding. Retained dataset headers need this policy now.
            setFrontPageAvailability(data, homeRevision);

            await synchronizeThemePreferenceForAuthState(data.needs_button === "logout");
            if (generation !== getSessionGeneration()) return;

            // Authenticated permissions retain their existing endpoint. Guest UI
            // grants arrive with auth modes, before main/post-auth render articles.
            let permissionSnapshotVerified = false;
            if (data.needs_button === "logout") {
                try {
                    const permData = await fetchUserPermissions();
                    if (generation !== getSessionGeneration()) return;
                    if (permData && Array.isArray(permData.endpoints) && permData.endpoints.every(route => typeof route === 'string')) {
                        sessionStorage.setItem(
                            "user_permissions",
                            JSON.stringify(permData.endpoints)
                        );
                        permissionSnapshotVerified = true;
                    } else {
                        console.warn("Virhe käyttäjäoikeuksien haussa: endpoints-taulukkoa ei saatu");
                        sessionStorage.removeItem("user_permissions");
                    }
                } catch (permErr) {
                    if (generation !== getSessionGeneration()) return;
                    console.warn("Virhe käyttäjäoikeuksien haussa:", permErr);
                    sessionStorage.removeItem("user_permissions");
                }
            } else {
                if (Array.isArray(data.guest_ui_endpoints)
                    && data.guest_ui_endpoints.every(route => typeof route === 'string' && route.startsWith('/ui/'))) {
                    sessionStorage.setItem('user_permissions', JSON.stringify(data.guest_ui_endpoints));
                    permissionSnapshotVerified = true;
                }
            }
            // Failed/malformed reads must leave denied live updates stopped.
            if (permissionSnapshotVerified) window.dispatchEvent(new CustomEvent('routePermissionsRefreshed'));
        } else {
            console.warn("needs_button tietoa ei saatu tai se ei ole merkkijono.");
        }


    } catch (err) {
        console.warn("Virhe auth modes -tarkistuksessa:", err);
    }
    return bootButtonState;
}

export { hasRoutePermission };

// Palauttaa "login" tai "logout" (tai heittää virheen, jos arvoa ei ole)
export function getButtonState() {
    const buttonState = localStorage.getItem("button_state");
    if (!buttonState) {
        throw new Error("button_state not found in localStorage");
    }
    return buttonState; // "login" tai "logout"
}
