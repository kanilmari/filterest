// multiselect_dropdown_height_controller.js
// Gives each popup a pointer and keyboard height control with browser-local memory.
// Connects the placement controller's current bounds to an accessible resize separator.
// Keeps optional storage failures and drag listeners inside the popup's lifetime.

export const MAX_POPUP_HEIGHT = 600;
const MIN_POPUP_HEIGHT = 160;
const HEIGHT_STEP = 20;

export function createMultiselectHeightController({ listWrapper, triggerElement, richPopup, onResize }) {
    const view = listWrapper.ownerDocument.defaultView;
    const storageKey = `filterest.multiselect.height.${richPopup ? 'rich' : 'plain'}`;
    const handle = listWrapper.ownerDocument.createElement('div');
    handle.className = 'msd-popup-resize';
    handle.tabIndex = 0;
    handle.setAttribute('role', 'separator');
    handle.setAttribute('aria-orientation', 'horizontal');
    handle.setAttribute('aria-controls', listWrapper.id);
    const title = listWrapper.getAttribute('aria-labelledby');
    if (title) handle.setAttribute('aria-labelledby', title);
    else handle.setAttribute('aria-label', triggerElement.getAttribute('aria-label') || triggerElement.placeholder);
    listWrapper.appendChild(handle);
    let preferredHeight = null;
    let maximumHeight = MAX_POPUP_HEIGHT;
    let minimumHeight = MIN_POPUP_HEIGHT;
    let upward = false;
    let drag = null;

    function remember() {
        try { view.localStorage.setItem(storageKey, String(preferredHeight)); } catch { /* Optional viewer memory. */ }
    }

    function currentHeight() {
        return listWrapper.getBoundingClientRect().height || preferredHeight || maximumHeight;
    }

    function resize(height) {
        preferredHeight = Math.round(Math.min(maximumHeight, Math.max(minimumHeight, height)));
        onResize();
    }

    function move(event) {
        if (!drag || event.pointerId !== drag.id) return;
        resize(drag.height + (event.clientY - drag.y) * (upward ? -1 : 1));
    }

    function stopDrag(event) {
        if (!drag || (event && event.pointerId !== drag.id)) return;
        if (event?.type === 'pointerup') remember();
        const pointerId = drag.id;
        drag = null;
        if (handle.hasPointerCapture?.(pointerId)) handle.releasePointerCapture(pointerId);
        view.removeEventListener('pointermove', move);
        view.removeEventListener('pointerup', stopDrag);
        view.removeEventListener('pointercancel', stopDrag);
    }

    handle.addEventListener('pointerdown', event => {
        if (event.button !== 0 || drag) return;
        event.preventDefault();
        handle.focus({ preventScroll: true });
        drag = { id: event.pointerId, y: event.clientY, height: currentHeight() };
        // Capture keeps the release/click inside the popup even when the grip follows a drag outside it.
        handle.setPointerCapture?.(event.pointerId);
        view.addEventListener('pointermove', move);
        view.addEventListener('pointerup', stopDrag);
        view.addEventListener('pointercancel', stopDrag);
    });
    handle.addEventListener('lostpointercapture', stopDrag);
    handle.addEventListener('keydown', event => {
        if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const delta = (event.key === 'ArrowUp' ? -HEIGHT_STEP : HEIGHT_STEP) * (upward ? -1 : 1);
        resize(event.key === 'Home' ? minimumHeight : event.key === 'End' ? maximumHeight : currentHeight() + delta);
        remember();
    });

    return {
        start() {
            try {
                const stored = Number(view.localStorage.getItem(storageKey));
                if (Number.isFinite(stored) && stored >= MIN_POPUP_HEIGHT && stored <= MAX_POPUP_HEIGHT) preferredHeight = stored;
            } catch { /* Blocked storage keeps this instance's in-memory preference. */ }
        },
        applyBounds({ maxHeight, minHeight, opensUpward, borders = 0 }) {
            maximumHeight = Math.max(0, maxHeight);
            minimumHeight = Math.min(maximumHeight, Math.max(MIN_POPUP_HEIGHT, minHeight));
            upward = opensUpward;
            const height = Math.min(maximumHeight, Math.max(minimumHeight, preferredHeight ?? maximumHeight));
            listWrapper.style.maxHeight = `${Math.max(0, maximumHeight - borders)}px`;
            listWrapper.style.height = preferredHeight === null ? '' : `${Math.max(0, height - borders)}px`;
            handle.setAttribute('aria-valuemin', String(Math.round(minimumHeight)));
            handle.setAttribute('aria-valuemax', String(Math.round(maximumHeight)));
            handle.setAttribute('aria-valuenow', String(Math.round(preferredHeight === null ? currentHeight() : height)));
            handle.classList.toggle('msd-popup-resize--upward', upward);
        },
        stop: () => stopDrag(),
    };
}
