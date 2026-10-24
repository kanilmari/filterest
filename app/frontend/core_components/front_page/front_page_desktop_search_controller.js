// front_page_desktop_search_controller.js
// Owns Home's desktop field/button and its anchored, nonmodal results dialog.
// Connects the existing tab row to the phone search runner and translated copy.
// Keeps desktop focus and disposal independent of the phone's history owner.

import { getTranslationForKey } from '../lang/translation_handler.js';
import { bindDatasetLanguageRenderer } from '../table_views/dataset_value_localizer.js';
import { createFrontPageSearchRunner } from './front_page_search_runner.js';
import { LAYOUT_BREAKPOINTS } from '../../ui_config.js';

const PANEL_ID = 'front-page-desktop-search-panel';
const FOCUSABLE = 'input, button, a[href], [tabindex]:not([tabindex="-1"])';
const GUTTER = 16;

/** Viewport breakpoints match Home's phone projection, independently of menu width. */
export function getFrontPageSearchMode(width) {
    return width <= LAYOUT_BREAKPOINTS.phone ? 'phone'
        : width <= LAYOUT_BREAKPOINTS.tablet ? 'button' : 'field';
}

/** Mount after the row is connected; its fixed flex sibling reserves the fitter's space. */
export function mountFrontPageDesktopSearch(row, actions) {
    const view = row.ownerDocument.defaultView;
    const phoneMedia = view.matchMedia?.(`(width <= ${LAYOUT_BREAKPOINTS.phone}px)`);
    const home = row.closest('.front-page') || row.parentElement;
    const host = document.createElement('div');
    host.className = 'front-page-desktop-search';
    const field = document.createElement('div');
    field.className = 'dataset-search-input-row';
    const input = document.createElement('input');
    input.type = 'search';
    input.className = 'dataset-search-input';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'front-page-desktop-search__button';
    function icon() {
        const node = document.createElement('span');
        node.className = 'dataset-search-submit-icon';
        node.setAttribute('aria-hidden', 'true');
        return node;
    }
    field.append(icon(), input);
    button.append(icon());
    host.append(field, button);
    for (const control of [input, button]) {
        control.setAttribute('aria-controls', PANEL_ID);
        control.setAttribute('aria-haspopup', 'dialog');
        control.setAttribute('aria-expanded', 'false');
    }
    bindDatasetLanguageRenderer(host, () => {
        const title = getTranslationForKey('front_page_search_title', { countUsage: false });
        input.setAttribute('aria-label', title);
        input.placeholder = title;
        button.setAttribute('aria-label', getTranslationForKey('front_page_search_site', { countUsage: false }));
    });
    let mode;
    let panel;
    let closeButton;
    let groups;
    let runner;
    let restoringFocus = false;
    let outsidePointer = false;
    let destroyed = false;
    let focusFrame = 0;
    const trigger = () => mode === 'field' ? input : button;

    function place() {
        if (!panel) return;
        const bounds = home.getBoundingClientRect();
        const anchor = (mode === 'field' ? field : button).getBoundingClientRect();
        const leftEdge = Math.max(GUTTER, bounds.left + GUTTER);
        const rightEdge = Math.min(view.innerWidth - GUTTER, bounds.right - GUTTER);
        const width = Math.max(0, Math.min(640, rightEdge - leftEdge));
        const top = anchor.bottom + 8;
        panel.style.width = `${width}px`;
        panel.style.left = `${Math.max(leftEdge, Math.min(anchor.right - width, rightEdge - width))}px`;
        panel.style.top = `${top}px`;
        panel.style.maxHeight = `${Math.max(0, Math.min(view.innerHeight * 0.8, view.innerHeight - top - GUTTER))}px`;
    }
    function restoreFocus() {
        restoringFocus = true;
        trigger().focus({ preventScroll: true });
        restoringFocus = false;
    }
    function close(restore = true) {
        if (!panel) return;
        runner.destroy();
        runner = null;
        // Move the single field back before removing its collapsed-mode header.
        field.hidden = mode !== 'field';
        host.prepend(field);
        panel.remove();
        panel = null;
        for (const control of [input, button]) control.setAttribute('aria-expanded', 'false');
        document.removeEventListener('keydown', onKeydown, true);
        document.removeEventListener('click', onOutsideClick, true);
        document.removeEventListener('pointerdown', onPointerDown, true);
        document.removeEventListener('pointercancel', onPointerCancel, true);
        document.removeEventListener('focusin', onOutsideFocus, true);
        outsidePointer = false;
        if (restore && host.isConnected) restoreFocus();
    }
    function onOutsideClick(event) {
        if (!host.contains(event.target) && !panel?.contains(event.target)) close();
        outsidePointer = false;
    }
    function onPointerDown(event) {
        outsidePointer = !host.contains(event.target) && !panel?.contains(event.target);
    }
    function onPointerCancel() {
        if (outsidePointer) close(false);
        outsidePointer = false;
    }
    function onOutsideFocus(event) {
        // A pointer click finishes at click, after the browser focuses its target;
        // keyboard focus leaving remains free to continue through the page.
        if (!outsidePointer && !host.contains(event.target) && !panel?.contains(event.target)) close(false);
    }
    function focusable(root) {
        return [...root.querySelectorAll(FOCUSABLE)].filter(node => !node.disabled
            && !node.closest('[hidden], [inert]') && node.getClientRects().length);
    }
    function onKeydown(event) {
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopImmediatePropagation();
            close();
        } else if (event.key === 'ArrowDown' && event.target === input) {
            const first = groups.querySelector('a[href]');
            if (first) { event.preventDefault(); first.focus(); }
        } else if (event.key === 'Tab') {
            const nodes = focusable(panel);
            if (mode === 'field' && !event.shiftKey && event.target === input) {
                event.preventDefault(); closeButton.focus();
            } else if (mode === 'field' && event.shiftKey && event.target === closeButton) {
                event.preventDefault(); input.focus();
            } else if (mode === 'button' && event.shiftKey && event.target === input) {
                event.preventDefault(); close();
            } else if (!event.shiftKey && event.target === nodes.at(-1)) {
                const controls = focusable(home);
                const next = controls[controls.indexOf(trigger()) + 1];
                if (next) { event.preventDefault(); close(false); next.focus(); }
                else close(false);
            }
        }
    }
    function open(restart = true) {
        if (destroyed || mode === 'phone' || panel) return;
        panel = document.createElement('section');
        panel.id = PANEL_ID;
        panel.className = 'front-page-desktop-search-panel';
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-modal', 'false');
        const header = document.createElement('div');
        header.className = 'front-page-desktop-search-panel__header';
        const title = document.createElement('p');
        title.className = 'front-page-desktop-search-panel__title';
        closeButton = document.createElement('button');
        closeButton.type = 'button';
        closeButton.className = 'front-page-desktop-search-panel__close';
        const cross = document.createElement('span');
        cross.textContent = '×';
        cross.setAttribute('aria-hidden', 'true');
        closeButton.append(cross);
        if (mode === 'button') { field.hidden = false; header.append(field); }
        else header.append(title);
        header.append(closeButton);
        bindDatasetLanguageRenderer(panel, () => {
            const label = getTranslationForKey('front_page_search_title', { countUsage: false });
            panel.setAttribute('aria-label', label);
            title.textContent = label;
            input.setAttribute('aria-label', label);
            input.placeholder = label;
            closeButton.setAttribute('aria-label', getTranslationForKey('front_page_search_close', { countUsage: false }));
        });
        const results = document.createElement('div');
        results.className = 'front-page-desktop-search-panel__results';
        const status = document.createElement('p');
        status.setAttribute('role', 'status');
        status.setAttribute('aria-live', 'polite');
        groups = document.createElement('div');
        results.append(status, groups);
        panel.append(header, results);
        document.body.append(panel);
        runner = createFrontPageSearchRunner(input, groups, status);
        for (const control of [input, button]) control.setAttribute('aria-expanded', 'true');
        closeButton.addEventListener('click', () => close());
        // The shared links keep their real navigation handlers and query addresses.
        groups.addEventListener('click', event => {
            if (event.target.closest('a[href]')) close(false);
        }, true);
        document.addEventListener('keydown', onKeydown, true);
        document.addEventListener('click', onOutsideClick, true);
        document.addEventListener('pointerdown', onPointerDown, true);
        document.addEventListener('pointercancel', onPointerCancel, true);
        document.addEventListener('focusin', onOutsideFocus, true);
        place();
        input.focus({ preventScroll: true });
        if (restart && input.value) input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    // Capture on the field runs before the runner's target listener, so the first
    // qualifying keystroke also reaches the newly bound shared debounce owner.
    function onInput() {
        if (Array.from(input.value.trim()).length >= 2) open(false);
    }
    function onInputFocus() {
        if (!restoringFocus && Array.from(input.value.trim()).length >= 2) open();
    }
    function onButtonClick() { if (panel) close(); else open(); }
    function onNavigation() { close(false); }
    function syncMode() {
        const next = getFrontPageSearchMode(view.innerWidth);
        if (mode === next) { place(); return; }
        const active = document.activeElement;
        const returnFocus = Boolean(panel || host.contains(active)
            || active?.closest('.front-page-search-button, .front-page-search-sheet'));
        close(false);
        mode = next;
        host.dataset.mode = mode;
        field.hidden = mode !== 'field';
        button.hidden = mode !== 'button';
        if (mode === 'phone') host.remove();
        else actions.before(host);
        if (focusFrame) view.cancelAnimationFrame(focusFrame);
        if (returnFocus) focusFrame = view.requestAnimationFrame(() => {
            focusFrame = 0;
            if (destroyed) return;
            if (mode === 'phone') home.querySelector('.front-page-search-button')?.focus({ preventScroll: true });
            else restoreFocus();
        });
    }
    field.addEventListener('input', onInput, true);
    input.addEventListener('focus', onInputFocus);
    button.addEventListener('click', onButtonClick);
    view.addEventListener('resize', syncMode);
    // Registered before the phone projection: retain search focus before its nodes move.
    phoneMedia?.addEventListener('change', syncMode);
    view.addEventListener('popstate', onNavigation);
    home.addEventListener('scroll', place, true);
    const observer = typeof view.ResizeObserver === 'function' ? new view.ResizeObserver(place) : null;
    observer?.observe(row);
    observer?.observe(home);
    syncMode();
    return {
        destroy() {
            destroyed = true;
            close(false);
            observer?.disconnect();
            if (focusFrame) view.cancelAnimationFrame(focusFrame);
            view.removeEventListener('resize', syncMode);
            phoneMedia?.removeEventListener('change', syncMode);
            view.removeEventListener('popstate', onNavigation);
            home.removeEventListener('scroll', place, true);
            field.removeEventListener('input', onInput, true);
            input.removeEventListener('focus', onInputFocus);
            button.removeEventListener('click', onButtonClick);
            host.remove();
        },
    };
}
