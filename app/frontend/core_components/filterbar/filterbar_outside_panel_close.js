// filterbar_outside_panel_close.js
// Closes the narrow-screen filterbar panel when the person clicks outside it.
// Bridges the panel, its toggle, the shared top bar and body-mounted action menus they own.
// Kept apart from filterbar_runtime_controller.js so the dismissal target test stays separate
// from state and memory ownership, and can be tested without the whole runtime.

import { readAnchoredActionMenuOwner } from "../../reusable_components/action_menu/anchored_action_menu.js";

/** Whether a click target belongs to the panel, its toggle or the shared top bar. */
export function isInsideFilterbarSurface(target, { panel, fixedToggleButton, sharedTopBar }) {
    const surfaces = [panel, fixedToggleButton, sharedTopBar].filter(Boolean);
    if (surfaces.some((surface) => surface.contains(target))) return true;
    // A choice in a menu mounted on <body> (for example the view picker's
    // Article presentations) belongs to the control that owns the menu.
    const menuOwner = readAnchoredActionMenuOwner(target);
    return Boolean(menuOwner) && surfaces.some((surface) => surface.contains(menuOwner));
}

/** Bubbling document click: runs after the menu item's own click handler has already chosen. */
export function wireOutsidePanelClose({ tableName, panel, fixedToggleButton, sharedTopBar, isNarrowScreen, isHidden, onClose, signal }) {
    // Snapshot only picker-dialog clicks before their close handler removes
    // the content. The bubbling listener keeps ordinary outside-click timing.
    const pickerDialogClicks = new WeakSet();
    document.addEventListener('click', event => {
        const overlay = event.composedPath().find(node => node.classList?.contains('image_first_view_overlay'));
        const dialog = overlay?.querySelector('.modal_body > .image_first_view:last-child');
        if (tableName && dialog?.dataset.rowPresentationOwner === tableName) pickerDialogClicks.add(event);
    }, { capture: true, signal });
    document.addEventListener('click', event => {
        if (!isNarrowScreen() || isHidden()) return;
        if (isInsideFilterbarSurface(event.target, { panel, fixedToggleButton, sharedTopBar })) return;
        if (pickerDialogClicks.has(event)) return;
        onClose();
    }, { signal });
}
