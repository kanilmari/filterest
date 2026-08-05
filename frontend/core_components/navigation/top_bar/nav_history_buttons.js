// nav_history_buttons.js
// Manages back/forward navigation buttons and URL-stack history in the top bar.
// Bridges in-app navigation events and the browser History API (pushState/popstate).
// Exists to keep browser-native and in-app back/forward in sync via a shared URL stack.

/**
 * Navigation history stack.
 * We maintain our own stack of visited URLs and a pointer (cursor)
 * into that stack to know where we are.
 * - Back is enabled when cursor > 0
 * - Forward is enabled when cursor < stack.length - 1
 *
 * This is more robust than simple counters because it correctly handles:
 *   - Browser-native back/forward buttons
 *   - New navigation after going back (which clears forward history)
 *   - replaceState calls (which don't add to the stack)
 */
const navStack = [window.location.pathname + window.location.search];
let cursor = 0;
let navigatingViaButton = false;

const backBtn = document.getElementById('navBackBtn');
const forwardBtn = document.getElementById('navForwardBtn');

/**
 * Updates the disabled state of back/forward buttons
 * based on current position in the navigation stack.
 */
function updateButtonStates() {
    if (backBtn) {
        backBtn.disabled = cursor <= 0;
    }
    if (forwardBtn) {
        forwardBtn.disabled = cursor >= navStack.length - 1;
    }
}

// --- Intercept history.pushState to track navigation ---
// Monkey-patching pushState is the standard approach (no native event exists for pushState).
// We use a Symbol key to prevent double-patching if this module loads twice.
const PATCHED = Symbol.for('navHistoryPatched');
if (!history[PATCHED]) {
    const originalPushState = history.pushState.bind(history);
    history.pushState = function (state, title, url) {
        originalPushState(state, title, url);
        // New navigation clears forward history (everything after cursor)
        navStack.splice(cursor + 1);
        navStack.push(url || window.location.pathname + window.location.search);
        cursor = navStack.length - 1;
        updateButtonStates();
    };
    history[PATCHED] = true;
}

// --- Listen for popstate (browser back/forward or our buttons) ---
window.addEventListener('popstate', () => {
    const currentUrl = window.location.pathname + window.location.search;

    // If triggered by our own buttons, navigatingViaButton flag is set
    // and cursor is already updated — just refresh button states.
    if (navigatingViaButton) {
        navigatingViaButton = false;
        updateButtonStates();
        return;
    }

    // Browser-native back/forward: find the URL in our stack to sync cursor.
    // Check neighbors first (most common case), then search wider.
    if (cursor > 0 && navStack[cursor - 1] === currentUrl) {
        cursor--;
    } else if (cursor < navStack.length - 1 && navStack[cursor + 1] === currentUrl) {
        cursor++;
    } else {
        // URL not adjacent — search entire stack from the end
        const idx = navStack.lastIndexOf(currentUrl);
        if (idx !== -1) {
            cursor = idx;
        }
        // If not found at all, don't change cursor — could be external navigation
    }

    updateButtonStates();
});

// --- Button click handlers ---
if (backBtn) {
    backBtn.addEventListener('click', () => {
        if (cursor > 0) {
            cursor--;
            navigatingViaButton = true;
            updateButtonStates();
            history.back();
        }
    });
}

if (forwardBtn) {
    forwardBtn.addEventListener('click', () => {
        if (cursor < navStack.length - 1) {
            cursor++;
            navigatingViaButton = true;
            updateButtonStates();
            history.forward();
        }
    });
}

// Initial state
updateButtonStates();
