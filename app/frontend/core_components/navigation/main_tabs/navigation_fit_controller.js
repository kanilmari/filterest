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
        const buttons = [...element.querySelectorAll(':scope > button')];
        // Only Home's phone stack restores every destination, including buttons
        // hidden before crossing 700px. Dataset projections keep their fit rule.
        if (element.closest('.front-page-top-row') && view.getComputedStyle(element).flexDirection === 'column') {
            buttons.forEach(button => { button.hidden = false; });
            return;
        }
        const availableWidth = element.clientWidth;
        if (!availableWidth) return; // An inactive view is measured when it becomes visible.
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
        const home = element.querySelector(':scope > .top-nav-home-button');
        if (home) {
            home.classList.remove('top-nav-home-button--compact');
            // Keep Home and the first dataset together when translated labels
            // exhaust the row; retain the full accessible name on the link.
            home.classList.toggle('top-nav-home-button--compact',
                home.getBoundingClientRect().width + (widths[0] || 0) + (buttons.length ? gap : 0) > availableWidth);
        }
        const reserved = home ? home.getBoundingClientRect().width + (buttons.length ? gap : 0) : 0;
        const count = countFittingNavigationButtons(widths, availableWidth - reserved, gap);
        buttons.forEach((button, index) => {
            const hidden = index >= count;
            if (hidden && button === element.ownerDocument.activeElement) {
                // The menu is the durable route to every hidden destination.
                // Home follows the same visible opener/closer selection as datasets.
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
    // Home can change hosts or its site-name label without resizing this row.
    // Refit after either change; fitting's style/hidden writes are not observed.
    const children = new view.MutationObserver(schedule);
    children.observe(element, { childList: true, subtree: true, characterData: true });
    view.addEventListener('resize', schedule);
    element.ownerDocument.fonts?.addEventListener('loadingdone', schedule);
    return {
        sync: schedule,
        destroy() {
            destroyed = true;
            observer?.disconnect();
            children.disconnect();
            if (frame) view.cancelAnimationFrame(frame);
            view.removeEventListener('resize', schedule);
            element.ownerDocument.fonts?.removeEventListener('loadingdone', schedule);
        },
    };
}
