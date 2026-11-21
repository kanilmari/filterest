// bar_surface_experiment.js
// Owns the frosted-bars experiment switch (WL182): reads and stores the choice in this browser,
// marks the page root, and adds the switch to the menu's administration tools.
// Bridges the administrator check, browser storage and bar_surface_frosted.css.
// Exists so the experiment is one removable module rather than a dataset or site setting.

import { fetchAdminUIFeatureFlags } from "../endpoints/stable_endpoint_router.js";
import { translatePage } from "../lang/translation_handler.js";
import { getLanguageWithBrowserFallback } from "../state_stores/lang_preference_reader.js";

/** Browser-local choice: "frosted" or "solid"; absent means the site default (solid). */
export const BAR_SURFACE_STORAGE_KEY = "filterest_experimental_bar_surface_v1";
/** The root attribute bar_surface_frosted.css reads. index.html sets it before first paint. */
export const BAR_SURFACE_ATTRIBUTE = "data-bar-surface";
export const BAR_SURFACE_SWITCH_ID = "barSurfaceExperimentSwitch";
const CHOICES = new Set(["frosted", "solid"]);

function browserStorage() {
    try { return globalThis.localStorage; } catch { return null; }
}

/** Returns "frosted", "solid" or null when nothing valid is stored or storage is blocked. */
export function readBarSurfaceChoice(storage = browserStorage()) {
    try {
        const value = storage?.getItem(BAR_SURFACE_STORAGE_KEY);
        return CHOICES.has(value) ? value : null;
    } catch {
        return null;
    }
}

/** Marks the root only for the frosted look; solid and the site default leave it unmarked. */
export function applyBarSurfaceChoice(choice, root = document.documentElement) {
    if (choice === "frosted") root.setAttribute(BAR_SURFACE_ATTRIBUTE, "frosted");
    else root.removeAttribute(BAR_SURFACE_ATTRIBUTE);
}

/** Stores an explicit choice, so a later site-wide default cannot erase a local "solid". */
export function storeBarSurfaceChoice(choice, storage = browserStorage()) {
    if (!CHOICES.has(choice)) return false;
    try {
        storage?.setItem(BAR_SURFACE_STORAGE_KEY, choice);
        return true;
    } catch {
        return false;
    }
}

let storageListenerAttached = false;

/** Applies the stored choice and keeps other tabs of this browser in step. */
export function initBarSurfaceExperiment({ storage = browserStorage(), root = document.documentElement,
    target = globalThis.window } = {}) {
    applyBarSurfaceChoice(readBarSurfaceChoice(storage), root);
    if (storageListenerAttached || !target?.addEventListener) return;
    storageListenerAttached = true;
    target.addEventListener("storage", (event) => {
        if (event.key !== null && event.key !== BAR_SURFACE_STORAGE_KEY) return;
        const choice = readBarSurfaceChoice(storage);
        applyBarSurfaceChoice(choice, root);
        const input = document.getElementById(BAR_SURFACE_SWITCH_ID);
        if (input) input.checked = choice === "frosted";
    });
}

function buildSwitchRow({ storage, root }) {
    const row = document.createElement("label");
    row.classList.add("bar-surface-switch-row");
    row.dataset.testid = "bar-surface-experiment-switch";

    const input = document.createElement("input");
    input.type = "checkbox";
    input.id = BAR_SURFACE_SWITCH_ID;
    input.setAttribute("role", "switch");
    input.checked = readBarSurfaceChoice(storage) === "frosted";
    input.addEventListener("change", () => {
        const choice = input.checked ? "frosted" : "solid";
        storeBarSurfaceChoice(choice, storage);
        applyBarSurfaceChoice(choice, root);
    });

    const text = document.createElement("span");
    text.dataset.langKey = "bar_surface_frosted_experiment";
    text.textContent = "Frosted bars (experiment)";

    row.append(input, text);
    return row;
}

/**
 * Adds the switch to the administration tools once the server has confirmed an administrator:
 * the menu section exists for anyone holding a menu permission, and a route grant in the
 * browser's permission list is not proof of administrator status. Returns the row or null.
 */
export async function mountBarSurfaceSwitch(container, {
    verifyAdministrator = () => fetchAdminUIFeatureFlags({ suppressErrorToast: true, suppressAuthRedirect: true }),
    storage = browserStorage(), root = document.documentElement,
    translate = () => translatePage(getLanguageWithBrowserFallback()),
} = {}) {
    if (!(container instanceof HTMLElement)) return null;
    const existing = container.querySelector(":scope > .bar-surface-switch-row");
    if (existing) return existing;
    try {
        await verifyAdministrator();
    } catch {
        return null;
    }
    if (!container.isConnected) return null;
    const again = container.querySelector(":scope > .bar-surface-switch-row");
    if (again) return again;
    const row = buildSwitchRow({ storage, root });
    container.prepend(row);
    // The row arrives after the page's own translation pass; translate its label now.
    void Promise.resolve().then(translate).catch(() => {});
    return row;
}
