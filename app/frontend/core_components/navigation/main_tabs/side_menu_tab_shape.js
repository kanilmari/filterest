// side_menu_tab_shape.js
// The one owner of the side menu's tab shape: rounded tabs or box-like buttons for every dataset tab at once.
// Bridges the side menu's visible tabs, the catalogue's picture settings and default views, the views this page
// has drawn or the person chose, and the stored last decision.
// Exists so the shape never changes with navigation, Home or the theme (owner 2026-11-22).

import { getDatasetAccessSnapshot, subscribeDatasetAccessRegistry } from "../nav_engine/dataset_access_registry.js";
import { subscribeToSessionGeneration } from "../../auth/session_generation_store.js";
import { predictDatasetOpeningView } from "../../table_views/dataset_default_view.js";
import { resolveDatasetViewSelectionTarget } from "../../table_views/dataset_view_registry.js";
import { showsPicture } from "./view_presentation_media_resolver.js";

export const SIDE_MENU_TAB_SHAPE_ATTRIBUTE = "data-side-menu-tab-shape";
// initTabs marks the menu rendered for the current catalogue; until then its buttons do not decide.
export const SIDE_MENU_RENDERED_ATTRIBUTE = "data-side-menu-rendered";
// The browser's last decision: one rounded/box choice, no dataset names or rights (kept across sign-out).
export const SIDE_MENU_TAB_SHAPE_STORAGE_KEY = "side_menu_tab_shape";
const STORAGE_KEY = SIDE_MENU_TAB_SHAPE_STORAGE_KEY;
const THEMES = ["light", "dark"];
// Table views (owner 2026-11-22: Taulu, Lista, Vertailu, and the legacy list key): like a picture, one menu
// dataset showing one makes every tab box-like. Every other view allows rounded tabs.
export const TABLE_VIEW_KEYS = Object.freeze(new Set(["table", "normal", "list", "transposed"]));

export function isTableView(view) {
    return TABLE_VIEW_KEYS.has(resolveDatasetViewSelectionTarget(String(view || "").trim()));
}

// The view each dataset was last drawn in on this page, or chosen in the view selector. Raw writes to the
// view-choice store do not count: Home's group links write before navigating and restore on abort, and opening
// an article from a row writes the article view (Codex plan review r1). A page starts empty, as the store forgets
// earlier visits at page load; an address with ?view= is drawn and so counts, an Article view included.
const shownViews = new Map();

/**
 * Records the view a dataset shows. Rendering reports every view it commits; a row's article is reading that row,
 * not a change of the dataset's view, and is left out. The view selector reports the person's choice. Decides
 * again.
 * @param {string} datasetName
 * @param {string} view
 * @param {{ chosen?: boolean, rowArticle?: boolean }} [options] chosen: picked in the view selector;
 *     rowArticle: an article drawn for one open row
 */
export function noteDatasetViewShown(datasetName, view, { chosen = false, rowArticle = false } = {}) {
    if (!datasetName || !view || (rowArticle && !chosen)) return;
    if (shownViews.get(datasetName) === view) return;
    shownViews.set(datasetName, view);
    syncSideMenuTabShape();
}

/** The dataset's current view: the one this page drew or the person chose, else the view it would open in. */
export function datasetCurrentView(datasetName, entry = {}) {
    return shownViews.get(datasetName) ?? predictDatasetOpeningView(datasetName,
        entry.default_view ? { tableMeta: { default_view_name: entry.default_view.name ?? null } } : {});
}

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
 * The rule (owner 2026-11-22): rounded tabs only when every dataset with a visible side-menu tab shows no picture
 * in either theme and has a current view that is not a table view. Home's own picture does not count; neither
 * does a dataset without its own tab, nor a catalogue entry without picture settings, which is a dataset this
 * viewer may not open.
 * @param {string[]} menuDatasets the data-id of each visible side-menu tab
 * @param {{ datasets?: Array<{ dataset_name: string, presentation_picture?: object, default_view?: object }> }} catalogue
 */
export function sideMenuNeedsBoxes(menuDatasets, catalogue) {
    const entries = new Map((catalogue.datasets || []).map(entry => [entry.dataset_name, entry]));
    return menuDatasets.some(name => {
        const entry = entries.get(name);
        if (!entry?.presentation_picture) return false;
        return datasetShowsPicture(entry.presentation_picture) || isTableView(datasetCurrentView(name, entry));
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
 * server could not read the picture settings or default views, the decision stands: a refresh gap, a cleared
 * registry after a sign-in or sign-out and a failed catalogue never change the shape.
 */
export function syncSideMenuTabShape(menu = document.getElementById("navmenu"), catalogue = getDatasetAccessSnapshot()) {
    if (menu?.getAttribute(SIDE_MENU_RENDERED_ATTRIBUTE) !== "true" || !Array.isArray(catalogue?.datasets)
        || catalogue.presentation_pictures_unavailable === true || catalogue.default_views_unavailable === true) return;
    const next = sideMenuNeedsBoxes(visibleMenuDatasets(menu), catalogue) ? "box" : "rounded";
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

// Another person's drawn views must not decide after a sign-in or sign-out on this page.
subscribeToSessionGeneration(reason => {
    if (!["blur", "focus", "suspend", "resume", "restore"].includes(reason)) shownViews.clear();
});

/** Test seam: forget the decision and the drawn views, and read the stored decision again. */
export function resetSideMenuTabShapeForTests() {
    shape = readStoredShape() || "box";
    shownViews.clear();
}
