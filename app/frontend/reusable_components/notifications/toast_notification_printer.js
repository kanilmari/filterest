// toast_notification_printer.js
// Unified stacking toast notification system with typed placement and persistence options.
// Between application code and visual non-blocking user feedback.
// Exists to consolidate transient and user-dismissed notices without one-off fixed banners.

// ==========================================
// Constants
// ==========================================

const TOAST_CONTAINER_ID        = 'toast-notification-container';
const TOAST_ITEM_CLASS          = 'toast-notification-item';
const TOAST_DEFAULT_DURATION_MS = 5000;
const TOAST_FADE_DURATION_MS    = 300;
const TOAST_MAX_VISIBLE         = 10;
const TOAST_LEVELS              = new Set(['success', 'info', 'warning', 'error']);
const TOAST_POSITIONS           = new Set(['bottom-right', 'top-center']);
const TOAST_VARIANTS            = new Set(['default', 'attention']);

// ==========================================
// Container Management
// ==========================================

/**
 * Returns the shared toast container for one typed screen position.
 * All visual styling comes from toast_notification.css.
 *
 * @param {'bottom-right'|'top-center'} position
 * @returns {HTMLElement}
 */
function getOrCreateToastContainer(position) {
    const containerID = position === 'bottom-right'
        ? TOAST_CONTAINER_ID
        : `${TOAST_CONTAINER_ID}-${position}`;
    let container = document.getElementById(containerID);
    if (container) {
        container.dataset.testid = 'toast-container';
        return container;
    }

    container = document.createElement('div');
    container.id = containerID;
    container.className = 'toast-notification-container';
    container.dataset.toastPosition = position;
    container.dataset.testid = 'toast-container';
    document.body.appendChild(container);
    return container;
}

// ==========================================
// Core Toast Function
// ==========================================

/**
 * showToast — displays a non-blocking notification toast.
 * Multiple calls stack within their selected screen position.
 *
 * @param {Object} options
 * @param {string} [options.message='']     - Text to display (used if no langKey)
 * @param {string} [options.langKey='']     - data-lang-key for auto-translation by lang.js
 * @param {Node|null} [options.content=null] - Optional rich content owned by the caller
 * @param {'success'|'info'|'warning'|'error'} [options.level='info'] - Visual severity
 * @param {number} [options.duration=5000]  - Auto-dismiss delay in ms (0 = manual only)
 * @param {boolean} [options.autoClose=true] - False keeps the toast until user/caller dismissal
 * @param {'bottom-right'|'top-center'} [options.position='bottom-right'] - Screen position
 * @param {'default'|'attention'} [options.variant='default'] - Optional emphasized appearance
 * @param {boolean} [options.dismissOnClick=true] - Whether clicking toast content dismisses it
 * @param {string} [options.dismissLabel='Dismiss'] - Localized close-button accessible label
 * @returns {{element: HTMLElement, dismiss: (options?: {immediate?: boolean}) => void}}
 */
export function showToast({
    message = '',
    langKey = '',
    content = null,
    level = 'info',
    duration = TOAST_DEFAULT_DURATION_MS,
    autoClose = true,
    position = 'bottom-right',
    variant = 'default',
    dismissOnClick = true,
    dismissLabel = 'Dismiss',
} = {}) {
    if (!TOAST_LEVELS.has(level)) {
        throw new TypeError(`Unsupported toast level: ${level}`);
    }
    if (!TOAST_POSITIONS.has(position)) {
        throw new TypeError(`Unsupported toast position: ${position}`);
    }
    if (!TOAST_VARIANTS.has(variant)) {
        throw new TypeError(`Unsupported toast variant: ${variant}`);
    }
    if (!Number.isFinite(duration) || duration < 0) {
        throw new TypeError('Toast duration must be a non-negative finite number');
    }
    if (content !== null && !(content instanceof Node)) {
        throw new TypeError('Toast content must be a DOM Node');
    }
    if (typeof dismissLabel !== 'string' || !dismissLabel.trim()) {
        throw new TypeError('Toast dismiss label must be a non-empty string');
    }

    const container = getOrCreateToastContainer(position);

    const toastElement = document.createElement('div');
    toastElement.className = TOAST_ITEM_CLASS;
    toastElement.dataset.testid = 'toast';
    toastElement.setAttribute('role', 'alert');
    toastElement.setAttribute('aria-live', 'polite');
    toastElement.setAttribute('data-toast-level', level);
    toastElement.setAttribute('data-toast-variant', variant);

    if (content !== null) {
        const contentContainer = document.createElement('div');
        contentContainer.className = 'toast-notification-content';
        contentContainer.appendChild(content);
        toastElement.appendChild(contentContainer);
    } else {
        // Text content span — keeps message separate from the close button
        const textSpan = document.createElement('span');
        textSpan.className = 'toast-notification-text';
        if (langKey) {
            textSpan.dataset.langKey = langKey;
            textSpan.textContent = langKey; // Replaced by lang.js MutationObserver
        } else {
            textSpan.textContent = message;
        }
        toastElement.appendChild(textSpan);
    }

    // Close button — visible × in top-right corner
    const closeBtn = document.createElement('button');
    closeBtn.className = 'toast-notification-close';
    closeBtn.setAttribute('aria-label', dismissLabel.trim());
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        dismissToast();
    });
    toastElement.appendChild(closeBtn);

    // Click anywhere on toast to dismiss
    if (dismissOnClick) {
        toastElement.addEventListener('click', () => dismissToast());
    }
    container.appendChild(toastElement);

    // Enforce maximum visible toasts — remove oldest when cap is exceeded
    const existingToasts = container.querySelectorAll('.' + TOAST_ITEM_CLASS);
    if (existingToasts.length > TOAST_MAX_VISIBLE) {
        existingToasts[0].remove();
    }

    // Fade in on next frame (CSS starts at opacity: 0)
    const scheduleAnimationFrame = globalThis.requestAnimationFrame
        || ((callback) => globalThis.setTimeout(callback, 0));
    scheduleAnimationFrame(() => {
        toastElement.style.opacity = '1';
    });

    // Schedule auto-dismiss
    let autoCloseTimeout = null;
    let dismissRequested = false;
    if (autoClose && duration > 0) {
        autoCloseTimeout = setTimeout(dismissToast, duration);
    }

    function dismissToast({ immediate = false } = {}) {
        if (dismissRequested) {
            return;
        }
        dismissRequested = true;
        if (autoCloseTimeout) clearTimeout(autoCloseTimeout);
        if (immediate) {
            toastElement.remove();
            if (container.childElementCount === 0) container.remove();
            return;
        }
        toastElement.style.opacity = '0';
        // Mark the toast as hidden immediately so invisible remnants do not
        // block pointer events or linger in E2E visibility checks if removal
        // timers are throttled by the browser.
        toastElement.style.visibility = 'hidden';
        toastElement.style.pointerEvents = 'none';
        toastElement.setAttribute('aria-hidden', 'true');
        setTimeout(() => {
            toastElement.remove();
            if (container.childElementCount === 0) container.remove();
        }, TOAST_FADE_DURATION_MS);
    }

    return Object.freeze({ element: toastElement, dismiss: dismissToast });
}

// ==========================================
// Convenience Shorthands
// ==========================================

/**
 * showSuccessToast — green toast for successful operations.
 *
 * @param {string} message
 * @param {number} [duration=5000]
 */
export function showSuccessToast(message, duration = TOAST_DEFAULT_DURATION_MS) {
    showToast({ message, level: 'success', duration });
}

/**
 * showWarningToast — amber toast for non-critical warnings.
 *
 * @param {string} message
 * @param {number} [duration=5000]
 */
export function showWarningToast(message, duration = TOAST_DEFAULT_DURATION_MS) {
    showToast({ message, level: 'warning', duration });
}

/**
 * showErrorToast — red toast for errors and failures.
 *
 * @param {string} message
 * @param {number} [duration=7000] - Longer default: errors need more reading time
 */
export function showErrorToast(message, duration = 7000) {
    showToast({ message, level: 'error', duration });
}

/**
 * showInfoToast — blue toast for neutral informational messages.
 *
 * @param {string} message
 * @param {number} [duration=5000]
 */
export function showInfoToast(message, duration = TOAST_DEFAULT_DURATION_MS) {
    showToast({ message, level: 'info', duration });
}

/**
 * showAccessDeniedToast — standard "access denied" toast with translation support.
 * Drop-in replacement for showAccessDenied() from soft_status_display_helpers.js.
 *
 * @param {string} [actionName] - Optional action name for console debug logging
 */
export function showAccessDeniedToast(actionName = '') {
    if (actionName) {
        console.debug(`[permissions] Access denied for: ${actionName}`);
    }
    showToast({ langKey: 'access_denied_for_action', level: 'warning' });
}
