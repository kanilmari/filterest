// front_page_search_sheet.js
// Mounts Home's phone search over its identity, with results beneath the bar.
// Connects the bounded runner and history owner to one mounted Home visit.
// Teardown follows removal of that slot, including resize and session changes.

import { getTranslationForKey } from '../lang/translation_handler.js';
import { bindDatasetLanguageRenderer } from '../table_views/dataset_value_localizer.js';
import { createFrontPageSearchRunner } from './front_page_search_runner.js';
import { openHomeSearchHistory } from './front_page_search_history.js';
import { createMaskIconSpan } from '../../icons/icon_mask_builder.js';
import { LAYOUT_BREAKPOINTS } from '../../ui_config.js';

const SHEET_ID = 'front-page-search-sheet';
const LOCK = 'front-page-scroller--drawer-open';
const FOCUSABLE = 'input, button, a[href], [tabindex]:not([tabindex="-1"])';

/** Called only after the existing phone layout has mounted its search-toggle cell. */
export function mountFrontPageSearchSheet(end, scroller) {
    if (!window.matchMedia?.(`(width <= ${LAYOUT_BREAKPOINTS.phone}px)`).matches) return { destroy() {} };
    const bar = end.parentElement;
    const identity = bar.querySelector('.front-page-top-row__identity');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'front-page-search-button';
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-controls', SHEET_ID);
    let layer;
    let draft = '';
    function renderToggle(open) {
        button.setAttribute('aria-expanded', String(open));
        button.setAttribute('aria-pressed', String(open));
        const key = open ? 'filterbar_hide_search' : 'filterbar_show_search';
        button.title = getTranslationForKey(key, { countUsage: false });
        button.setAttribute('aria-label', button.title);
        button.replaceChildren(createMaskIconSpan(open
            ? '/frontend/icons/general/dataset-search-off-icon.svg'
            : '/frontend/icons/general/dataset-search-icon.svg', 'dataset-search-submit-icon'));
    }
    bindDatasetLanguageRenderer(button, () => renderToggle(Boolean(layer)));
    end.removeAttribute('aria-hidden');
    end.append(button);
    let dialog;
    let input;
    let runner;
    let entry;
    let closing;
    let savedScrollTop;
    let hadLock;
    let inertNodes = [];
    let identityAriaHidden;
    let destroyed = false;

    function hide() {
        if (!layer) return;
        draft = input.value;
        runner.destroy();
        runner = null;
        document.removeEventListener('keydown', onKeydown, true);
        document.removeEventListener('focusin', onFocus, true);
        end.append(button);
        dialog.remove();
        dialog = null;
        layer = null;
        bar.classList.remove('front-page-search-bar--open');
        identity.classList.remove('front-page-search-identity--covered');
        if (identityAriaHidden === null) identity.removeAttribute('aria-hidden');
        else identity.setAttribute('aria-hidden', identityAriaHidden);
        for (const [node, wasInert] of inertNodes) node.inert = wasInert;
        inertNodes = [];
        if (!hadLock) scroller.classList.remove(LOCK);
        scroller.scrollTop = savedScrollTop;
        renderToggle(false);
        if (button.isConnected && !destroyed) button.focus({ preventScroll: true });
    }
    function dismiss() {
        if (closing) return closing;
        if (!layer) return Promise.resolve();
        closing = entry.close().finally(() => { closing = null; });
        return closing;
    }
    function focusable() {
        return [...dialog.querySelectorAll(FOCUSABLE)].filter(node => !node.disabled
            && !node.closest('[hidden], [inert]'));
    }
    function onKeydown(event) {
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopImmediatePropagation();
            void dismiss();
        } else if (event.key === 'Tab') {
            const nodes = focusable();
            const first = nodes[0];
            const last = nodes.at(-1);
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault(); last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault(); first.focus();
            }
        }
    }
    function onFocus(event) {
        if (dialog && !dialog.contains(event.target)) input.focus({ preventScroll: true });
    }
    function open() {
        if (destroyed || layer || closing) return;
        layer = document.createElement('div');
        layer.className = 'front-page-search-layer';
        dialog = document.createElement('section');
        dialog.id = SHEET_ID;
        dialog.className = 'front-page-search-sheet dataset-search-panel';
        dialog.setAttribute('role', 'dialog');
        dialog.setAttribute('aria-modal', 'true');
        const field = document.createElement('div');
        field.className = 'dataset-search-input-row';
        input = document.createElement('input');
        input.type = 'search';
        input.className = 'dataset-search-input';
        input.autofocus = true;
        input.value = draft;
        const inputShell = document.createElement('div');
        inputShell.className = 'dataset-search-input-shell';
        const clear = document.createElement('button');
        clear.type = 'button';
        clear.className = 'dataset-search-clear-button';
        clear.dataset.testid = 'dataset-search-clear';
        const clearIcon = document.createElement('span');
        clearIcon.className = 'dataset-search-clear-icon';
        clearIcon.setAttribute('aria-hidden', 'true');
        clearIcon.textContent = '⊗';
        clear.append(clearIcon);
        function syncDraft() { draft = input.value; clear.hidden = input.value.length === 0; }
        syncDraft();
        input.addEventListener('input', syncDraft);
        clear.addEventListener('click', () => {
            input.value = '';
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.focus({ preventScroll: true });
        });
        const submit = document.createElement('button');
        submit.type = 'button';
        submit.className = 'dataset-search-submit-button';
        submit.dataset.testid = 'dataset-search-submit';
        submit.append(createMaskIconSpan('/frontend/icons/general/dataset-search-icon.svg', 'dataset-search-submit-icon'));
        const search = () => runner.search();
        submit.addEventListener('click', search);
        input.addEventListener('keydown', event => {
            if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); search(); }
        });
        bindDatasetLanguageRenderer(dialog, () => {
            const label = getTranslationForKey('front_page_search_title', { countUsage: false });
            dialog.setAttribute('aria-label', label);
            input.setAttribute('aria-label', label);
            input.placeholder = getTranslationForKey('search', { countUsage: false });
            clear.title = getTranslationForKey('clear_text_search', { countUsage: false });
            clear.setAttribute('aria-label', clear.title);
            submit.title = getTranslationForKey('search', { countUsage: false });
            submit.setAttribute('aria-label', submit.title);
        });
        inputShell.append(input, clear);
        field.append(inputShell, submit);
        const results = document.createElement('div');
        results.className = 'front-page-search-sheet__results';
        const status = document.createElement('p');
        status.setAttribute('role', 'status');
        status.setAttribute('aria-live', 'polite');
        const groups = document.createElement('div');
        results.append(groups);
        layer.append(status, results);
        // One modal subtree spans the bar controls and the results below it.
        // The same toggle moves into the modal subtree so it stays accessible.
        // Its own grid cell remains in the same place as the closed-state opener.
        dialog.dataset.topbarSearchMode = 'phone';
        dialog.append(field, button, layer);
        savedScrollTop = scroller.scrollTop;
        hadLock = scroller.classList.contains(LOCK);
        scroller.classList.add(LOCK);
        // Keep Home out of keyboard and assistive-technology navigation while modal.
        inertNodes = [...scroller.children].filter(node => node !== bar)
            .concat([...bar.children]).map(node => [node, node.inert]);
        for (const [node] of inertNodes) node.inert = true;
        identityAriaHidden = identity.getAttribute('aria-hidden');
        identity.setAttribute('aria-hidden', 'true');
        identity.classList.add('front-page-search-identity--covered');
        bar.classList.add('front-page-search-bar--open');
        bar.append(dialog);
        runner = createFrontPageSearchRunner(input, groups, status);
        entry = openHomeSearchHistory(hide);
        renderToggle(true);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        document.addEventListener('keydown', onKeydown, true);
        document.addEventListener('focusin', onFocus, true);
        layer.addEventListener('click', event => { if (event.target === layer) void dismiss(); });
        groups.addEventListener('click', event => {
            const link = event.target.closest('a[href]');
            if (!layer || !link || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            // First remove our history entry, then let the shared link run its normal
            // openNavTab → openRowArticleView path with the original search query.
            event.preventDefault();
            event.stopPropagation();
            void dismiss().then(() => link.click());
        }, true);
        input.focus({ preventScroll: true });
    }
    const toggle = () => { if (layer) void dismiss(); else open(); };
    button.addEventListener('click', toggle);
    const observer = new MutationObserver(() => { if (!end.isConnected) destroy(); });
    observer.observe(scroller, { childList: true, subtree: true });
    function destroy() {
        if (destroyed) return;
        destroyed = true;
        void dismiss();
        observer.disconnect();
        button.removeEventListener('click', toggle);
        button.remove();
        end.setAttribute('aria-hidden', 'true');
    }
    return { destroy };
}
