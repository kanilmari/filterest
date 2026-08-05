// recent_tab_saver.js
// Persists and reflects the recently-viewed tab list in localStorage and nav button classes.
// Bridges tab navigation events with the recently_viewed_tabs store and DOM button state.
// Exists to centralise recently-viewed read/write logic so all nav paths share one source of truth.

import { rotateRecentList, removeKeyFromList } from './recent_tab_saver_helpers.js';

const MAX_RECENT_TABS = 5;

// Tracks the AbortController for contextmenu listeners from the previous update call.
// Aborted at the start of each update so listeners don't accumulate across calls.
let currentContextmenuController = null;

export function update_recently_viewed_list(tab_key) {
    const rv_list_str = localStorage.getItem('recently_viewed_tabs');
    const rv_list = rv_list_str ? JSON.parse(rv_list_str) : [];

    const updated = rotateRecentList(rv_list, tab_key, MAX_RECENT_TABS);
    localStorage.setItem('recently_viewed_tabs', JSON.stringify(updated));
}

export function remove_from_recently_viewed(tab_key) {
    const rv_list_str = localStorage.getItem('recently_viewed_tabs');
    if (!rv_list_str) return;

    const rv_list = JSON.parse(rv_list_str);
    const updated = removeKeyFromList(rv_list, tab_key);
    localStorage.setItem('recently_viewed_tabs', JSON.stringify(updated));
}

export function update_recently_viewed_status() {
    // Cancel all contextmenu listeners added in previous calls to prevent accumulation
    if (currentContextmenuController) {
        currentContextmenuController.abort();
    }
    currentContextmenuController = new AbortController();
    const signal = currentContextmenuController.signal;

    const navigation_buttons = document.querySelectorAll('.general_button_nav');
    const rv_list_str = localStorage.getItem('recently_viewed_tabs');

    if (!rv_list_str) {
        navigation_buttons.forEach(button => {
            button.classList.remove('recently_viewed');
            button.removeAttribute('title');
        });
    } else {
        const rv_list = JSON.parse(rv_list_str);
        navigation_buttons.forEach(button => {
            const button_key = button.dataset.langKey;
            const is_active = button.classList.contains('active');
            if (rv_list.includes(button_key) && !is_active) {
                button.classList.add('recently_viewed');
                button.setAttribute('title', 'Recently viewed (right-click to clear)');
                button.addEventListener(
                    'contextmenu',
                    function (evt) {
                        // Alt+rightclick → let it bubble to dev lang key editor
                        if (evt.altKey) return;
                        evt.preventDefault();
                        remove_from_recently_viewed(button_key);
                        update_recently_viewed_status();
                    },
                    { signal, once: true }
                );
            } else {
                button.classList.remove('recently_viewed');
                button.removeAttribute('title');
            }
        });
    }

    const groups_with_rv = new Set();
    navigation_buttons.forEach(button => {
        if (button.classList.contains('recently_viewed')) {
            groups_with_rv.add(button.dataset.group);
        }
    });

    const all_headings = document.querySelectorAll('.collapsible');
    all_headings.forEach(heading => {
        heading.classList.remove('child-rv');
    });
    groups_with_rv.forEach(g => {
        const heading = document.querySelector(`.collapsible[data-group="${g}"]`);
        if (heading && !heading.classList.contains('child-active')) {
            heading.classList.add('child-rv');
        }
    });
}
