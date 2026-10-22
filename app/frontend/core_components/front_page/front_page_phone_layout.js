// front_page_phone_layout.js
// Owns Home's reversible phone projection after the printer mounts the real row.
// Kept separate from the row builder because the scroller belongs to the printer;
// one visit owns the media listener, bar measurement and drawer scroll lock.
// Moves existing nodes so tab subscriptions, translated copy and listeners survive.

import { NAVBAR_VISIBILITY_CHANGED_EVENT } from '../navigation/menu_button/navbar_visibility_handler.js';

const PHONE_QUERY = '(width <= 700px)';
const BAR_SIZE = '--home-phone-bar-size';
const DRAWER_LOCK = 'front-page-scroller--drawer-open';

/** Project one mounted Home row into its scroller, restoring the desktop tree on exit. */
export function mountFrontPagePhoneLayout(row, scroller) {
    const view = row.ownerDocument.defaultView;
    const media = view.matchMedia?.(PHONE_QUERY);
    const identity = row.querySelector('.front-page-top-row__identity');
    const menuSlot = identity.querySelector('.dataset-shared-topbar__menu-slot');
    const scrollerHadStyle = scroller.hasAttribute('style');
    let bar = null;
    let observer = null;
    let returnPoints = [];
    let savedScrollTop = null;
    let destroyed = false;

    function unlock() {
        if (savedScrollTop === null) return;
        scroller.classList.remove(DRAWER_LOCK);
        scroller.scrollTop = savedScrollTop;
        savedScrollTop = null;
    }

    function syncDrawer() {
        const navbar = row.ownerDocument.getElementById('navbar');
        const open = bar && navbar && !navbar.classList.contains('collapsed');
        if (!open) return unlock();
        if (savedScrollTop === null) savedScrollTop = scroller.scrollTop;
        scroller.classList.add(DRAWER_LOCK);
    }

    function keepFocus(move) {
        const active = row.ownerDocument.activeElement;
        const focused = row.contains(active) || bar?.contains(active) ? active : null;
        move();
        if (!focused?.isConnected) return;
        // Fitting may hide a destination; use the same visible menu fallback as the tabs.
        const target = focused.closest('[hidden], [inert], [aria-hidden="true"]')
            ? row.ownerDocument.querySelector('[data-navbar-menu-button="true"][aria-hidden="false"], #hideMenuButton[aria-hidden="false"], #showMenuButton[aria-hidden="false"]')
            : focused;
        target?.focus({ preventScroll: true });
    }

    function publishSize(entry) {
        if (!bar || destroyed) return;
        const box = entry?.borderBoxSize;
        const size = (box?.[0] || box)?.blockSize ?? bar.getBoundingClientRect().height;
        scroller.style.setProperty(BAR_SIZE, `${size}px`);
    }

    function restore() {
        if (!bar) return;
        observer?.disconnect();
        observer = null;
        unlock();
        scroller.style.removeProperty(BAR_SIZE);
        if (!scrollerHadStyle && !scroller.style.length) scroller.removeAttribute('style');
        keepFocus(() => {
            // Restore the slot inside identity before returning identity and row.
            for (const [node, point] of returnPoints) point.replaceWith(node);
            returnPoints = [];
            bar.remove();
            bar = null;
        });
    }

    function sync() {
        if (destroyed) return;
        if (!media?.matches) return restore();
        if (bar) return;
        keepFocus(() => {
            returnPoints = [menuSlot, identity, row].map(node => {
                const point = row.ownerDocument.createComment('Home desktop return point');
                node.before(point);
                return [node, point];
            });
            bar = row.ownerDocument.createElement('div');
            bar.className = 'front-page-phone-topbar';
            const end = row.ownerDocument.createElement('div');
            end.className = 'front-page-phone-topbar__end';
            end.setAttribute('aria-hidden', 'true');
            bar.append(menuSlot, identity, end);
            scroller.prepend(bar, row);
        });
        publishSize();
        if (typeof view.ResizeObserver === 'function') {
            const observedBar = bar;
            observer = new view.ResizeObserver(entries => { if (bar === observedBar) publishSize(entries[0]); });
            observer.observe(bar, { box: 'border-box' });
        }
        syncDrawer();
    }

    media?.addEventListener('change', sync);
    view.addEventListener(NAVBAR_VISIBILITY_CHANGED_EVENT, syncDrawer);
    sync();
    return {
        destroy() {
            if (destroyed) return;
            media?.removeEventListener('change', sync);
            view.removeEventListener(NAVBAR_VISIBILITY_CHANGED_EVENT, syncDrawer);
            restore();
            destroyed = true;
        },
    };
}
