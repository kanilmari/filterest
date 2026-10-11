// table_component_touch_copy_controller.js
// Opens the existing list/comparison copy menu when a person holds a touch cell.
// Connects pointer gestures to TableComponent's shared selection and copy payloads.
// Keeps touch scrolling and short taps intact and releases pending holds on teardown.

// Open before the browser's usual long-press menu can cancel the touch pointer.
const TOUCH_HOLD_DURATION_MS = 450;
const TOUCH_MOVE_TOLERANCE_PX = 10;
const TOUCH_COMPATIBILITY_WINDOW_MS = 750;

/**
 * Binds touch copying to one component without changing its mouse interaction.
 * A held unselected cell becomes the selection; an existing range stays selected.
 * Native touch context menus use the same path, and compatibility mouse events
 * after lifting the finger cannot clear the menu or start editing that cell.
 *
 * @param {import('./table_component_builder.js').TableComponent} component
 * @returns {() => void} Releases listeners, pending holds and compatibility expiry.
 */
export function initializeTableComponentTouchCopy(component) {
    const root = component.getElement();
    const listeners = [];
    let pendingHold = null;
    let heldTouch = null;

    const listen = (element, type, listener, options = false) => {
        element.addEventListener(type, listener, options);
        listeners.push(() => element.removeEventListener(type, listener, options));
    };
    const cancelHold = () => {
        if (pendingHold) clearTimeout(pendingHold.timer);
        pendingHold = null;
    };
    const clearHeldTouch = () => {
        if (heldTouch) clearTimeout(heldTouch.expiryTimer);
        heldTouch = null;
    };
    const suppressTouchEvent = (event, nativePendingRequest = false) => {
        if (!heldTouch || !heldTouch.cell.contains(event.target)) return;
        if (heldTouch.releasedAt !== null
            && performance.now() - heldTouch.releasedAt >= TOUCH_COMPATIBILITY_WINDOW_MS) {
            clearHeldTouch();
            return;
        }
        if (heldTouch.suppressedEvents.has(event.type)) return;
        if (!nativePendingRequest && !matchesTouchOrigin(event, heldTouch)) return;
        heldTouch.suppressedEvents.add(event.type);
        event.preventDefault();
        event.stopImmediatePropagation();
        if (heldTouch.suppressedEvents.has('contextmenu') && heldTouch.suppressedEvents.has('click')) {
            clearHeldTouch();
        }
    };
    const openTouchMenu = () => {
        if (!pendingHold) return;
        const { cell, event, touchIdentifier } = pendingHold;
        cancelHold();
        if (!cell.isConnected || !root.contains(cell) || cell.matches('.header, .editing')) return;
        if (!component.getListSelectionCoordinate(cell)) return;
        if (!cell.classList.contains('selected')) {
            component.onMouseDown(event);
            component.onMouseUp();
        } else {
            component.focusGridCell(cell);
        }
        component.onContextMenu(event);
        heldTouch = {
            cell, pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY,
            touchIdentifier,
            releasedAt: null, suppressedEvents: new Set(), expiryTimer: null,
        };
    };

    listen(root, 'pointerdown', event => {
        cancelHold();
        clearHeldTouch();
        if (event.pointerType !== 'touch' || !event.isPrimary || event.button !== 0) return;
        if (!['normal', 'transposed'].includes(component.currentView)) return;
        const cell = event.target.closest?.('.cell');
        if (!cell || cell.matches('.header, .editing')) return;
        if (event.target.closest('button, a, input, textarea, select, .drag-handle')) return;
        pendingHold = {
            cell, event, touchIdentifier: null,
            timer: setTimeout(openTouchMenu, TOUCH_HOLD_DURATION_MS),
        };
    });
    listen(root, 'touchstart', event => {
        if (!pendingHold || event.touches.length !== 1 || !pendingHold.cell.contains(event.target)) return;
        // Pointer ids and Touch identifiers use different namespaces (often 2 and 0).
        pendingHold.touchIdentifier = event.changedTouches[0]?.identifier ?? null;
    }, { passive: true });
    listen(root.ownerDocument, 'touchend', event => {
        if (!heldTouch || heldTouch.touchIdentifier === null || !heldTouch.cell.contains(event.target)) return;
        if (!Array.from(event.changedTouches).some(touch => touch.identifier === heldTouch.touchIdentifier)) return;
        // Cancel only the hold's own release, before Chromium can generate a tap's
        // mouse press/click, including a click retargeted to the body-mounted menu.
        heldTouch.touchIdentifier = null;
        event.preventDefault();
    }, { capture: true, passive: false });
    listen(root.ownerDocument, 'pointerdown', event => {
        // Any new press begins another gesture, including a mouse press outside this root.
        clearHeldTouch();
        if (pendingHold && event.pointerId !== pendingHold.event.pointerId) cancelHold();
    }, true);
    listen(root.ownerDocument, 'pointermove', event => {
        if (!pendingHold || event.pointerId !== pendingHold.event.pointerId) return;
        if (Math.hypot(event.clientX - pendingHold.event.clientX,
            event.clientY - pendingHold.event.clientY) > TOUCH_MOVE_TOLERANCE_PX) cancelHold();
    });
    for (const type of ['pointerup', 'pointercancel']) {
        listen(root.ownerDocument, type, event => {
            if (pendingHold && event.pointerId === pendingHold.event.pointerId) cancelHold();
            if (!heldTouch || event.pointerId !== heldTouch.pointerId) return;
            if (type === 'pointercancel') {
                clearHeldTouch();
                return;
            }
            if (heldTouch.releasedAt !== null) return;
            heldTouch.clientX = event.clientX;
            heldTouch.clientY = event.clientY;
            heldTouch.releasedAt = performance.now();
            heldTouch.expiryTimer = setTimeout(clearHeldTouch, TOUCH_COMPATIBILITY_WINDOW_MS);
        });
    }
    listen(root, 'contextmenu', event => {
        const nativePendingRequest = pendingHold?.cell.contains(event.target)
            && matchesTouchOrigin(event, pendingHold.event, true);
        if (nativePendingRequest) openTouchMenu();
        suppressTouchEvent(event, nativePendingRequest);
    }, true);
    for (const type of ['mousedown', 'mouseup', 'click']) {
        listen(root, type, event => suppressTouchEvent(event), true);
    }

    return () => {
        cancelHold();
        clearHeldTouch();
        listeners.splice(0).forEach(remove => remove());
    };
}

/**
 * Recognizes the held pointer or legacy mouse events explicitly marked as touch-generated.
 * Unmarked native contextmenu events are accepted only while that touch hold is pending;
 * after release, ambiguous events must reach the existing keyboard/mouse handlers.
 */
function matchesTouchOrigin(event, touch, allowPendingNativeMenu = false) {
    if (Math.hypot(event.clientX - touch.clientX, event.clientY - touch.clientY)
        > TOUCH_MOVE_TOLERANCE_PX) return false;
    if (event.pointerType === 'touch') return event.pointerId === touch.pointerId;
    if (event.pointerType && event.pointerType !== 'mouse') return false;
    if (event.sourceCapabilities?.firesTouchEvents === true) return true;
    return allowPendingNativeMenu && !event.pointerType && !event.sourceCapabilities;
}
