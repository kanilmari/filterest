// front_page_navigation.js
// Opens the optional Home view through the existing navigation pipeline.
// Bridges the hidden view with the site-root address and selection/title owners.
// Keeps duplicate clicks and aborted navigation from creating history entries.

import { handle_all_navigation } from '../navigation/nav_engine/navigation_handler.js';
import { custom_views } from '../navigation/admin_and_user_tools/custom_view_reader.js';
import { clearSelectedDataset } from '../state_stores/dataset_selection_saver.js';
import { writeHistoryEntry } from '../navigation/nav_engine/history_entry_state.js';
import { updateBrowserTabTitle } from '../navigation/nav_engine/browser_tab_title_writer.js';
import { refreshMainTabPresentation } from '../navigation/main_tabs/main_tab_active_state.js';
import { getSessionGeneration, isSessionValidationRequired, revalidateSessionIdentity,
    subscribeToSessionGeneration } from '../auth/session_generation_store.js';

let pendingOpen = null;
let openGeneration = 0;
subscribeToSessionGeneration(() => {
    openGeneration += 1;
    pendingOpen = null;
});

export function isSeparateFrontPageEnabled() {
    return localStorage.getItem('separate_front_page') === 'true';
}

export function isFrontPageShowing() {
    const container = document.getElementById('front_page_container');
    return Boolean(container?.isConnected && !container.classList.contains('hidden')
        && container.dataset.sessionGeneration === String(getSessionGeneration())
        && container.hasChildNodes());
}

/** A bootstrap passes forceReload so a visible page belongs to the new session. */
export function openFrontPage({ replace = false, forceReload = false, isCurrentNavigation } = {}) {
    if (!isSeparateFrontPageEnabled()) return Promise.resolve({ abort: true, reason: 'front_page_disabled' });
    if (pendingOpen && (!forceReload || pendingOpen.forceReload)) return pendingOpen.promise;
    if (isFrontPageShowing() && !forceReload && !isSessionValidationRequired()) return Promise.resolve({ abort: false });

    const generation = ++openGeneration;
    const sessionGeneration = getSessionGeneration();
    const isCurrent = () => generation === openGeneration && sessionGeneration === getSessionGeneration()
        && isCurrentNavigation?.() !== false;
    const opening = { forceReload, promise: null };
    pendingOpen = opening;
    opening.promise = (async () => {
        if (isSessionValidationRequired()) {
            try { await revalidateSessionIdentity(); }
            catch { return { abort: true, reason: 'session_unverified' }; }
        }
        if (!isCurrent()) return { abort: true, reason: 'stale_navigation' };
        const result = await handle_all_navigation('front_page', custom_views, {
            skipUrlUpdate: true, forceReload,
            isCurrentNavigation: isCurrent,
        });
        if (result?.abort) return result;
        if (!isCurrent() || !isFrontPageShowing()) return { abort: true, reason: 'stale_navigation' };
        clearSelectedDataset();
        writeHistoryEntry('/', {}, { replace });
        // The pipeline retitled before the root address and cleared selection existed.
        await updateBrowserTabTitle();
        if (!isCurrent()) return { abort: true, reason: 'stale_navigation' };
        refreshMainTabPresentation();
        return { abort: false };
    })().finally(() => { if (pendingOpen === opening) pendingOpen = null; });
    return opening.promise;
}
