// browser_view_readiness.mjs
// Waits for the visible page's shell, fonts, media and finite animations.
// Bridges browser tests and audit tools with observable rendering readiness.
// Keeps administrator SSE connections out of the page-ready decision.
/* global document, window, Element, getComputedStyle */

/** Self-contained because Playwright serializes this predicate into the page. */
export function isVisiblePageReady() {
    const body = document.body;
    if (!body || body.classList.contains('loading')) return false;
    if (window.__filterestShellBoot && !window.__filterestShellBoot.status().ready) return false;
    if (document.fonts && document.fonts.status !== 'loaded') return false;

    const visible = element => element.getClientRects().length > 0
        && !['hidden', 'collapse'].includes(getComputedStyle(element).visibility);
    if ([...document.querySelectorAll('.loading-indicator-spinner, [aria-busy="true"]')].some(visible)) return false;
    if ([...document.images].some(image => {
        if (!visible(image) || image.complete) return false;
        const bounds = image.getBoundingClientRect();
        // Offscreen lazy images have not been requested and cannot finish yet.
        return image.loading !== 'lazy' || (bounds.bottom > 0 && bounds.top < window.innerHeight
            && bounds.right > 0 && bounds.left < window.innerWidth);
    })) return false;

    // Infinite decorative animations never settle. Finite transitions on the
    // visible shell do: a quiet network or two equal early boxes cannot prove it.
    return !(document.getAnimations?.() || []).some(animation => {
        const target = animation.effect?.target;
        return (animation.pending || animation.playState === 'running')
            && animation.effect?.getTiming().iterations !== Infinity
            && target instanceof Element && visible(target);
    });
}

/** Wait for rendered content, independent of open SSE or other background traffic. */
export async function waitForVisiblePageReady(page, { timeout = 15000 } = {}) {
    await page.waitForFunction(isVisiblePageReady, null, { polling: 'raf', timeout });
}
