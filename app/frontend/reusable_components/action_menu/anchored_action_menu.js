// anchored_action_menu.js
// Opens a small single-choice action menu next to the control that owns it.
// Bridges a native trigger button, a portalled role="menu" list and the shared viewport placement rule.
// Exists because the vanilla dropdown is a value picker with a read-only text field, not an action menu.
//
// The menu is mounted on <body> with fixed positioning because transformed sidebar
// and page containers would otherwise clip it or become its positioning block.
// Every document/window listener exists only while the menu is open; removing the
// owner from the page, leaving its view, Escape, Tab or a pointer outside closes it.

import { measureFloatingPanelPlacement } from '../floating_panel_placement.js';
import { VIEW_DEACTIVATE_EVENT } from '../view_lifecycle_events.js';

const MARGIN = 8;
const GAP = 4;
let menuSequence = 0;
const menuOwners = new WeakMap();

/**
 * The owner of the body-mounted menu that contains `target`, or null. Outside-
 * click handlers use it so a choice in a portalled menu counts as a click
 * inside the surface that owns the menu. The menu item is detached by the time
 * a bubbling document click arrives, but it is still inside its menu element.
 */
export function readAnchoredActionMenuOwner(target) {
    const menu = target instanceof Element ? target.closest('.anchored-action-menu') : null;
    return (menu && menuOwners.get(menu)) || null;
}

/**
 * @param {Object} options
 * @param {HTMLButtonElement} options.trigger the button that opens and closes the menu.
 * @param {HTMLElement} [options.anchor] the element the menu aligns with (default: trigger).
 * @param {HTMLElement} [options.owner] the element whose removal disposes an open menu (default: anchor).
 * @param {() => Array<{value: string, label: string, langKey?: string, checked?: boolean}>} options.buildItems
 *        the current choices, read every time the menu opens.
 * @param {(value: string, context: {event: Event}) => void} options.onSelect called after the menu closed.
 * @param {string} [options.menuLabel] accessible name of the menu.
 * @param {string} [options.menuLabelLangKey] language key of that name.
 * @param {string} [options.testid] data-testid of the menu; options get `<testid>-option-<value>`.
 */
export function createAnchoredActionMenu({
    trigger, anchor = trigger, owner = anchor, buildItems, onSelect,
    menuLabel = '', menuLabelLangKey = '', testid = '',
} = {}) {
    if (!(trigger instanceof HTMLElement) || typeof buildItems !== 'function') {
        throw new TypeError('createAnchoredActionMenu requires a trigger and buildItems');
    }
    const doc = trigger.ownerDocument || document;
    const view = doc.defaultView || window;
    const menuId = `anchored-action-menu-${++menuSequence}`;
    let menu = null;
    let openController = null;
    let frame = 0;

    trigger.setAttribute('aria-haspopup', 'menu');
    trigger.setAttribute('aria-expanded', 'false');

    function items() {
        return menu ? Array.from(menu.querySelectorAll('[role^="menuitem"]')) : [];
    }

    function focusItem(index) {
        const list = items();
        if (!list.length) return;
        const next = list[(index + list.length) % list.length];
        next.focus({ preventScroll: true });
    }

    function buildMenu() {
        const element = doc.createElement('div');
        element.id = menuId;
        element.className = 'anchored-action-menu';
        element.setAttribute('role', 'menu');
        if (testid) element.dataset.testid = testid;
        if (menuLabel) element.setAttribute('aria-label', menuLabel);
        if (menuLabelLangKey) element.dataset.ariaLabelLangKey = menuLabelLangKey;
        for (const item of buildItems() || []) {
            const button = doc.createElement('button');
            button.type = 'button';
            button.tabIndex = -1;
            button.className = 'anchored-action-menu__item';
            button.setAttribute('role', 'menuitemradio');
            button.setAttribute('aria-checked', item.checked ? 'true' : 'false');
            button.dataset.value = item.value;
            if (testid) button.dataset.testid = `${testid}-option-${item.value}`;
            const check = doc.createElement('span');
            check.className = 'anchored-action-menu__check';
            check.setAttribute('aria-hidden', 'true');
            check.textContent = item.checked ? '✓' : '';
            const label = doc.createElement('span');
            label.className = 'anchored-action-menu__label';
            label.textContent = item.label;
            if (item.langKey) label.dataset.langKey = item.langKey;
            button.append(check, label);
            button.addEventListener('click', (event) => {
                close({ restoreFocus: false });
                onSelect?.(item.value, { event });
            });
            element.append(button);
        }
        element.addEventListener('keydown', handleMenuKeydown);
        menuOwners.set(element, owner);
        return element;
    }

    function handleMenuKeydown(event) {
        const list = items();
        const index = list.indexOf(doc.activeElement);
        if (event.key === 'ArrowDown') focusItem(index + 1);
        else if (event.key === 'ArrowUp') focusItem(index < 0 ? -1 : index - 1);
        else if (event.key === 'Home') focusItem(0);
        else if (event.key === 'End') focusItem(-1);
        else if (event.key === 'Tab') {
            // Resume the browser's tab order from the trigger after removing
            // the portalled menu. Do not consume Tab or Shift+Tab.
            close({ restoreFocus: true });
            return;
        }
        else if (event.key === 'Escape') close({ restoreFocus: true });
        else return;
        event.preventDefault();
        event.stopPropagation();
    }

    function position() {
        frame = 0;
        if (!menu) return;
        if (!anchor.isConnected || !owner.isConnected) {
            close({ restoreFocus: false });
            return;
        }
        const anchorRect = anchor.getBoundingClientRect();
        const viewport = view.visualViewport;
        const viewportWidth = viewport?.width || view.innerWidth || doc.documentElement.clientWidth;
        const viewportHeight = viewport?.height || view.innerHeight || doc.documentElement.clientHeight;
        const offsetLeft = viewport?.offsetLeft || 0;
        const offsetTop = viewport?.offsetTop || 0;
        const maxWidth = Math.max(0, viewportWidth - MARGIN * 2);
        menu.style.maxWidth = `${maxWidth}px`;
        menu.style.minWidth = `${Math.min(anchorRect.width, maxWidth)}px`;
        menu.style.maxHeight = '';
        const requiredHeight = menu.scrollHeight;
        const placement = measureFloatingPanelPlacement({
            anchorRect, requiredHeight, viewportHeight, layoutHeight: view.innerHeight,
            offsetTop, margin: MARGIN, gap: GAP,
        });
        const width = menu.getBoundingClientRect().width;
        const left = Math.min(Math.max(anchorRect.left, offsetLeft + MARGIN),
            offsetLeft + viewportWidth - width - MARGIN);
        menu.style.left = `${Math.max(offsetLeft + MARGIN, left)}px`;
        menu.style.maxHeight = `${Math.max(44, placement.availableHeight)}px`;
        menu.classList.toggle('anchored-action-menu--upward', placement.upward);
        menu.style.top = placement.upward ? '' : `${placement.top}px`;
        menu.style.bottom = placement.upward ? `${placement.bottom}px` : '';
    }

    function schedulePosition() {
        if (!menu || frame) return;
        frame = view.requestAnimationFrame ? view.requestAnimationFrame(position) : (position(), 0);
    }

    function open({ focus = 'checked' } = {}) {
        if (menu) return;
        if (!owner.isConnected) return;
        menu = buildMenu();
        if (!items().length) {
            menu = null;
            return;
        }
        doc.body.append(menu);
        trigger.setAttribute('aria-expanded', 'true');
        trigger.setAttribute('aria-controls', menuId);
        position();
        openController = new AbortController();
        const { signal } = openController;
        doc.addEventListener('pointerdown', (event) => {
            if (!menu?.contains(event.target) && !trigger.contains(event.target)) close({ restoreFocus: false });
        }, { capture: true, signal });
        view.addEventListener('resize', schedulePosition, { signal });
        view.addEventListener('scroll', schedulePosition, { capture: true, passive: true, signal });
        view.visualViewport?.addEventListener('resize', schedulePosition, { signal });
        owner.closest('#tabs_container > .content_div')
            ?.addEventListener(VIEW_DEACTIVATE_EVENT, () => close({ restoreFocus: false }), { signal });
        if (typeof view.MutationObserver === 'function') {
            const observer = new view.MutationObserver(() => {
                if (!owner.isConnected) close({ restoreFocus: false });
            });
            observer.observe(doc.documentElement, { childList: true, subtree: true });
            signal.addEventListener('abort', () => observer.disconnect());
        }
        const list = items();
        const checked = list.findIndex((item) => item.getAttribute('aria-checked') === 'true');
        focusItem(focus === 'last' ? -1 : focus === 'first' || checked < 0 ? 0 : checked);
    }

    function close({ restoreFocus = true } = {}) {
        if (!menu) return;
        const focusWasInside = menu.contains(doc.activeElement);
        openController?.abort();
        openController = null;
        if (frame && view.cancelAnimationFrame) view.cancelAnimationFrame(frame);
        frame = 0;
        menu.remove();
        menu = null;
        trigger.setAttribute('aria-expanded', 'false');
        trigger.removeAttribute('aria-controls');
        if ((restoreFocus || focusWasInside) && trigger.isConnected) trigger.focus({ preventScroll: true });
    }

    const handleTriggerClick = () => (menu ? close({ restoreFocus: true }) : open());
    const handleTriggerKeydown = (event) => {
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
        event.preventDefault();
        if (menu) focusItem(event.key === 'ArrowUp' ? -1 : 0);
        else open({ focus: event.key === 'ArrowUp' ? 'last' : 'checked' });
    };
    trigger.addEventListener('click', handleTriggerClick);
    trigger.addEventListener('keydown', handleTriggerKeydown);

    return {
        open,
        close,
        isOpen: () => Boolean(menu),
        get element() { return menu; },
        dispose() {
            close({ restoreFocus: false });
            trigger.removeEventListener('click', handleTriggerClick);
            trigger.removeEventListener('keydown', handleTriggerKeydown);
        },
    };
}
