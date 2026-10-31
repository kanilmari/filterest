// mobile_topbar_search_controller.js
// Toggles the existing dataset search field on phones and measured desktop button layouts.
// Connects translated button state to shared search input and view lifetime.
// Covers the name in the same row while keeping corner controls stationary.
import { createMaskIconSpan } from '../../icons/icon_mask_builder.js';
import { getLanguageWithBrowserFallback } from '../state_stores/lang_preference_reader.js';
import { getTranslationForKey } from '../lang/translation_handler.js';

export const SEARCH_FIELD_MIN_WIDTH = 280;

/** Decide from full title and field-mode controls, independently of the current mode. */
export function shouldUseTopbarSearchButton({ innerWidth, titleWidth, startWidth, endWidth, columnGap }) {
    return titleWidth + startWidth + SEARCH_FIELD_MIN_WIDTH + endWidth + 2 * columnGap > innerWidth;
}

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
    const title = bar.querySelector('.dataset-shared-topbar__dataset-title');
    const inner = bar.querySelector('.dataset-shared-topbar__inner');
    const start = bar.querySelector('.dataset-shared-topbar__slot--start');
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
    let buttonMode = false;
    let destroyed = false;

    // Read occupied controls, not a stretched grid track. Excluding the toggle
    // also excludes its gap, so entering button mode cannot change the decision.
    function occupiedWidth(slot, excluded) {
        const style = getComputedStyle(slot);
        const number = value => Number.parseFloat(value) || 0;
        const children = [...slot.children].filter(child => child !== excluded
            && child.getBoundingClientRect().width > 0);
        return children.reduce((width, child) => {
            const childStyle = getComputedStyle(child);
            return width + child.getBoundingClientRect().width
                + number(childStyle.marginInlineStart) + number(childStyle.marginInlineEnd);
        }, 0) + Math.max(0, children.length - 1) * number(style.columnGap)
            + number(style.paddingInlineStart) + number(style.paddingInlineEnd);
    }

    function measure() {
        if (destroyed) return;
        const width = inner.getBoundingClientRect().width;
        let nextButtonMode = false;
        if (!phone && width > 0) {
            const columnGap = Number.parseFloat(getComputedStyle(inner).columnGap) || 0;
            const startWidth = occupiedWidth(start, title);
            const endWidth = Math.max(occupiedWidth(end, button), Number.parseFloat(getComputedStyle(end).minWidth) || 0);
            nextButtonMode = shouldUseTopbarSearchButton({ innerWidth: width,
                titleWidth: title?.scrollWidth ?? 0, startWidth, endWidth, columnGap });
            const offsets = { '--topbar-search-start': startWidth,
                '--topbar-search-end': end.getBoundingClientRect().width + columnGap };
            for (const [property, value] of Object.entries(offsets)) {
                if (inner.style.getPropertyValue(property) !== `${value}px`) inner.style.setProperty(property, `${value}px`);
            }
        }
        if (buttonMode !== nextButtonMode) {
            buttonMode = nextButtonMode;
            open = false;
        }
        render();
    }

    function refreshCopy() {
        const language = getLanguageWithBrowserFallback();
        const copy = COPY[language === 'ch' ? 'zh-CN' : language === 'yue' ? 'zh-HK' : language] || COPY.en;
        const key = open ? 'filterbar_hide_search' : 'filterbar_show_search';
        button.dataset.ariaLabelLangKey = button.dataset.titleLangKey = key;
        button.title = getTranslationForKey(key, { fallback: copy[Number(open)], countUsage: false });
        button.setAttribute('aria-label', button.title);
    }

    function render() {
        const toggled = phone || buttonMode;
        const mode = phone ? 'phone' : buttonMode ? 'button' : 'field';
        if (bar.dataset.topbarSearchMode !== mode) bar.dataset.topbarSearchMode = mode;
        if (bar.dataset.topbarSearchOpen !== String(open)) bar.dataset.topbarSearchOpen = String(open);
        button.hidden = !toggled;
        button.tabIndex = toggled && active ? 0 : -1;
        button.setAttribute('aria-hidden', String(!toggled || !active));
        button.setAttribute('aria-pressed', String(open));
        button.setAttribute('aria-expanded', String(open));
        const visible = !toggled || open;
        search.hidden = !visible;
        search.inert = !visible;
        search.setAttribute('aria-hidden', String(!visible));
        if (!visible && search.contains(document.activeElement)) document.activeElement.blur();
        identity.hidden = !phone || open;
        identity.setAttribute('aria-hidden', String(!phone || open));
        title?.setAttribute('aria-hidden', String(phone || open));
        refreshCopy();
    }

    function close() {
        open = false;
        render();
        button.focus({ preventScroll: true });
    }

    button.addEventListener('click', event => {
        event.stopPropagation();
        if ((!phone && !buttonMode) || !active) return;
        if (open) close();
        else {
            open = true;
            render();
            search.querySelector('input:not([type="checkbox"]):not([disabled])')?.focus({ preventScroll: true });
        }
    }, { signal: lifetime.signal });
    bar.addEventListener('keydown', event => {
        if (event.key !== 'Escape' || !open) return;
        event.preventDefault();
        event.stopPropagation();
        close();
    }, { signal: lifetime.signal });
    // Existing committed-search notification from text_search/dataset_search_clearer.js.
    window.addEventListener('dataset-committed-search-changed', event => {
        if (open && event.detail?.dataset === bar.dataset.filterbarSharedTopbarFor && event.detail.committed) close();
    }, { signal: lifetime.signal });
    const languageObserver = new MutationObserver(measure);
    languageObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
    const titleObserver = new MutationObserver(measure);
    // A host without a heading has no title width or title mutations to measure.
    if (title) titleObserver.observe(title, { childList: true, characterData: true, subtree: true,
        attributes: true, attributeFilter: ['class', 'style'] });
    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    // In button mode the start track can stay fixed while its menu animates.
    for (const element of [bar, inner, start, title, end, ...start.children].filter(Boolean)) resizeObserver?.observe(element);
    document.fonts?.addEventListener('loadingdone', measure, { signal: lifetime.signal });
    document.fonts?.ready.then(measure);
    return {
        sync(state) {
            if (phone !== state.phone || !state.active) open = false;
            phone = state.phone;
            active = state.active;
            measure();
        },
        destroy() {
            destroyed = true;
            lifetime.abort(); languageObserver.disconnect(); titleObserver.disconnect();
            resizeObserver?.disconnect(); button.remove();
        },
    };
}
