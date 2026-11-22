// side_menu_tab_shape.js
// The one owner of the side menu's tab shape: rounded tabs or box-like buttons for every dataset tab at once.
// Bridges the side menu's visible tabs, the dataset catalogue's picture settings and the stored last decision.
// Exists so the shape never changes with navigation, Home or the theme (owner 2026-11-22).

import { getDatasetAccessSnapshot, subscribeDatasetAccessRegistry } from "../nav_engine/dataset_access_registry.js";
import { showsPicture } from "./view_presentation_media_resolver.js";

export const SIDE_MENU_TAB_SHAPE_ATTRIBUTE = "data-side-menu-tab-shape";
// initTabs marks the menu rendered for the current catalogue; until then its buttons do not decide.
export const SIDE_MENU_RENDERED_ATTRIBUTE = "data-side-menu-rendered";
// The browser's last decision: one rounded/box choice, no dataset names or rights (kept across sign-out).
export const SIDE_MENU_TAB_SHAPE_STORAGE_KEY = "side_menu_tab_shape";
const STORAGE_KEY = SIDE_MENU_TAB_SHAPE_STORAGE_KEY;
const THEMES = ["light", "dark"];

/**
 * Whether a dataset shows a picture in the light or the dark theme, from its catalogue picture settings
 * (DatasetPresentationPicture). The layers are the ones its view draws: the background, and the cover with
 * its theme's strength, oval mask and wash. A cover without strengths counts as shown.
 * @param {import('../../../generated/go_contract_types').DatasetPresentationPicture} picture
 */
export function datasetShowsPicture(picture) {
    return THEMES.some(theme => {
        const cover = picture.cover_themes?.[theme];
        return showsPicture([
            { set: picture.background === true },
            { set: picture.cover === true, opacity: cover?.image_opacity, wash: cover?.overlay_opacity,
                mask: cover?.oval_enabled
                    ? Math.max(cover.center_opacity, cover.mid_opacity, cover.edge_opacity) : undefined },
        ]);
    });
}

/**
 * The rule (owner 2026-11-22): rounded tabs only when none of the datasets with a visible side-menu tab shows a
 * picture in either theme. Home's own picture does not count; neither does a dataset without its own tab, nor a
 * catalogue entry without picture settings, which is a dataset this viewer may not open.
 * @param {string[]} menuDatasets the data-id of each visible side-menu tab
 * @param {{ datasets?: Array<{ dataset_name: string, presentation_picture?: object }> }} catalogue
 */
export function sideMenuShowsPicture(menuDatasets, catalogue) {
    const pictures = new Map((catalogue.datasets || []).map(entry => [entry.dataset_name, entry.presentation_picture]));
    return menuDatasets.some(name => {
        const picture = pictures.get(name);
        return Boolean(picture) && datasetShowsPicture(picture);
    });
}

function readStoredShape() {
    try {
        const stored = window.localStorage.getItem(STORAGE_KEY);
        return stored === "box" || stored === "rounded" ? stored : null;
    } catch {
        return null;
    }
}

// Before a catalogue decides, the browser's last decision; on a first visit box-like buttons.
let shape = readStoredShape() || "box";
const listeners = new Set();

function writeShapeAttribute() {
    document.body?.setAttribute(SIDE_MENU_TAB_SHAPE_ATTRIBUTE, shape);
}

/** Whether the side menu's dataset tabs are box-like now. */
export function sideMenuTabsBoxLike() {
    writeShapeAttribute();
    return shape === "box";
}

/** Called when the decision changes; returns the unsubscribe function. */
export function onSideMenuTabShapeChange(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

function visibleMenuDatasets(menu) {
    return Array.from(menu.querySelectorAll(".navtablinks"))
        .filter(button => !button.hidden && button.style.display !== "none")
        .map(button => button.dataset.id)
        .filter(Boolean);
}

/**
 * Decides again from the rendered side menu and the latest accepted catalogue. Without both, or when the
 * server could not read the picture settings, the decision stands: a refresh gap, a cleared registry after a
 * sign-in or sign-out and a failed catalogue never change the shape.
 */
export function syncSideMenuTabShape(menu = document.getElementById("navmenu"), catalogue = getDatasetAccessSnapshot()) {
    if (menu?.getAttribute(SIDE_MENU_RENDERED_ATTRIBUTE) !== "true" || !Array.isArray(catalogue?.datasets)
        || catalogue.presentation_pictures_unavailable === true) return;
    const next = sideMenuShowsPicture(visibleMenuDatasets(menu), catalogue) ? "box" : "rounded";
    try {
        window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
        // A browser that refuses storage still uses the decision for this page.
    }
    const changed = next !== shape;
    shape = next;
    writeShapeAttribute();
    if (changed) for (const listener of listeners) listener(shape);
}

// A forced catalogue refresh (an administrator's media or cover save, a page return) decides again.
subscribeDatasetAccessRegistry(response => {
    if (response) syncSideMenuTabShape(undefined, response);
});

/** Test seam: forget the decision and read the stored one again. */
export function resetSideMenuTabShapeForTests() {
    shape = readStoredShape() || "box";
}
