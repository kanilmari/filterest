// modal_backdrop.js
// Distinguishes intentional backdrop activation from a selection ending outside a dialog.
// Connects pointer and assistive activation with each dialog's dismissal policy.
// Keeps drafts intact without disabling ordinary dismissal for other dialogs.

export function bindModalBackdrop(overlay, onDismiss, getGeneration = () => 0, canDismiss = () => true) {
    let press = null;
    overlay.addEventListener('pointerdown', event => {
        press = event.target === overlay && event.isPrimary && event.button === 0
            ? { id: event.pointerId, generation: getGeneration(), released: false } : null;
    }, true);
    overlay.addEventListener('pointercancel', () => { press = null; }, true);
    overlay.addEventListener('pointerup', event => {
        if (!press || press.id !== event.pointerId || event.target !== overlay || !event.isPrimary || event.button !== 0) {
            press = null;
            return;
        }
        // Touch/pen can deliver the release to the pressed element even after moving over the form.
        const doc = overlay.ownerDocument;
        press.released = event.pointerType === 'mouse' || !doc.elementFromPoint
            || doc.elementFromPoint(event.clientX, event.clientY) === overlay;
    }, true);
    overlay.addEventListener('click', event => {
        // Classify this activation, not earlier pointer history: canceled gestures
        // and releases whose click never arrives must not consume the next assistive click.
        // Physical clicks have positive detail and/or a pointer type and still need a valid press.
        const nonPointerActivation = event.detail === 0
            && !event.pointerType && (event.pointerId === undefined || event.pointerId < 0);
        const accepted = canDismiss() && (nonPointerActivation || (press?.released && event.button === 0
            && press.generation === getGeneration()
            && (event.pointerId === undefined || event.pointerId === press.id)));
        press = null;
        if (event.target !== overlay) return;
        if (!accepted) {
            // Confirm/input/sort dialogs also listen on the overlay to resolve their cancellation promises.
            event.stopImmediatePropagation();
            return;
        }
        onDismiss();
    }, true);
}
