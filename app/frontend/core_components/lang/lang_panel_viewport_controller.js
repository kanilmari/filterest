// lang_panel_viewport_controller.js
// Fits the open language menu to the viewport outside scrolling ancestors.
// Connects the selector's lifetime and keyboard order to the shared popup placement rule.
// Keeps translated options reachable while preserving button focus and native radio keys.

import { measureFloatingPanelPlacement } from '../../reusable_components/floating_panel_placement.js';

const VIEWPORT_MARGIN = 8;
const SELECTOR_GAP = 10;
const openPanels = new Set();

/** Mount fixed overlays like multiselect popups; return them to their selector when closed. */
export function createLanguagePanelViewportController({ languageSelector, languageButton, panel, signal }) {
    const doc = languageSelector.ownerDocument;
    const view = doc.defaultView;
    const lifetime = new view.AbortController();
    let isOpen = false;
    let frame = 0;
    let contentObserver = null;
    let wasConnected = languageSelector.isConnected;

    function positionPanel() {
        if (!isOpen) return;
        const anchorRect = languageSelector.getBoundingClientRect();
        const viewport = view.visualViewport;
        const viewportWidth = viewport?.width || view.innerWidth;
        const viewportHeight = viewport?.height || view.innerHeight;
        const offsetLeft = viewport?.offsetLeft || 0;
        const offsetTop = viewport?.offsetTop || 0;
        const maxWidth = Math.max(0, viewportWidth - VIEWPORT_MARGIN * 2);
        panel.style.minWidth = `${Math.min(Math.max(languageButton.offsetWidth + 132, 220), maxWidth)}px`;
        panel.style.maxWidth = `${maxWidth}px`;
        // A previous desktop left offset must not shrink the fixed panel before a phone-width measurement.
        panel.style.left = `${offsetLeft + VIEWPORT_MARGIN}px`;
        panel.style.right = 'auto';
        // scrollHeight includes capped content at the current width. Keep the live
        // scroll box capped: expanding it for a layout read clamps scrollTop to zero.
        const style = view.getComputedStyle(panel);
        const borders = (Number.parseFloat(style.borderTopWidth) || 0)
            + (Number.parseFloat(style.borderBottomWidth) || 0);
        const rect = panel.getBoundingClientRect();
        const requiredHeight = Math.max(rect.height, panel.scrollHeight + borders);
        const { upward, availableHeight, visibleHeight, anchorVisible, top, bottom } =
            measureFloatingPanelPlacement({ anchorRect, requiredHeight, viewportHeight,
                layoutHeight: view.innerHeight, offsetTop, margin: VIEWPORT_MARGIN, gap: SELECTOR_GAP });
        const width = Math.min(rect.width, maxWidth);
        panel.style.left = `${Math.max(offsetLeft + VIEWPORT_MARGIN,
            Math.min(anchorRect.right - width, offsetLeft + viewportWidth - VIEWPORT_MARGIN - width))}px`;
        panel.style.maxHeight = `${anchorVisible ? availableHeight : visibleHeight}px`;
        panel.style.top = !anchorVisible ? `${offsetTop + VIEWPORT_MARGIN}px` : upward ? '' : `${top}px`;
        panel.style.bottom = anchorVisible && upward ? `${bottom}px` : '';
    }

    function schedulePosition() {
        if (!isOpen || frame) return;
        frame = view.requestAnimationFrame(() => { frame = 0; positionPanel(); });
    }

    function handleScroll(event) {
        // Captured scroll includes the panel and any scrolling descendants. Those
        // reveal options; only scrolling outside the panel can move its anchor.
        if (event.target instanceof view.Node && panel.contains(event.target)) return;
        schedulePosition();
    }

    function stopTracking() {
        view.removeEventListener('resize', schedulePosition);
        view.removeEventListener('scroll', handleScroll, true);
        view.visualViewport?.removeEventListener('resize', schedulePosition);
        view.visualViewport?.removeEventListener('scroll', handleScroll);
        if (frame) view.cancelAnimationFrame(frame);
        frame = 0;
        contentObserver?.disconnect();
        contentObserver = null;
    }

    function setOpen(nextOpen) {
        if (lifetime.signal.aborted || nextOpen === isOpen) return;
        isOpen = nextOpen;
        panel.classList.toggle('hidden', !isOpen);
        languageButton.setAttribute('aria-expanded', String(isOpen));
        if (!isOpen) {
            openPanels.delete(controller);
            stopTracking();
            languageSelector.appendChild(panel);
            return;
        }
        for (const other of openPanels) other.setOpen(false);
        openPanels.add(controller);
        // Keep an enclosing modal's layer when present, just as multiselect's caller-owned portal does.
        (languageSelector.closest('#custom_modal_overlay') || doc.body).appendChild(panel);
        positionPanel();
        view.addEventListener('resize', schedulePosition);
        view.addEventListener('scroll', handleScroll, true);
        view.visualViewport?.addEventListener('resize', schedulePosition);
        view.visualViewport?.addEventListener('scroll', handleScroll);
        if (typeof view.ResizeObserver === 'function') {
            contentObserver = new view.ResizeObserver(schedulePosition);
            contentObserver.observe(languageSelector);
            contentObserver.observe(panel.firstElementChild);
        }
    }

    function handleKeydown(event) {
        if (!isOpen) return;
        if (event.key === 'Escape') {
            event.preventDefault();
            setOpen(false);
            languageButton.focus();
        } else if (event.key === 'Tab') {
            if (event.target === languageButton && !event.shiftKey) {
                event.preventDefault();
                // A modal's document-level Tab trap must not redirect our portalled radio focus.
                event.stopPropagation();
                // Native focus also reveals a radio inside the capped menu's own scroll area.
                (panel.querySelector('input:checked') || panel.querySelector('input'))?.focus();
            } else if (panel.contains(event.target)) {
                // For forward Tab, the browser resumes its normal tab order from the original button.
                // Backward Tab returns directly there. Neither direction traps focus in the overlay.
                if (event.shiftKey) {
                    event.preventDefault();
                    event.stopPropagation();
                }
                languageButton.focus({ preventScroll: true });
            }
        }
    }

    function dispose() {
        setOpen(false);
        ownerObserver.disconnect();
        lifetime.abort();
        signal?.removeEventListener('abort', dispose);
    }

    const controller = { setOpen, dispose, signal: lifetime.signal };
    const ownerObserver = new view.MutationObserver(() => {
        // Filter-bar builders initialize detached selectors before the completed view is mounted.
        if (languageSelector.isConnected) wasConnected = true;
        else if (wasConnected) dispose();
    });
    ownerObserver.observe(doc.documentElement, { childList: true, subtree: true });
    signal?.addEventListener('abort', dispose, { once: true });
    const listenerOptions = { signal: lifetime.signal };
    doc.addEventListener('click', event => {
        if (!languageSelector.contains(event.target) && !panel.contains(event.target)) setOpen(false);
    }, listenerOptions);
    // The portal is still an inside-selector interaction. In particular, the navbar's
    // document click handler must not collapse it before a radio's native change fires.
    panel.addEventListener('click', event => event.stopPropagation(), listenerOptions);
    languageSelector.addEventListener('keydown', handleKeydown, listenerOptions);
    panel.addEventListener('keydown', handleKeydown, listenerOptions);
    return controller;
}
