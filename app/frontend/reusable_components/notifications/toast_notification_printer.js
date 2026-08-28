// toast_notification_printer.js
// Unified stacking toast notification system with four severity levels.
// Between application code and visual non-blocking user feedback.
// Exists to consolidate all status messages into one auto-dismissing system.

// ==========================================
// Constants
// ==========================================

const TOAST_CONTAINER_ID        = 'toast-notification-container';
const TOAST_ITEM_CLASS          = 'toast-notification-item';
const TOAST_DEFAULT_DURATION_MS = 5000;
const TOAST_FADE_DURATION_MS    = 300;
const TOAST_MAX_VISIBLE         = 10;

// ==========================================
// Container Management
// ==========================================

/**
 * Returns the shared toast container element, creating it on first call.
 * The container is a fixed-position stack in the bottom-right corner.
 * All visual styling comes from toast_notification.css.
 *
 * @returns {HTMLElement}
 */
function getOrCreateToastContainer() {
    let container = document.getElementById(TOAST_CONTAINER_ID);
    if (container) {
        container.dataset.testid = 'toast-container';
        return container;
    }

    container = document.createElement('div');
    container.id = TOAST_CONTAINER_ID;
    container.dataset.testid = 'toast-container';
    document.body.appendChild(container);
    return container;
}

// ==========================================
// Core Toast Function
// ==========================================

/**
 * showToast — displays a non-blocking notification toast.
 * Multiple calls stack vertically in the bottom-right corner.
 *
 * @param {Object} options
 * @param {string} [options.message='']     - Text to display (used if no langKey)
 * @param {string} [options.langKey='']     - data-lang-key for auto-translation by lang.js
 * @param {'success'|'info'|'warning'|'error'} [options.level='info'] - Visual severity
 * @param {number} [options.duration=5000]  - Auto-dismiss delay in ms (0 = manual only)
 */
export function showToast({
    message = '',
    langKey = '',
    level = 'info',
    duration = TOAST_DEFAULT_DURATION_MS,
} = {}) {
    const container = getOrCreateToastContainer();

    const toastElement = document.createElement('div');
    toastElement.className = TOAST_ITEM_CLASS;
    toastElement.dataset.testid = 'toast';
    toastElement.setAttribute('role', 'alert');
    toastElement.setAttribute('aria-live', 'polite');
    toastElement.setAttribute('data-toast-level', level);

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

    // Close button — visible × in top-right corner
    const closeBtn = document.createElement('button');
    closeBtn.className = 'toast-notification-close';
    closeBtn.setAttribute('aria-label', 'Dismiss');
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        dismissToast();
    });
    toastElement.appendChild(closeBtn);

    // Click anywhere on toast to dismiss
    toastElement.addEventListener('click', dismissToast);
    container.appendChild(toastElement);

    // Enforce maximum visible toasts — remove oldest when cap is exceeded
    const existingToasts = container.querySelectorAll('.' + TOAST_ITEM_CLASS);
    if (existingToasts.length > TOAST_MAX_VISIBLE) {
        existingToasts[0].remove();
    }

    // Fade in on next frame (CSS starts at opacity: 0)
    requestAnimationFrame(() => {
        toastElement.style.opacity = '1';
    });

    // Schedule auto-dismiss
    let autoCloseTimeout = null;
    let dismissRequested = false;
    if (duration > 0) {
        autoCloseTimeout = setTimeout(dismissToast, duration);
    }

    function dismissToast() {
        if (dismissRequested) {
            return;
        }
        dismissRequested = true;
        if (autoCloseTimeout) clearTimeout(autoCloseTimeout);
        toastElement.style.opacity = '0';
        // Mark the toast as hidden immediately so invisible remnants do not
        // block pointer events or linger in E2E visibility checks if removal
        // timers are throttled by the browser.
        toastElement.style.visibility = 'hidden';
        toastElement.style.pointerEvents = 'none';
        toastElement.setAttribute('aria-hidden', 'true');
        setTimeout(() => toastElement.remove(), TOAST_FADE_DURATION_MS);
    }
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
