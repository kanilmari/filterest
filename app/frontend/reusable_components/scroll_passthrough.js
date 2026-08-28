// scroll_passthrough.js
// Forwards wheel events from non-scrollable fixed panels (navbar, filterbar)
// to the main scrollable content area.
//
// When a fixed panel's content fits entirely on screen (scrollHeight <= clientHeight),
// the panel itself cannot scroll. In that case, wheel events on the panel are
// forwarded to the main content area so the user doesn't have to move the cursor.
//
// Exception: inner elements with their own limited-height scrollable area
// (e.g. a filter accordion with overflow-y: auto) are left alone — wheel events
// on those elements are not forwarded.
//
// IMPORTANT: Do NOT attach this to containers that hold the scroll target itself
// (e.g. tablePartsContainer which contains .scrollable_content). Their
// scrollHeight > clientHeight is always true (handler is a no-op) and the
// non-passive listener blocks native scroll optimizations.

/**
 * Attaches a wheel listener to `panelEl` that forwards scroll to the main
 * content area when the panel itself is not scrollable.
 *
 * @param {HTMLElement} panelEl  – the fixed panel (navbar, sidebar, mini-hero)
 * @param {Object}      opts
 * @param {() => HTMLElement|null} opts.getScrollTarget – returns the element to scroll into
 * @param {() => boolean}         [opts.isActive]      – optional guard; pass-through
 *        is skipped when this returns false (e.g. on narrow screens where the
 *        panel overlays content instead of sitting beside it)
 */
export function setupScrollPassthrough(panelEl, { getScrollTarget, isActive }) {
    panelEl.addEventListener("wheel", (e) => {
        // Guard: skip when pass-through shouldn't be active
        if (isActive && !isActive()) return;

        // 1. Can the panel itself scroll?
        if (panelEl.scrollHeight > panelEl.clientHeight) {
            return; // Panel is scrollable — normal behaviour
        }

        // 2. Is the event target inside an inner scrollable element?
        //    Walk from e.target up to (but not including) panelEl.
        //    Fast exit: only call getComputedStyle when scrollHeight suggests overflow.
        let el = e.target;
        while (el && el !== panelEl) {
            if (el.scrollHeight > el.clientHeight) {
                // Check dataset cache first, fall back to getComputedStyle
                const ov = el.dataset._ovY
                    ?? (el.dataset._ovY = getComputedStyle(el).overflowY);
                if (ov === "auto" || ov === "scroll") {
                    return; // Inner scrollable — don't interfere
                }
            }
            el = el.parentElement;
        }

        // 3. Nothing scrollable here — forward to main content
        const target = getScrollTarget();
        if (!target) return;

        e.preventDefault();
        target.scrollBy({ top: e.deltaY, left: e.deltaX });
    }, { passive: false });
}
