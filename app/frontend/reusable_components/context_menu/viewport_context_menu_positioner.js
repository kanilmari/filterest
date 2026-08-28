// viewport_context_menu_positioner.js
// Mounts pointer-opened menus at viewport coordinates and clamps them on screen.
// Bridges context-menu events with menus rendered inside translated application shells.
// Exists because transformed page and sidebar containers otherwise become positioning blocks.

/**
 * Shows one context menu at the pointer in viewport space.
 *
 * @param {HTMLElement} menu
 * @param {{x?: number, y?: number, clientX?: number, clientY?: number}} pointer
 * @param {{margin?: number}} options
 * @returns {{x: number, y: number}}
 */
export function showViewportContextMenu(menu, pointer = {}, { margin = 8 } = {}) {
    if (!(menu instanceof HTMLElement)) {
        return { x: margin, y: margin };
    }

    const documentRef = menu.ownerDocument || document;
    const windowRef = documentRef.defaultView || window;
    const requestedX = finiteCoordinate(pointer.clientX ?? pointer.x, margin);
    const requestedY = finiteCoordinate(pointer.clientY ?? pointer.y, margin);

    menu.style.position = 'fixed';
    menu.style.left = `${Math.max(margin, requestedX)}px`;
    menu.style.top = `${Math.max(margin, requestedY)}px`;
    documentRef.body.append(menu);

    const bounds = menu.getBoundingClientRect();
    const viewportWidth = windowRef.innerWidth || documentRef.documentElement?.clientWidth || 0;
    const viewportHeight = windowRef.innerHeight || documentRef.documentElement?.clientHeight || 0;
    const maxX = Math.max(margin, viewportWidth - bounds.width - margin);
    const maxY = Math.max(margin, viewportHeight - bounds.height - margin);
    const x = Math.min(Math.max(margin, requestedX), maxX);
    const y = Math.min(Math.max(margin, requestedY), maxY);

    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    return { x, y };
}

function finiteCoordinate(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}
