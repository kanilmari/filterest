// loading_indicator_printer.js
// Unified loading spinner replacing scattered per-component loading text.
// Between async operations (navigation, API calls) and visual loading feedback.
// Exists to give immediate, consistent visual feedback that the app is working.

// ==========================================
// Constants
// ==========================================

const LOADING_SPINNER_ATTR_KEY  = 'data-loading-spinner-for';
const LOADING_SPINNER_CLASS     = 'loading-indicator-spinner';
const LOADING_GLOBAL_CONTAINER  = 'loading-indicator-global-overlay';
const SPINNER_SIZE_PX           = 32;

// ==========================================
// Spinner Element Factory
// ==========================================

/**
 * Creates a CSS-animated spinner element.
 * Pure CSS-in-JS — no external stylesheets required.
 *
 * @param {string} [targetId] - ID of the target container (used as identifier attr)
 * @returns {HTMLElement}
 */
function createSpinnerElement(targetId) {
    const wrapper = document.createElement('div');
    wrapper.className = LOADING_SPINNER_CLASS;
    if (targetId) {
        wrapper.setAttribute(LOADING_SPINNER_ATTR_KEY, targetId);
    }

    Object.assign(wrapper.style, {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '2rem',
        width: '100%',
        boxSizing: 'border-box',
    });

    // Inject the CSS animation once (idempotent)
    _ensureSpinnerStyles();

    const spinnerRing = document.createElement('div');
    Object.assign(spinnerRing.style, {
        width: `${SPINNER_SIZE_PX}px`,
        height: `${SPINNER_SIZE_PX}px`,
        border: '3px solid color-mix(in srgb, var(--text_color) 15%, transparent)',
        borderTopColor: 'color-mix(in srgb, var(--text_color) 70%, transparent)',
        borderRadius: '50%',
        animation: 'loading-indicator-spin 0.8s linear infinite',
    });

    wrapper.appendChild(spinnerRing);
    return wrapper;
}

/**
 * Injects the keyframe animation style tag into <head> once.
 * Subsequent calls are no-ops.
 * Sets CSP nonce so the style is not blocked by Content-Security-Policy.
 */
function _ensureSpinnerStyles() {
    if (document.getElementById('loading-indicator-styles')) return;
    const style = document.createElement('style');
    style.id = 'loading-indicator-styles';

    /* CSP nonce: read from <meta name="csp-nonce"> injected by Go template */
    const nonce = document.querySelector('meta[name="csp-nonce"]')?.getAttribute('content');
    if (nonce) style.setAttribute('nonce', nonce);

    style.textContent = `
        @keyframes loading-indicator-spin {
            to { transform: rotate(360deg); }
        }
    `;
    document.head.appendChild(style);
}

// ==========================================
// Public API
// ==========================================

/**
 * showLoadingIndicator — inserts a spinner into the target container.
 * If the container element does not exist yet, appends to a fixed global overlay.
 * Idempotent: calling twice for the same targetId is safe (no duplicate spinners).
 *
 * @param {string} [targetId] - Element ID to show spinner inside.
 *                              If omitted, a fixed full-width overlay is used.
 */
export function showLoadingIndicator(targetId) {
    // Guard: don't create duplicate spinners for the same target
    if (targetId && document.querySelector(`[${LOADING_SPINNER_ATTR_KEY}="${targetId}"]`)) {
        return;
    }

    const targetElement = targetId ? document.getElementById(targetId) : null;

    if (targetElement) {
        // Prepend spinner into the target container
        const spinner = createSpinnerElement(targetId);
        targetElement.prepend(spinner);
    } else {
        // Fallback: use a fixed global overlay
        let overlay = document.getElementById(LOADING_GLOBAL_CONTAINER);
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = LOADING_GLOBAL_CONTAINER;
            Object.assign(overlay.style, {
                position: 'fixed',
                top: '0',
                left: '0',
                width: '100%',
                height: '100%',
                background: 'transparent',
                zIndex: '99990',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                pointerEvents: 'none',
            });
            document.body.appendChild(overlay);
        }
        const spinner = createSpinnerElement(targetId || '_global');
        overlay.appendChild(spinner);
    }
}

/**
 * hideLoadingIndicator — removes the spinner for the given target.
 * Safe to call even if no spinner is currently shown.
 *
 * @param {string} [targetId] - Element ID whose spinner should be removed.
 *                              If omitted, removes the global overlay.
 */
export function hideLoadingIndicator(targetId) {
    if (targetId) {
        const spinner = document.querySelector(`[${LOADING_SPINNER_ATTR_KEY}="${targetId}"]`);
        if (spinner) spinner.remove();
    } else {
        const overlay = document.getElementById(LOADING_GLOBAL_CONTAINER);
        if (overlay) overlay.remove();
    }
}

/**
 * withLoadingIndicator — wraps an async function with show/hide loading state.
 * The spinner is always hidden via finally, even if the function throws.
 *
 * @param {string} [targetId]   - Container element ID to show spinner in
 * @param {Function} asyncFn    - Async function to execute while showing spinner
 * @returns {Promise<any>}      - Resolves/rejects with asyncFn's result
 *
 * @example
 *   const data = await withLoadingIndicator('search_results_container', async () => {
 *       return await endpoint_router('getResults', { ... });
 *   });
 */
export async function withLoadingIndicator(targetId, asyncFn) {
    showLoadingIndicator(targetId);
    try {
        return await asyncFn();
    } finally {
        hideLoadingIndicator(targetId);
    }
}
