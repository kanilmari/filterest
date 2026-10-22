// multiselect_dropdown_popup_controller.js
// Owns the floating multiselect's viewport geometry and lifetime listeners.
// Connects caller-owned anchors and views to the portalled popup without application policy.
// Preserves geometry during temporary anchor detachment and cleans up permanent owner removal.

import { VIEW_DEACTIVATE_EVENT } from '../view_lifecycle_events.js';
import { measureFloatingPanelPlacement } from '../floating_panel_placement.js';
import { createMultiselectHeightController, MAX_POPUP_HEIGHT } from './multiselect_dropdown_height_controller.js';

// K461/K444 phone boundary, inclusive; keep this named boundary independent of popup height.
const PHONE_MAX_WIDTH = 700;
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
    let placement = null;
    let fitOnNextFrame = false;
    let minimumOptionsHeight = null; // Unmeasured; zero is a finalized empty opening.
    // The owner's own document and window, kept for cleanup that runs after the element has left its page.
    const doc = ownerElement.ownerDocument;
    const view = doc.defaultView || window;
    const heightController = createMultiselectHeightController({ listWrapper, triggerElement, richPopup,
        onResize: () => positionListWrapper() });
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
    // flip the popup while typing. Viewport resize remeasures fixed controls; reopening resamples the option budget.
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
            fixedHeight + minimumOptionsHeight)), fixedHeight, borders, borderBox: style.boxSizing === 'border-box' };
    }

    function positionListWrapper(fitViewport = false) {
        if (listWrapper.style.display === 'none') return;
        if (anchorElement.isConnected) lastAnchorRect = anchorElement.getBoundingClientRect();
        if (!lastAnchorRect) return;
        const anchorRect = lastAnchorRect;
        const viewport = view.visualViewport;
        const viewportWidth = viewport?.width || view.innerWidth || doc.documentElement.clientWidth;
        const viewportHeight = viewport?.height || view.innerHeight || doc.documentElement.clientHeight;
        const offsetLeft = viewport?.offsetLeft || 0;
        const offsetTop = viewport?.offsetTop || 0;
        if (fitViewport || !placement) {
            const phone = richPopup && viewportWidth <= PHONE_MAX_WIDTH;
            const margin = phone ? 16 : 8;
            const gap = 4;
            const maxWidth = Math.max(0, viewportWidth - margin * 2);
            const width = phone ? maxWidth : Math.min(Math.max(anchorRect.width || maxWidth, minPopupWidth), maxWidth);
            const left = Math.min(Math.max(anchorRect.left, offsetLeft + margin),
                offsetLeft + viewportWidth - width - margin);
            listWrapper.style.width = `${width}px`;
            const { requiredHeight, fixedHeight, borders, borderBox } = measureMinimumPopupHeight();
            const { upward, anchorVisible, visibleHeight, availableHeight: available, top, bottom } =
                measureFloatingPanelPlacement({ anchorRect, requiredHeight, viewportHeight,
                    layoutHeight: view.innerHeight, offsetTop, margin, gap });
            // Opening and viewport resize may fit around a keyboard or clipped anchor. Scroll never
            // enters this branch: remember the clamped offset so the popup leaves with its button.
            const shortScreen = available < Math.min(requiredHeight, fixedHeight + 44) || !anchorVisible;
            const opensUpward = upward && !shortScreen;
            const fittedTop = shortScreen ? offsetTop + margin : top;
            const fittedBottom = view.innerHeight - bottom;
            placement = { opensUpward, leftOffset: left - anchorRect.left,
                edgeOffset: opensUpward ? fittedBottom - anchorRect.top : fittedTop - anchorRect.bottom,
                maxHeight: Math.min(MAX_POPUP_HEIGHT, shortScreen ? visibleHeight : available),
                minHeight: fixedHeight + 44, borders: borderBox ? 0 : borders };
        }
        const { opensUpward, leftOffset, edgeOffset } = placement;
        listWrapper.classList.toggle('msd-dropdown-list--open-upward', opensUpward);
        listWrapper.style.left = `${anchorRect.left + leftOffset}px`;
        listWrapper.style.top = opensUpward ? '' : `${anchorRect.bottom + edgeOffset}px`;
        listWrapper.style.bottom = opensUpward ? `${view.innerHeight - anchorRect.top - edgeOffset}px` : '';
        heightController.applyBounds(placement);
    }

    function schedulePositionUpdate() {
        if (listWrapper.style.display === 'none' || rafHandle) return;
        rafHandle = view.requestAnimationFrame(() => {
            rafHandle = 0;
            positionListWrapper(fitOnNextFrame);
            fitOnNextFrame = false;
        });
    }

    function scheduleViewportFit() {
        fitOnNextFrame = true;
        schedulePositionUpdate();
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
        view.addEventListener('resize', scheduleViewportFit);
        view.addEventListener('scroll', schedulePositionUpdate, true);
        view.visualViewport?.addEventListener('resize', scheduleViewportFit);
        view.visualViewport?.addEventListener('scroll', schedulePositionUpdate);
        startOwnerConnectionTracking();
        heightController.start();
        positionListWrapper(true);
        // Content updates follow the anchor without changing the opening side or viewport budget.
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
        onView('removeEventListener', 'resize', scheduleViewportFit);
        onView('removeEventListener', 'scroll', schedulePositionUpdate, true);
        view.visualViewport?.removeEventListener?.('resize', scheduleViewportFit);
        view.visualViewport?.removeEventListener?.('scroll', schedulePositionUpdate);
        if (rafHandle) onView('cancelAnimationFrame', rafHandle);
        rafHandle = 0;
        contentResizeObserver?.disconnect();
        contentResizeObserver = null;
        minimumOptionsHeight = null;
        placement = null;
        fitOnNextFrame = false;
        heightController.stop();
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
