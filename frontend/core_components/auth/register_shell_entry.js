// register_shell_entry.js
// Detects the ?register-entry=1 SPA query parameter and opens the register view inside the guest shell.
// Bridges the backend GET /register redirect and the SPA-side register tab so registration starts inside the app.
// Exists to unify direct register navigations through the SPA guest shell instead of a standalone page.

import { openNavTab } from "../navigation/main_tabs/main_tab_printer.js";

export function buildRegisterEntryPath() {
    const params = new URLSearchParams();
    params.set("register-entry", "1");
    return `/?${params.toString()}`;
}

export async function handleRegisterShellEntry() {
    const params = new URLSearchParams(window.location.search);
    if (params.get("register-entry") !== "1") {
        return false;
    }

    params.delete("register-entry");
    const cleanSearch = params.toString();
    const cleanUrl = window.location.pathname + (cleanSearch ? `?${cleanSearch}` : "") + window.location.hash;
    window.history.replaceState({}, "", cleanUrl);

    await openNavTab("register");
    return true;
}

export function navigateToRegisterEntry() {
    window.history.replaceState({}, "", buildRegisterEntryPath());
}
