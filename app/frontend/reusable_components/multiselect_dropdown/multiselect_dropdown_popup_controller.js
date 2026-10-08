// multiselect_dropdown_popup_controller.js
// Owns the floating multiselect's viewport geometry and lifetime listeners.
// Connects caller-owned anchors and views to the portalled popup without application policy.
// Preserves geometry during temporary anchor detachment and cleans up permanent owner removal.

import { VIEW_DEACTIVATE_EVENT } from '../view_lifecycle_events.js';

/** Explicit owners outlive transient result redraws and are observed even while closed. */
export function createMultiselectPopupController({
    containerElement, anchorElement, triggerElement, ownerElement, explicitOwner,
    listWrapper, minPopupWidth, richPopup, close, destroy,
}) {
    let tracking = false;
    let rafHandle = 0;
    let observer = null;
    let lastAnchorRect = null;
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
        const visibleHeight = Math.max(0, viewportHeight - margin * 2);
        const anchorVisible = anchorRect.bottom > offsetTop && anchorRect.top < offsetTop + viewportHeight;
        const below = Math.max(0, offsetTop + viewportHeight - anchorRect.bottom - margin - gap);
        const above = Math.max(0, anchorRect.top - offsetTop - margin - gap);
        const upward = below < 220 && above > below;
        // The space beside an anchor that has left the view (an on-screen keyboard, a smaller window) can exceed the view.
        const available = Math.min(upward ? above : below, visibleHeight);
        // On a short screen, or with the anchor out of view, the whole rich popup sits inside the visual viewport and
        // scrolls, including its header and caller controls.
        const shortScreen = richPopup && (available < 180 || !anchorVisible);
        const maxHeight = Math.min(400, shortScreen ? visibleHeight : available);
        listWrapper.classList.toggle('msd-dropdown-list--open-upward', upward && !shortScreen);
        listWrapper.style.left = `${left}px`;
        listWrapper.style.width = `${width}px`;
        listWrapper.style.maxHeight = `${maxHeight}px`;
        listWrapper.style.top = shortScreen ? `${offsetTop + margin}px`
            : upward ? '' : `${anchorRect.bottom + gap}px`;
        listWrapper.style.bottom = upward && !shortScreen
            ? `${view.innerHeight - anchorRect.top + gap}px` : '';
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
