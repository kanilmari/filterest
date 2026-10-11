// mobile_topbar_search_controller.js
// Toggles the existing dataset search field from the phone toolbar.
// Connects translated button state to shared search input and view lifetime.
// Keeps site identity and corner controls stationary while opening and closing.
import { createMaskIconSpan } from '../../icons/icon_mask_builder.js';
import { getLanguageWithBrowserFallback } from '../state_stores/lang_preference_reader.js';
import { getTranslationForKey } from '../lang/translation_handler.js';

const COPY = {
    fi: ['Näytä haku', 'Piilota haku'],
    en: ['Show search', 'Hide search'],
    'zh-CN': ['显示搜索', '隐藏搜索'],
    'zh-TW': ['顯示搜尋', '隱藏搜尋'],
    'zh-HK': ['顯示搜尋', '隱藏搜尋'],
};

/** The toggle controls visibility only; submission stays with the existing search component. */
export function createMobileTopbarSearchController(bar) {
    const search = bar.querySelector('.dataset-search-panel');
    const identity = bar.querySelector('.dataset-shared-topbar__site-identity');
    const end = bar.querySelector('.dataset-shared-topbar__slot--end');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'dataset-shared-topbar__search-toggle';
    button.dataset.testid = 'mobile-search-toggle';
    search.id ||= `${bar.dataset.filterbarSharedTopbarFor}_mobile_topbar_search`;
    button.setAttribute('aria-controls', search.id);
    button.append(createMaskIconSpan('/frontend/icons/general/dataset-search-icon.svg', ['filterbar-section-heading-icon']));
    end.append(button);
    const lifetime = new AbortController();
    let phone = false;
    let active = false;
    let open = false;

    function refreshCopy() {
        const language = getLanguageWithBrowserFallback();
        const copy = COPY[language === 'ch' ? 'zh-CN' : language === 'yue' ? 'zh-HK' : language] || COPY.en;
        const key = open ? 'filterbar_hide_search' : 'filterbar_show_search';
        button.dataset.ariaLabelLangKey = button.dataset.titleLangKey = key;
        button.title = getTranslationForKey(key, { fallback: copy[Number(open)], countUsage: false });
        button.setAttribute('aria-label', button.title);
    }

    function render() {
        button.hidden = !phone;
        button.tabIndex = phone && active ? 0 : -1;
        button.setAttribute('aria-hidden', String(!phone || !active));
        button.setAttribute('aria-pressed', String(open));
        button.setAttribute('aria-expanded', String(open));
        const visible = !phone || open;
        search.hidden = !visible;
        search.inert = !visible;
        search.setAttribute('aria-hidden', String(!visible));
        if (!visible && search.contains(document.activeElement)) document.activeElement.blur();
        identity.hidden = !phone;
        refreshCopy();
    }

    function close() {
        open = false;
        render();
        button.focus({ preventScroll: true });
    }

    button.addEventListener('click', event => {
        event.stopPropagation();
        if (!phone || !active) return;
        if (open) close();
        else {
            open = true;
            render();
            search.querySelector('input:not([type="checkbox"]):not([disabled])')?.focus({ preventScroll: true });
        }
    }, { signal: lifetime.signal });
    bar.addEventListener('keydown', event => {
        if (event.key !== 'Escape' || !phone || !open) return;
        event.preventDefault();
        event.stopPropagation();
        close();
    }, { signal: lifetime.signal });
    const languageObserver = new MutationObserver(refreshCopy);
    languageObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
    return {
        sync(state) {
            phone = state.phone;
            active = state.active;
            if (!phone || !active) open = false;
            render();
        },
        destroy() { lifetime.abort(); languageObserver.disconnect(); button.remove(); },
    };
}
