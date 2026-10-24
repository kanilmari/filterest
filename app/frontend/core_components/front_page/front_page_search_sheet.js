// front_page_search_sheet.js
// Mounts Home's phone-only magnifier and accessible search sheet in its end slot.
// Connects the bounded runner and history owner to one mounted Home visit.
// Teardown follows removal of that slot, including resize and session changes.

import { getTranslationForKey } from '../lang/translation_handler.js';
import { bindDatasetLanguageRenderer } from '../table_views/dataset_value_localizer.js';
import { createFrontPageSearchRunner } from './front_page_search_runner.js';
import { openHomeSearchHistory } from './front_page_search_history.js';

const SHEET_ID = 'front-page-search-sheet';
const LOCK = 'front-page-scroller--drawer-open';
const FOCUSABLE = 'input, button, a[href], [tabindex]:not([tabindex="-1"])';

/** Called only after the existing phone layout has mounted its 44px end slot. */
export function mountFrontPageSearchSheet(end, scroller) {
    if (!window.matchMedia?.('(width <= 700px)').matches) return { destroy() {} };
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'front-page-search-button';
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-controls', SHEET_ID);
    const icon = document.createElement('span');
    icon.className = 'dataset-search-submit-icon';
    icon.setAttribute('aria-hidden', 'true');
    button.append(icon);
    bindDatasetLanguageRenderer(button, () => {
        button.setAttribute('aria-label', getTranslationForKey('front_page_search_site', { countUsage: false }));
    });
    end.removeAttribute('aria-hidden');
    end.append(button);
    let layer;
    let dialog;
    let input;
    let runner;
    let entry;
    let closing;
    let savedScrollTop;
    let hadLock;
    let inertNodes = [];
    let destroyed = false;

    function hide() {
        if (!layer) return;
        runner.destroy();
        runner = null;
        document.removeEventListener('keydown', onKeydown, true);
        document.removeEventListener('focusin', onFocus, true);
        layer.remove();
        layer = null;
        for (const [node, wasInert] of inertNodes) node.inert = wasInert;
        inertNodes = [];
        if (!hadLock) scroller.classList.remove(LOCK);
        scroller.scrollTop = savedScrollTop;
        button.setAttribute('aria-expanded', 'false');
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
        const header = document.createElement('div');
        header.className = 'front-page-search-sheet__header';
        const field = document.createElement('div');
        field.className = 'dataset-search-input-row';
        input = document.createElement('input');
        input.type = 'search';
        input.className = 'dataset-search-input';
        input.autofocus = true;
        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'front-page-search-sheet__close';
        const cross = document.createElement('span');
        cross.setAttribute('aria-hidden', 'true');
        cross.textContent = '×';
        close.append(cross);
        bindDatasetLanguageRenderer(dialog, () => {
            const label = getTranslationForKey('front_page_search_title', { countUsage: false });
            dialog.setAttribute('aria-label', label);
            input.setAttribute('aria-label', label);
            input.placeholder = label;
            close.setAttribute('aria-label', getTranslationForKey('front_page_search_close', { countUsage: false }));
        });
        field.append(input);
        header.append(field, close);
        const results = document.createElement('div');
        results.className = 'front-page-search-sheet__results';
        const status = document.createElement('p');
        status.setAttribute('role', 'status');
        status.setAttribute('aria-live', 'polite');
        const groups = document.createElement('div');
        results.append(status, groups);
        dialog.append(header, results);
        layer.append(dialog);
        savedScrollTop = scroller.scrollTop;
        hadLock = scroller.classList.contains(LOCK);
        scroller.classList.add(LOCK);
        // Keep Home out of keyboard and assistive-technology navigation while modal.
        inertNodes = [...scroller.children].map(node => [node, node.inert]);
        for (const [node] of inertNodes) node.inert = true;
        scroller.append(layer);
        runner = createFrontPageSearchRunner(input, groups, status);
        entry = openHomeSearchHistory(hide);
        button.setAttribute('aria-expanded', 'true');
        document.addEventListener('keydown', onKeydown, true);
        document.addEventListener('focusin', onFocus, true);
        close.addEventListener('click', () => { void dismiss(); });
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
    button.addEventListener('click', open);
    const observer = new MutationObserver(() => { if (!end.isConnected) destroy(); });
    observer.observe(scroller, { childList: true, subtree: true });
    function destroy() {
        if (destroyed) return;
        destroyed = true;
        void dismiss();
        observer.disconnect();
        button.removeEventListener('click', open);
        button.remove();
        end.setAttribute('aria-hidden', 'true');
    }
    return { destroy };
}
