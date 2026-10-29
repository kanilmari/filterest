// image_controls_idle.js
// Shares the article image controls' 1200 ms idle lifecycle across presentations.
// Connects pointer and keyboard activity to each surface's existing CSS gate.
// Touch visibility and reduced-motion fades remain owned by presentation CSS.

const CONTROL_IDLE_DELAY_MS = 1200;
const CONTROL_SELECTOR = [
    ".modal_close_button",
    ".row_article_image_first_arrow",
    ".row_article_row_navigation_button",
    ".row_article_image_first_scroll_hint",
].join(", ");
const bindings = new WeakMap();

/** Reveal on activity, hold over controls, and return an idempotent teardown.
 * Reinstalling on the same root first releases its previous timer/listeners.
 * Focus reveals immediately; presentation CSS preserves keyboard focus visibility.
 */
export function installImageControlsIdle(root, activeClass) {
    bindings.get(root)?.();
    let timer;
    const clearTimer = () => {
        window.clearTimeout(timer);
        timer = undefined;
    };
    const scheduleHide = () => {
        clearTimer();
        timer = window.setTimeout(() => {
            timer = undefined;
            root.classList.remove(activeClass);
        }, CONTROL_IDLE_DELAY_MS);
    };
    const isControl = target => target instanceof Element
        && root.contains(target) && Boolean(target.closest(CONTROL_SELECTOR));
    const reveal = (keepVisible = false) => {
        root.classList.add(activeClass);
        if (keepVisible) clearTimer();
        else scheduleHide();
    };
    const handlers = {
        pointermove: event => reveal(isControl(event.target)),
        pointerover: event => { if (isControl(event.target)) reveal(true); },
        pointerout: event => {
            if (isControl(event.target) && !isControl(event.relatedTarget)) scheduleHide();
        },
        pointerleave: scheduleHide,
        focusin: () => reveal(),
    };
    for (const [event, handler] of Object.entries(handlers)) root.addEventListener(event, handler);
    let disposed = false;
    const teardown = () => {
        if (disposed) return;
        disposed = true;
        clearTimer();
        for (const [event, handler] of Object.entries(handlers)) root.removeEventListener(event, handler);
        root.classList.remove(activeClass);
        bindings.delete(root);
    };
    bindings.set(root, teardown);
    reveal();
    return teardown;
}
