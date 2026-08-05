// main.js
// Entry point that bootstraps the frontend application on page load.
// Bridges navigation, authentication, language, and dataset initialization during startup.
// Exists to separate the application boot sequence from individual feature modules.
import { translatePage } from "./core_components/lang/translation_handler.js";
import { setAuthModes } from "./core_components/admin_tools/auth_mode_handler.js";
import { initNavbar } from "./core_components/navigation/menu_button/navbar_visibility_handler.js";
import { updateMenuLanguageDisplay } from "./core_components/lang/lang_panel_printer.js";
import { on_table_selected } from "./core_components/navigation/nav_engine/navigation.js";
import { loadConfig } from "./core_components/config_fetcher.js";
import { getPreferredAvailableLanguage } from "./core_components/state_stores/lang_preference_reader.js";
import { runPostAuthBootstrap } from "./core_components/auth/post_auth_bootstrap.js";
import { initTabs } from "./core_components/navigation/main_tabs/main_tab_printer.js";
import { showDatasetRedirectNoticeIfAvailable } from "./core_components/navigation/root_redirect_handler.js";
import { handleLoginShellEntry } from "./core_components/auth/login_shell_entry.js";
import { handleRegisterShellEntry } from "./core_components/auth/register_shell_entry.js";
import { startAuthBroadcastSync } from "./core_components/auth/auth_broadcast_sync.js";
import { initDevToolbox } from "./core_components/dev_tools/dev_toolbox.js";

const IS_DEV_MODE = document.querySelector('meta[name="app-env"]')?.content === 'dev';
const SUPPORTED_UI_LANGUAGES = ['en', 'fi', 'yue'];

import "./core_components/table_views/table_view/table_column_resizer.js";
import "./core_components/theme.js";
import "./core_components/error_and_status_handling/error_monitor_handler.js";
import { checkFingerprint } from "./core_components/auth/fingerprint_checker.js";

// Dev-only: forward client errors to backend for centralized logging.
// Loaded conditionally based on the app-env meta tag set by the Go template.
if (document.querySelector('meta[name="app-env"]')?.content === 'dev') {
    import("./core_components/error_and_status_handling/dev_error_forwarder_to_backend.js");
}

// import "./core_components/dev_tools/print_session_details.js";

document.addEventListener("DOMContentLoaded", async () => {
    await loadConfig();
    initDevToolbox();
    // Initialize the navbar before heavy dataset rendering so the content area
    // can animate with the sidebar instead of snapping to a new left edge later.
    await initNavbar();
    startAuthBroadcastSync();

    showDatasetRedirectNoticeIfAvailable();

    // Haetaan login- ja admin-tilat
    try {
        await setAuthModes(); // Odotetaan async-haun valmistumista

        // Fingerprint check MUST run after setAuthModes() to serialize
        // CookieStore session writes. Both endpoints modify the session;
        // running them concurrently causes the last Set-Cookie response
        // to overwrite the other's session data (~1/10 page loads).
        // See Security.md §4 for full rules before adding new session-writing calls.
        await checkFingerprint();
        const { dataLoaded } = await runPostAuthBootstrap({ refreshAuthModes: false });
        if (dataLoaded) {
            showDatasetRedirectNoticeIfAvailable();
        }
    } catch (err) {
        console.error(err);
        if (IS_DEV_MODE) console.log("Ei admin-oikeuksia, skipataan admin-funktiot ☺");
        await initTabs({ dataAlreadyLoaded: false });
    }

    // After the guest shell is ready, check if this is a login-entry redirect
    // and open the login modal inside the SPA.
    await handleLoginShellEntry();
    await handleRegisterShellEntry();

    const chosen_language = getPreferredAvailableLanguage(SUPPORTED_UI_LANGUAGES);
    if (IS_DEV_MODE) console.log("Translating page, chosen_language:", chosen_language);
    await translatePage(chosen_language);

    // Initial deep-link resolution happens inside load_tables() before initTabs().
    updateMenuLanguageDisplay();
});

// Reagoidaan “tableSelected”-eventtiin
document.addEventListener("tableSelected", on_table_selected);
