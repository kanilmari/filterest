// navigation_fit_controller.js
// Hides complete trailing destinations when their measured row no longer fits.
// Connects the existing tab projection to container, font and copy changes.
// Keeps the full navigation model in the menu and removes hidden buttons from tab order.

/** Count a prefix that fits without shrinking labels or leaving half a button. */
export function countFittingNavigationButtons(widths, availableWidth, gap = 0) {
    let occupied = 0;
    let count = 0;
    for (const width of widths) {
        const next = occupied + (count ? gap : 0) + width;
        if (next > availableWidth) break;
        occupied = next;
        count++;
    }
    return count;
}

/** Measure original nodes synchronously; temporary measuring styles never paint. */
export function createNavigationFitController(element) {
    let destroyed = false;
    let frame = 0;
    const view = element.ownerDocument.defaultView;
    function sync() {
        if (destroyed) return;
        const availableWidth = element.clientWidth;
        if (!availableWidth) return; // An inactive view is measured when it becomes visible.
        const buttons = [...element.querySelectorAll(':scope > button')];
        const widths = buttons.map(button => {
            const previousStyle = button.getAttribute('style');
            const wasHidden = button.hidden;
            button.style.cssText += ';position:absolute;visibility:hidden;display:inline-flex;width:max-content;max-width:none;';
            button.hidden = false;
            const width = button.getBoundingClientRect().width;
            button.hidden = wasHidden;
            // Restore through CSSOM: the page's CSP rejects style-attribute writes.
            // Clear the measuring rules before removing an originally absent attribute.
            button.style.cssText = previousStyle || '';
            if (previousStyle === null) button.removeAttribute('style');
            return width;
        });
        const gap = Number.parseFloat(view.getComputedStyle(element).columnGap) || 0;
        const count = countFittingNavigationButtons(widths, availableWidth, gap);
        buttons.forEach((button, index) => {
            const hidden = index >= count;
            if (hidden && button === element.ownerDocument.activeElement) {
                // The menu is the durable route to every hidden destination.
                const menu = element.ownerDocument.querySelector('[data-navbar-menu-button="true"][aria-hidden="false"], #hideMenuButton[aria-hidden="false"]')
                    || element.ownerDocument.getElementById('showMenuButton');
                menu?.focus({ preventScroll: true });
            }
            button.hidden = hidden;
        });
    }
    function schedule() {
        if (frame || destroyed) return;
        frame = view.requestAnimationFrame(() => { frame = 0; sync(); });
    }
    const observer = typeof view.ResizeObserver === 'function' ? new view.ResizeObserver(schedule) : null;
    observer?.observe(element);
    view.addEventListener('resize', schedule);
    element.ownerDocument.fonts?.addEventListener('loadingdone', schedule);
    return {
        sync: schedule,
        destroy() {
            destroyed = true;
            observer?.disconnect();
            if (frame) view.cancelAnimationFrame(frame);
            view.removeEventListener('resize', schedule);
            element.ownerDocument.fonts?.removeEventListener('loadingdone', schedule);
        },
    };
}
