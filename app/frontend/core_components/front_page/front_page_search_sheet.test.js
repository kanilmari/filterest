// front_page_search_sheet.test.js
// Exercises the phone-only dialog's keyboard, focus, teardown and history contract.
// Uses real browser history identities with a stubbed search transport owner.
// Keeps reload and desktop inert without a database or application instance.
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ destroy: vi.fn(), create: vi.fn() }));
vi.mock('./front_page_search_runner.js', () => ({ createFrontPageSearchRunner: mocks.create }));
vi.mock('../lang/translation_handler.js', () => ({ getTranslationForKey: key => ({
    front_page_search_site: 'Search the site', front_page_search_title: 'Search', front_page_search_close: 'Close search',
}[key] || key) }));
import { mountFrontPageSearchSheet } from './front_page_search_sheet.js';
import { consumeHomeSearchHistoryNavigation } from './front_page_search_history.js';
import { HISTORY_ENTRY_ID, writeHistoryEntry } from '../navigation/nav_engine/history_entry_state.js';

let mount, scroller, end, button, back;
let serial = 0;
const onPop = () => consumeHomeSearchHistoryNavigation();
const dialog = () => document.querySelector('[role="dialog"]');
const close = () => dialog().querySelector('button');
beforeEach(() => {
    history.replaceState({ [HISTORY_ENTRY_ID]: `home-${++serial}` }, '', '/');
    window.addEventListener('popstate', onPop);
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));
    document.body.innerHTML = '<main class="front-page-scroller"><div class="front-page-phone-topbar"><div class="front-page-phone-topbar__end" aria-hidden="true"></div></div><article><button>Home</button></article></main>';
    scroller = document.querySelector('main'); end = scroller.querySelector('.front-page-phone-topbar__end');
    mocks.create.mockReset().mockReturnValue({ destroy: mocks.destroy }); mocks.destroy.mockClear();
    back = vi.spyOn(history, 'back');
    mount = mountFrontPageSearchSheet(end, scroller); button = end.querySelector('button');
});
afterEach(async () => {
    mount.destroy();
    await vi.waitFor(() => expect(history.state?.homeSearch).not.toBe(true));
    window.removeEventListener('popstate', onPop);
    vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren();
});

test('opening creates a separately identified same-URL state, locks Home and focuses the labelled search', () => {
    const previous = history.state[HISTORY_ENTRY_ID];
    const push = vi.spyOn(history, 'pushState');
    button.click();
    expect(push).toHaveBeenCalledOnce(); expect(location.pathname).toBe('/');
    expect(history.state.homeSearch).toBe(true); expect(history.state[HISTORY_ENTRY_ID]).not.toBe(previous);
    expect(dialog().getAttribute('aria-modal')).toBe('true'); expect(dialog().getAttribute('aria-label')).toBe('Search');
    expect(document.activeElement).toBe(dialog().querySelector('input'));
    expect(button.getAttribute('aria-controls')).toBe(dialog().id); expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(scroller.classList.contains('front-page-scroller--drawer-open')).toBe(true);
    expect(scroller.querySelector('article').inert).toBe(true);
});

test('focus loops in both directions and programmatic outside focus returns inside', () => {
    button.click(); const input = dialog().querySelector('input');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(close());
    close().dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(input);
    scroller.querySelector('article button').focus(); expect(document.activeElement).toBe(input);
});

test.each(['close', 'escape', 'backdrop'])('%s closes, returns focus and removes the entry exactly once', async gesture => {
    scroller.scrollTop = 123; button.click();
    const closer = close();
    if (gesture === 'close') { closer.click(); closer.click(); }
    else if (gesture === 'escape') document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    else document.querySelector('.front-page-search-layer').click();
    expect(dialog()).toBeNull(); expect(document.activeElement).toBe(button); expect(back).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(history.state.homeSearch).toBeUndefined());
    expect(location.pathname).toBe('/'); expect(scroller.scrollTop).toBe(123);
    expect(scroller.classList.contains('front-page-scroller--drawer-open')).toBe(false);
    expect(button.getAttribute('aria-expanded')).toBe('false'); expect(mocks.destroy).toHaveBeenCalledOnce();
});

test('phone Back closes without leaving Home or issuing another Back', async () => {
    const base = history.state[HISTORY_ENTRY_ID];
    button.click(); history.back();
    await vi.waitFor(() => expect(dialog()).toBeNull());
    expect(location.pathname).toBe('/'); expect(history.state[HISTORY_ENTRY_ID]).toBe(base);
    expect(back).toHaveBeenCalledOnce(); expect(document.activeElement).toBe(button);
});

test('result activation waits for the history pop before the shared link is clicked', async () => {
    button.click();
    const groups = mocks.create.mock.calls[0][1];
    const link = document.createElement('a'); link.href = '/app_example?search=harbour'; groups.append(link);
    const navigate = vi.fn(event => { event.preventDefault(); expect(history.state.homeSearch).toBeUndefined(); });
    link.addEventListener('click', navigate);
    link.click(); expect(navigate).not.toHaveBeenCalled(); expect(dialog()).toBeNull();
    await vi.waitFor(() => expect(navigate).toHaveBeenCalledOnce()); expect(back).toHaveBeenCalledOnce();
});

test('reload/Forward with a retained marker stays closed; leaving that inert entry navigates normally', () => {
    history.replaceState({ homeSearch: true, [HISTORY_ENTRY_ID]: 'reloaded-entry' }, '', '/');
    expect(dialog()).toBeNull(); expect(consumeHomeSearchHistoryNavigation()).toBe(true);
    expect(back).not.toHaveBeenCalled();
    history.replaceState({ [HISTORY_ENTRY_ID]: 'earlier' }, '', '/app_previous');
    expect(consumeHomeSearchHistoryNavigation()).toBe(false);
});

test('ordinary navigation clears a reload marker even when replacing an entry', () => {
    history.replaceState({ homeSearch: true, [HISTORY_ENTRY_ID]: 'reloaded-entry' }, '', '/');
    writeHistoryEntry('/app_example', {}, { replace: true });
    expect(history.state.homeSearch).toBeUndefined(); expect(consumeHomeSearchHistoryNavigation()).toBe(false);
});

test('desktop (>700px) keeps the empty hidden slot and installs no search listeners', () => {
    mount.destroy(); vi.mocked(matchMedia).mockReturnValue({ matches: false });
    const listen = vi.spyOn(document, 'addEventListener');
    const observe = vi.spyOn(MutationObserver.prototype, 'observe');
    mount = mountFrontPageSearchSheet(end, scroller);
    expect(end.children).toHaveLength(0); expect(end.getAttribute('aria-hidden')).toBe('true');
    expect(listen).not.toHaveBeenCalled(); expect(observe).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled();
});

test('slot removal tears down an open sheet and its focus listeners; a drawer lock survives', async () => {
    scroller.classList.add('front-page-scroller--drawer-open'); button.click(); end.remove();
    await vi.waitFor(() => expect(dialog()).toBeNull());
    expect(mocks.destroy).toHaveBeenCalledOnce(); expect(scroller.classList.contains('front-page-scroller--drawer-open')).toBe(true);
    const outside = scroller.querySelector('article button'); outside.focus(); expect(document.activeElement).toBe(outside);
});
