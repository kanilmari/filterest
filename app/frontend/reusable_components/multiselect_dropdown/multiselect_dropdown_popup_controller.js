// multiselect_dropdown_popup_controller.js
// Owns the floating multiselect's viewport geometry and lifetime listeners.
// Connects caller-owned anchors and views to the portalled popup without application policy.
// Preserves geometry during temporary anchor detachment and cleans up permanent owner removal.

import { VIEW_DEACTIVATE_EVENT } from '../view_lifecycle_events.js';

const MAX_POPUP_HEIGHT = 400;
const MIN_OPTION_ROWS = 3;
const PLAIN_MIN_POPUP_HEIGHT = 220;

/** Explicit owners outlive transient result redraws and are observed even while closed. */
export function createMultiselectPopupController({
    containerElement, anchorElement, triggerElement, ownerElement, explicitOwner,
    listWrapper, minPopupWidth, richPopup, close, destroy,
}) {
    let tracking = false;
    let rafHandle = 0;
    let observer = null;
    let contentResizeObserver = null;
    let lastAnchorRect = null;
    let minimumOptionsHeight = null; // Unmeasured; zero is a finalized empty opening.
    // The owner's own document and window, kept for cleanup that runs after the element has left its page.
    const doc = ownerElement.ownerDocument;
    const view = doc.defaultView || window;
    const ownerView = ownerElement.closest('#tabs_container > .content_div');
    const handleOwnerViewDeactivation = () => close({ reason: 'deactivate' });
    const handleOutsideClick = event => {
        if (!containerElement.contains(event.target) && !triggerElement.contains(event.target)
            && !listWrapper.contains(event.target)) close({ reason: 'outside' });
    };
    doc.addEventListener('click', handleOutsideClick);
    ownerView?.addEventListener(VIEW_DEACTIVATE_EVENT, handleOwnerViewDeactivation);

    // Measure at the positioned width: translated titles, hints and option labels may wrap. Sample the option
    // budget once per opening, including an empty list, so filtering, even to taller rows or no results, cannot
    // flip the popup while typing. Fixed controls are always remeasured; reopening resamples the option budget.
    function measureMinimumPopupHeight() {
        const style = view.getComputedStyle(listWrapper);
        const pixels = value => Number.parseFloat(value) || 0;
        const borders = pixels(style.borderTopWidth) + pixels(style.borderBottomWidth);
        let fixedHeight = borders + pixels(style.paddingTop) + pixels(style.paddingBottom);
        const optionsList = listWrapper.querySelector('.msd-dropdown-options');
        for (const child of listWrapper.children) {
            if (child === optionsList || child.classList.contains('msd-no-results')) continue;
            const childStyle = view.getComputedStyle(child);
            if (childStyle.display === 'none') continue;
            fixedHeight += child.getBoundingClientRect().height
                + pixels(childStyle.marginTop) + pixels(childStyle.marginBottom);
        }
        if (minimumOptionsHeight === null) {
            const rows = [...optionsList.querySelectorAll('[role="option"]')].slice(0, MIN_OPTION_ROWS);
            const lastRow = rows.at(-1);
            // The first three rows' extent includes any group headings before/between them; scroll does not change it.
            minimumOptionsHeight = lastRow ? Math.max(0, lastRow.getBoundingClientRect().bottom
                - optionsList.getBoundingClientRect().top + optionsList.scrollTop) : 0;
        }
        return { requiredHeight: Math.min(MAX_POPUP_HEIGHT, Math.max(richPopup ? 0 : PLAIN_MIN_POPUP_HEIGHT,
            fixedHeight + minimumOptionsHeight)), borders, borderBox: style.boxSizing === 'border-box' };
    }

    function positionListWrapper() {
        if (listWrapper.style.display === 'none') return;
        if (anchorElement.isConnected) lastAnchorRect = anchorElement.getBoundingClientRect();
        if (!lastAnchorRect) return;
        const anchorRect = lastAnchorRect;
        const viewport = view.visualViewport;
        const viewportWidth = viewport?.width || view.innerWidth || doc.documentElement.clientWidth;
        const viewportHeight = viewport?.height || view.innerHeight || doc.documentElement.clientHeight;
        const offsetLeft = viewport?.offsetLeft || 0;
        const offsetTop = viewport?.offsetTop || 0;
        const phone = richPopup && viewportWidth <= 600;
        const margin = phone ? 16 : 8;
        const gap = 4;
        const maxWidth = Math.max(0, viewportWidth - margin * 2);
        const width = phone ? maxWidth : Math.min(Math.max(anchorRect.width || maxWidth, minPopupWidth), maxWidth);
        const left = Math.min(Math.max(anchorRect.left, offsetLeft + margin),
            offsetLeft + viewportWidth - width - margin);
        listWrapper.style.left = `${left}px`;
        listWrapper.style.width = `${width}px`;
        const { requiredHeight, borders, borderBox } = measureMinimumPopupHeight();
        const visibleHeight = Math.max(0, viewportHeight - margin * 2);
        const anchorVisible = anchorRect.bottom > offsetTop && anchorRect.top < offsetTop + viewportHeight;
        const below = Math.max(0, offsetTop + viewportHeight - anchorRect.bottom - margin - gap);
        const above = Math.max(0, anchorRect.top - offsetTop - margin - gap);
        const upward = below < requiredHeight && above > below;
        // The space beside an anchor that has left the view (an on-screen keyboard, a smaller window) can exceed the view.
        const available = Math.min(upward ? above : below, visibleHeight);
        // On a short screen, or with the anchor out of view, the whole rich popup sits inside the visual viewport and
        // scrolls, including its header and caller controls.
        const shortScreen = richPopup && (available < 180 || !anchorVisible);
        const maxHeight = Math.min(MAX_POPUP_HEIGHT, shortScreen ? visibleHeight : available);
        listWrapper.classList.toggle('msd-dropdown-list--open-upward', upward && !shortScreen);
        listWrapper.style.maxHeight = `${Math.max(0, maxHeight - (borderBox ? 0 : borders))}px`;
        listWrapper.style.top = shortScreen ? `${offsetTop + margin}px`
            : upward ? '' : `${Math.max(anchorRect.bottom + gap, offsetTop + margin)}px`;
        listWrapper.style.bottom = upward && !shortScreen
            ? `${view.innerHeight - Math.min(anchorRect.top - gap, offsetTop + viewportHeight - margin)}px` : '';
    }

    function schedulePositionUpdate() {
        if (listWrapper.style.display === 'none' || rafHandle) return;
        rafHandle = view.requestAnimationFrame(() => { rafHandle = 0; positionListWrapper(); });
    }

    function startOwnerConnectionTracking() {
        if (observer || typeof MutationObserver !== 'function') return;
        observer = new MutationObserver(() => {
            if (!ownerElement.isConnected) destroy();
            else if (anchorElement.isConnected) schedulePositionUpdate();
        });
        observer.observe(doc.documentElement, { childList: true, subtree: true });
    }

    function stopOwnerConnectionTracking() { observer?.disconnect(); observer = null; }

    function startPositionTracking() {
        if (tracking) return;
        tracking = true;
        view.addEventListener('resize', schedulePositionUpdate);
        view.addEventListener('scroll', schedulePositionUpdate, true);
        view.visualViewport?.addEventListener('resize', schedulePositionUpdate);
        view.visualViewport?.addEventListener('scroll', schedulePositionUpdate);
        startOwnerConnectionTracking();
        positionListWrapper();
        // Observe the fixed sections too: their growth may leave the capped popup's own size unchanged.
        if (typeof view.ResizeObserver === 'function') {
            contentResizeObserver = new view.ResizeObserver(schedulePositionUpdate);
            contentResizeObserver.observe(listWrapper);
            for (const child of listWrapper.children) contentResizeObserver.observe(child);
        }
    }

    // Cleanup can run from a late owner observer after the window has been torn down (a test environment deletes its
    // methods); it then has nothing left to detach.
    function onView(method, ...args) {
        if (typeof view[method] === 'function') view[method](...args);
    }

    function stopPositionTracking() {
        tracking = false;
        onView('removeEventListener', 'resize', schedulePositionUpdate);
        onView('removeEventListener', 'scroll', schedulePositionUpdate, true);
        view.visualViewport?.removeEventListener?.('resize', schedulePositionUpdate);
        view.visualViewport?.removeEventListener?.('scroll', schedulePositionUpdate);
        if (rafHandle) onView('cancelAnimationFrame', rafHandle);
        rafHandle = 0;
        contentResizeObserver?.disconnect();
        contentResizeObserver = null;
        minimumOptionsHeight = null;
        if (!explicitOwner) stopOwnerConnectionTracking();
    }

    function dispose() {
        stopPositionTracking();
        stopOwnerConnectionTracking();
        doc.removeEventListener('click', handleOutsideClick);
        ownerView?.removeEventListener(VIEW_DEACTIVATE_EVENT, handleOwnerViewDeactivation);
    }
    if (explicitOwner) startOwnerConnectionTracking();
    return { startPositionTracking, stopPositionTracking, schedulePositionUpdate, dispose };
}
