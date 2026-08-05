// auth_mode_handler.js
// Manages authentication state and route permissions on the frontend.
// Bridges the auth-modes endpoint with localStorage and DOM visibility toggles.
// Exists to centralize permission-checking logic consumed across the frontend.
import { count_this_function } from "../dev_tools/function_counter.js";
import { fetchAuthModes, fetchUserPermissions } from "../endpoints/stable_endpoint_router.js";
import { hasRoutePermission } from "../route_permission_checker.js";

export async function setAuthModes() {
    count_this_function("setAuthModes");
    try {
        const data = await fetchAuthModes();

        if (data && typeof data.needs_button === "string") {
            localStorage.setItem("button_state", data.needs_button);

            // Store registration_enabled flag for tab visibility
            if (typeof data.registration_enabled === 'boolean') {
                localStorage.setItem('registration_enabled', String(data.registration_enabled));
            }

            if (typeof data.login_required_for_browse === 'boolean') {
                localStorage.setItem('login_required_for_browse', String(data.login_required_for_browse));
            } else {
                localStorage.removeItem('login_required_for_browse');
            }

            // Jos käyttäjä on kirjautunut sisään, haetaan ja talletetaan sallitut reitit
            if (data.needs_button === "logout") {
                try {
                    const permData = await fetchUserPermissions();
                    if (permData && Array.isArray(permData.endpoints)) {
                        sessionStorage.setItem(
                            "user_permissions",
                            JSON.stringify(permData.endpoints)
                        );
                    } else {
                        console.warn("Virhe käyttäjäoikeuksien haussa: endpoints-taulukkoa ei saatu");
                        sessionStorage.removeItem("user_permissions");
                    }
                } catch (permErr) {
                    console.warn("Virhe käyttäjäoikeuksien haussa:", permErr);
                    sessionStorage.removeItem("user_permissions");
                }
            } else {
                // Ei kirjautunut -> tyhjennetään käyttäjäoikeudet
                sessionStorage.removeItem("user_permissions");
            }
        } else {
            console.warn("needs_button tietoa ei saatu tai se ei ole merkkijono.");
        }


    } catch (err) {
        console.warn("Virhe auth modes -tarkistuksessa:", err);
    }
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
