// navigation_fit_controller.js
// Hides complete trailing destinations when their measured row no longer fits.
// Connects the existing tab projection to container, font and copy changes.
// Keeps the full navigation model in the menu and removes hidden buttons from tab order.

const NAVIGATION_EDGE_GAP = 20;

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

// Keep fitting against the original nav box. Only the painted buttons move.
function navigationGroupOffset(element, groupWidth, allFit, observer) {
    const homeRow = element.closest('.front-page > .front-page-top-row');
    const bar = homeRow || element.closest('.dataset-shared-topbar[data-topbar-mode="hero"]')
        ?.querySelector('.dataset-shared-topbar__inner');
    if (!bar) return 0;
    const barBox = bar.getBoundingClientRect();
    const navBox = element.getBoundingClientRect();
    let leftLimit = navBox.left;
    let rightLimit = navBox.right;
    if (homeRow) {
        observer?.observe(homeRow);
        // Only occupied Home controls on this flex line need clearance. A wrapped
        // sibling leaves the original nav edge and the row's outer padding in place.
        for (const edge of homeRow.children) {
            if (edge === element) continue;
            observer?.observe(edge);
            const box = edge.getBoundingClientRect();
            if (!box.width || box.bottom <= navBox.top || box.top >= navBox.bottom) continue;
            if (box.right <= navBox.left) leftLimit = Math.max(leftLimit, box.right + NAVIGATION_EDGE_GAP);
            if (box.left >= navBox.right) rightLimit = Math.min(rightLimit, box.left - NAVIGATION_EDGE_GAP);
        }
    } else {
        const start = bar.querySelector('.dataset-shared-topbar__slot--start');
        const end = bar.querySelector('.dataset-shared-topbar__slot--end');
        if (!start || !end) return 0;
        // Swapping equally wide edge controls can leave the nav width unchanged.
        observer?.observe(start);
        observer?.observe(end);
        leftLimit = start.getBoundingClientRect().right + NAVIGATION_EDGE_GAP;
        rightLimit = end.getBoundingClientRect().left - NAVIGATION_EDGE_GAP;
    }
    if (!allFit || groupWidth > rightLimit - leftLimit) return 0;
    const centeredLeft = barBox.left + (barBox.width - groupWidth) / 2;
    const left = Math.max(leftLimit, Math.min(centeredLeft, rightLimit - groupWidth));
    return left - (navBox.left + (navBox.width - groupWidth) / 2);
}

function applyNavigationOffset(element, offset) {
    element.classList.toggle('hero-dataset-tabs--centered', offset !== 0);
    if (offset) element.style.setProperty('--dataset-navigation-offset', `${offset}px`);
    else element.style.removeProperty('--dataset-navigation-offset');
}

/** Measure original nodes synchronously; temporary measuring styles never paint. */
export function createNavigationFitController(element) {
    let destroyed = false;
    let frame = 0;
    const view = element.ownerDocument.defaultView;
    function sync() {
        if (destroyed) return;
        const buttons = [...element.querySelectorAll(':scope > button')];
        // Only Home's phone layout restores every destination, including buttons
        // hidden before crossing 700px. Dataset projections keep their fit rule.
        if (element.closest('.front-page-scroller > .front-page-top-row')) {
            buttons.forEach(button => { button.hidden = false; });
            applyNavigationOffset(element, 0);
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
                const menu = element.closest('.dataset-shared-topbar')?.querySelector('[data-navbar-menu-button="true"][aria-hidden="false"]')
                    || element.ownerDocument.querySelector('[data-navbar-menu-button="true"][aria-hidden="false"], #hideMenuButton[aria-hidden="false"]')
                    || element.ownerDocument.getElementById('showMenuButton');
                menu?.focus({ preventScroll: true });
            }
            button.hidden = hidden;
        });
        if (element.classList.contains('hero-dataset-tabs')) {
            const groupWidth = reserved + widths.reduce((sum, width) => sum + width, 0)
                + Math.max(0, widths.length - 1) * gap;
            const allFit = count === buttons.length && !home?.classList.contains('top-nav-home-button--compact');
            applyNavigationOffset(element, navigationGroupOffset(element, groupWidth, allFit, observer));
        }
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
