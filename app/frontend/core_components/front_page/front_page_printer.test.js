// front_page_printer.test.js
// Proves visit isolation, cancellation, bounded loading and compact Home rendering.
// Uses the real shared group and language renderer with a controlled endpoint.
// Prevents stale session responses from reappearing after navigation.
// @vitest-environment jsdom

import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { renderFrontPage, refreshFrontPage } from './front_page_printer.js';
import { VIEW_DEACTIVATE_EVENT } from '../../reusable_components/view_lifecycle_events.js';
import { refreshLocalizedDatasetValues } from '../table_views/dataset_value_localizer.js';
import { invalidateSessionGeneration } from '../auth/session_generation_store.js';

const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('../endpoints/endpoint_router.js', () => ({ endpoint_router: mocks.request }));
vi.mock('../lang/translation_handler.js', () => ({
    getTranslationForKey: (key) => ({ front_page: 'Etusivu', front_page_show_all: 'Näytä kaikki',
        front_page_no_results: 'Ei tuloksia', front_page_load_failed: 'Lataus epäonnistui',
        shell_boot_reload: 'Lataa sivu uudelleen', news: 'Uutiset' })[key] || key,
}));

function response(title = 'Current account') {
    return { viewer_id: 42, site_name: '', blocks: [{ dataset: 'news', result_limit: 5,
        columns: ['title', 'description'], types: {
            title: { card_element: 'header', show_value_on_card: true, is_multilingual: true },
            description: { card_element: 'description', show_value_on_card: true },
        }, data: [{ id: 42, title: { fi: title, en: 'English title' }, description: '<p>Safe excerpt</p>' }],
    }] };
}

beforeEach(() => {
    invalidateSessionGeneration({ revalidate: false });
    document.body.innerHTML = '<div id="tabs_container"></div>';
    localStorage.clear(); sessionStorage.clear();
    localStorage.setItem('chosen_language', 'fi');
    mocks.request.mockReset().mockResolvedValue(response());
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
    window.matchMedia = vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
});

afterEach(() => {
    document.getElementById('front_page_container')?.dispatchEvent(new Event(VIEW_DEACTIVATE_EVENT));
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    vi.useRealTimers();
    vi.restoreAllMocks();
});

/** Hides or shows the document as switching browser tabs does. */
function setHidden(hidden) {
    Object.defineProperty(document, 'hidden', { value: hidden, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
}

test('single-flight loader issues only one facade request and shows an accessible skeleton', async () => {
    let finish;
    mocks.request.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const page = renderFrontPage();
    renderFrontPage();
    expect(mocks.request).toHaveBeenCalledTimes(1);
    expect(mocks.request).toHaveBeenCalledWith('frontPage', expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(page.getAttribute('aria-busy')).toBe('true');
    expect(page.querySelector('.front-page-status').getAttribute('aria-live')).toBe('polite');
    finish(response());
    await vi.waitFor(() => expect(page.getAttribute('aria-busy')).toBe('false'));
    renderFrontPage();
    expect(mocks.request).toHaveBeenCalledTimes(1);
    expect(mocks.request.mock.calls.some(([route]) => route === 'getResults')).toBe(false);
});

test('a returning visit loads although navigation already put its spinner into the emptied container', async () => {
    const container = document.createElement('div');
    container.id = 'front_page_container';
    container.className = 'content_div';
    const spinner = document.createElement('div');
    spinner.setAttribute('data-loading-spinner-for', 'front_page_container');
    container.append(spinner);
    document.getElementById('tabs_container').append(container);
    const page = renderFrontPage();
    expect(mocks.request).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(page.querySelectorAll('.supplemental-dataset-group')).toHaveLength(1));
    expect(page.querySelector('[data-loading-spinner-for]')).toBeNull();
});

test('renders localized blocks, empty blocks and newest-first collection/article addresses', async () => {
    const data = response('Suomen otsikko');
    data.blocks.push({ dataset: 'empty', result_limit: 5, data: [] });
    mocks.request.mockResolvedValue(data);
    const page = renderFrontPage();
    await vi.waitFor(() => expect(page.querySelectorAll('.supplemental-dataset-group')).toHaveLength(2));
    await refreshLocalizedDatasetValues('fi');
    expect(page.querySelector('h1').textContent).toBe('Etusivu');
    expect(page.textContent).toContain('Suomen otsikko');
    expect(page.textContent).toContain('Ei tuloksia');
    expect(page.querySelector('.supplemental-dataset-group h2').textContent).toBe('Uutiset');
    const all = new URL(page.querySelector('.supplemental-dataset-show-all').href);
    expect(all.pathname).toBe('/news');
    expect(all.searchParams.get('sort_column')).toBe('__newest');
    expect(all.searchParams.get('sort_order')).toBe('DESC');
    expect(new URL(page.querySelector('li a').href).pathname).toBe('/news/42');
    await refreshLocalizedDatasetValues('en');
    expect(page.textContent).toContain('English title');
    expect(page.querySelector('.supplemental-dataset-group p').textContent).toBe('Safe excerpt');
});

test('uses configured site heading and decorative sized background at the focal point', async () => {
    mocks.request.mockResolvedValue({ ...response(), site_name: 'my site', background: {
        storage_key: 'site_media/front_page/original/test.webp', focal_x: 0.2, focal_y: 0.7,
    } });
    const page = renderFrontPage();
    await vi.waitFor(() => expect(page.querySelector('h1')?.textContent).toBe('My site'));
    const image = page.querySelector('.front-page-background');
    expect(image.getAttribute('aria-hidden')).toBe('true');
    expect(image.style.backgroundPosition).toBe('20% 70%');
    for (const size of ['1000', '2160']) {
        expect(image.style.getPropertyValue('--front-page-background-' + size)).toContain('/' + size + '/test.webp');
    }
});

test('deactivation removes all account data and every new visit fetches for the current session', async () => {
    const page = renderFrontPage();
    await vi.waitFor(() => expect(page.textContent).toContain('Current account'));
    page.dispatchEvent(new Event(VIEW_DEACTIVATE_EVENT));
    expect(page.hasChildNodes()).toBe(false);
    mocks.request.mockResolvedValue(response('Next account'));
    renderFrontPage();
    expect(page.textContent).not.toContain('Current account');
    await vi.waitFor(() => expect(page.textContent).toContain('Next account'));
    expect(mocks.request).toHaveBeenCalledTimes(2);
});

test('an aborted late response cannot render into a later visit', async () => {
    let finishOld;
    mocks.request.mockReturnValueOnce(new Promise(resolve => { finishOld = resolve; }));
    const page = renderFrontPage();
    const oldSignal = mocks.request.mock.calls[0][1].signal;
    page.dispatchEvent(new Event(VIEW_DEACTIVATE_EVENT));
    expect(oldSignal.aborted).toBe(true);
    renderFrontPage();
    await vi.waitFor(() => expect(page.textContent).toContain('Current account'));
    finishOld(response('Previous account'));
    await Promise.resolve(); await Promise.resolve();
    expect(page.textContent).not.toContain('Previous account');
    expect(page.getAttribute('aria-busy')).toBe('false');
});

test('shell teardown cleanup clears and aborts without needing a view-deactivation event', () => {
    mocks.request.mockReturnValue(new Promise(() => {}));
    const page = renderFrontPage();
    const signal = mocks.request.mock.calls[0][1].signal;
    page.__cleanupListeners();
    page.remove();
    expect(signal.aborted).toBe(true);
    expect(page.hasChildNodes()).toBe(false);
    expect(page.hasAttribute('aria-busy')).toBe(false);
});

test('a Home without boxes shows its hero and no box area or empty-results line', async () => {
    mocks.request.mockResolvedValue({ viewer_id: 42, blocks: [] });
    const page = renderFrontPage();
    await vi.waitFor(() => expect(page.querySelector('h1')).not.toBeNull());
    expect(page.querySelector('.front-page-blocks')).toBeNull();
    expect(page.textContent).not.toContain('Ei tuloksia');
});

test('failure is announced with a retry that issues one new request', async () => {
    mocks.request.mockRejectedValueOnce(new Error('failed'));
    const page = renderFrontPage();
    await vi.waitFor(() => expect(page.querySelector('button')).not.toBeNull());
    expect(page.querySelector('[aria-live]').textContent).toContain('Lataus epäonnistui');
    expect(page.getAttribute('aria-busy')).toBe('false');
    page.querySelector('button').click();
    await vi.waitFor(() => expect(page.textContent).toContain('Current account'));
    expect(mocks.request).toHaveBeenCalledTimes(2);
});

test('timeout aborts the request and offers retry after fifteen seconds', async () => {
    vi.useFakeTimers();
    mocks.request.mockReturnValue(new Promise(() => {}));
    const page = renderFrontPage();
    await vi.advanceTimersByTimeAsync(15000);
    expect(mocks.request.mock.calls[0][1].signal.aborted).toBe(true);
    expect(page.querySelector('button')).not.toBeNull();
    expect(page.getAttribute('aria-busy')).toBe('false');
});

test('session invalidation clears visible account blocks before a delayed bootstrap resolves', async () => {
    const page = renderFrontPage();
    await vi.waitFor(() => expect(page.textContent).toContain('Current account'));
    invalidateSessionGeneration({ reason: 'bootstrap', revalidate: false });
    expect(page.hasChildNodes()).toBe(false);
    mocks.request.mockReturnValueOnce(new Promise(() => {}));
    renderFrontPage();
    expect(page.textContent).not.toContain('Current account');
});

test('a late account A response is discarded after B signs in without navigation', async () => {
    let finishA;
    mocks.request.mockReturnValueOnce(new Promise(resolve => { finishA = resolve; }));
    const page = renderFrontPage();
    const signalA = mocks.request.mock.calls[0][1].signal;
    invalidateSessionGeneration({ reason: 'login', revalidate: false });
    expect(signalA.aborted).toBe(true);
    mocks.request.mockResolvedValue({ ...response('Account B'), viewer_id: 73 });
    renderFrontPage();
    await vi.waitFor(() => expect(page.textContent).toContain('Account B'));
    finishA(response('Account A'));
    await Promise.resolve(); await Promise.resolve();
    expect(page.textContent).not.toContain('Account A');
});

test('resume with no broadcast revalidates identity before requesting or showing B blocks', async () => {
    const page = renderFrontPage();
    await vi.waitFor(() => expect(page.textContent).toContain('Current account'));
    let confirmIdentity;
    mocks.request.mockImplementation(route => {
        if (route === 'fetchAuthModes') return Promise.resolve({ needs_button: 'logout' });
        if (route === 'fetchUserProfile') return new Promise(resolve => { confirmIdentity = resolve; });
        return Promise.resolve({ ...response('Account B'), viewer_id: 73 });
    });
    setHidden(true);
    setHidden(false);
    expect(page.textContent).not.toContain('Current account');
    await vi.waitFor(() => expect(confirmIdentity).toBeTypeOf('function'));
    expect(mocks.request.mock.calls.filter(([route]) => route === 'frontPage')).toHaveLength(1);
    confirmIdentity({ user_id: 73 });
    await vi.waitFor(() => expect(page.textContent).toContain('Account B'));
});

test('a suspended page remains empty if identity validation fails on resume', async () => {
    const page = renderFrontPage();
    await vi.waitFor(() => expect(page.textContent).toContain('Current account'));
    mocks.request.mockRejectedValue(new Error('session expired'));
    setHidden(true);
    setHidden(false);
    expect(page.textContent).not.toContain('Current account');
    await vi.waitFor(() => expect(page.querySelector('button')).not.toBeNull());
    expect(mocks.request.mock.calls.filter(([route]) => route === 'frontPage')).toHaveLength(1);
});

test('window blur and focus keep the visible blocks (owner 7.10.2026)', async () => {
    const page = renderFrontPage();
    await vi.waitFor(() => expect(page.textContent).toContain('Current account'));
    const requests = mocks.request.mock.calls.length;
    window.dispatchEvent(new Event('blur'));
    expect(page.textContent).toContain('Current account');
    window.dispatchEvent(new Event('focus'));
    expect(page.textContent).toContain('Current account');
    expect(page.querySelector('.front-page-scroller')).not.toBeNull();
    expect(mocks.request.mock.calls.length).toBe(requests);
});

test('a load cut by a focus change starts again instead of leaving the page empty', async () => {
    let first;
    mocks.request.mockReturnValueOnce(new Promise(resolve => { first = resolve; }));
    const page = renderFrontPage();
    mocks.request.mockImplementation(route => {
        if (route === 'fetchAuthModes') return Promise.resolve({ needs_button: 'logout' });
        if (route === 'fetchUserProfile') return Promise.resolve({ user_id: 42 });
        return Promise.resolve(response('Reloaded'));
    });
    window.dispatchEvent(new Event('blur'));
    first(response('Stale'));
    await vi.waitFor(() => expect(page.textContent).toContain('Reloaded'));
    expect(page.textContent).not.toContain('Stale');
    expect(page.getAttribute('aria-busy')).toBe('false');
});

test('a page restored from the back-forward cache is cleared until the viewer is confirmed', async () => {
    const page = renderFrontPage();
    await vi.waitFor(() => expect(page.textContent).toContain('Current account'));
    let confirmIdentity;
    mocks.request.mockImplementation(route => {
        if (route === 'fetchAuthModes') return Promise.resolve({ needs_button: 'logout' });
        if (route === 'fetchUserProfile') return new Promise(resolve => { confirmIdentity = resolve; });
        return Promise.resolve(response('Restored'));
    });
    const restored = new Event('pageshow');
    Object.defineProperty(restored, 'persisted', { value: true });
    window.dispatchEvent(restored);
    expect(page.textContent).not.toContain('Current account');
    await vi.waitFor(() => expect(confirmIdentity).toBeTypeOf('function'));
    confirmIdentity({ user_id: 42 });
    await vi.waitFor(() => expect(page.textContent).toContain('Restored'));
});

test('top row has the shared tabs/actions and favicon/name beside the single menu in both menu states', async () => {
    document.head.innerHTML = '<link rel="icon" href="/frontend/icons/site_favicons/site-initial-f-v1-16.png">';
    const navbar = document.createElement('div'); navbar.id = 'navbar'; navbar.className = 'collapsed';
    const menu = document.createElement('button'); menu.id = 'showMenuButton';
    document.body.prepend(navbar, menu);
    const originalParent = menu.parentNode;
    mocks.request.mockResolvedValue({ ...response(), site_name: 'test site' });
    const page = renderFrontPage();
    await vi.waitFor(() => expect(page.querySelector('.front-page-top-row')).not.toBeNull());
    const identity = page.querySelector('.front-page-top-row__identity');
    expect(identity.querySelector('#showMenuButton')).toBe(menu);
    expect(document.querySelectorAll('#showMenuButton')).toHaveLength(1);
    expect(identity.querySelector('img').width).toBe(32);
    expect(identity.querySelector('img').src).toContain('site-initial-f-v1-16.png');
    expect(identity.querySelector('.dataset-shared-topbar__dataset-title').textContent).toBe('Test site');
    expect(identity.querySelector('.dataset-shared-topbar__menu-slot').hidden).toBe(false);
    expect(page.querySelector('.hero-dataset-tabs')).not.toBeNull();
    expect(page.querySelector('.filterbar-inline-hero__actions')).not.toBeNull();
    expect(page.querySelector('.dataset-shared-topbar')).toBeNull();
    expect(page.querySelector('.hero-dataset-tabs [aria-current]')).toBeNull();
    navbar.classList.remove('collapsed');
    window.dispatchEvent(new Event('navbar-visibility-changed'));
    expect(identity.querySelector('.dataset-shared-topbar__menu-slot').hidden).toBe(true);
    page.dispatchEvent(new Event(VIEW_DEACTIVATE_EVENT));
    expect(menu.parentNode).toBe(originalParent);
});

test('hero title and slogan follow fi/en, with site-name and empty slogan fallback', async () => {
    mocks.request.mockResolvedValue({ ...response(), site_name: 'my site', hero: {
        title: { fi: 'Oma otsikko', en: 'Our title' }, slogan: { fi: 'Oma iskulause', en: '' },
    } });
    const page = renderFrontPage();
    await vi.waitFor(() => expect(page.querySelector('h1')?.textContent).toBe('Oma otsikko'));
    expect(page.querySelector('.morphing-subtitle').textContent).toBe('Oma iskulause');
    await refreshLocalizedDatasetValues('en');
    expect(page.querySelector('h1').textContent).toBe('Our title');
    expect(page.querySelector('.morphing-subtitle').hidden).toBe(true);
    mocks.request.mockResolvedValue({ ...response(), site_name: 'my site', hero: { title: { fi: '', en: '' }, slogan: {} } });
    await refreshFrontPage();
    expect(page.querySelector('h1').textContent).toBe('My site');
});

test('boxes off omits boxes and empty-state text even if stale data is present; boxes on retains caps', async () => {
    mocks.request.mockResolvedValue({ ...response(), show_blocks: false });
    const page = renderFrontPage();
    await vi.waitFor(() => expect(page.querySelector('h1')).not.toBeNull());
    expect(page.querySelector('.front-page-blocks')).toBeNull();
    expect(page.textContent).not.toContain('Ei tuloksia');
    expect(page.textContent).not.toContain('Current account');
    mocks.request.mockResolvedValue({ ...response(), show_blocks: true });
    await refreshFrontPage();
    expect(page.querySelectorAll('.supplemental-dataset-group')).toHaveLength(1);
    expect(page.querySelector('.front-page-scroller').contains(page.querySelector('.front-page-content'))).toBe(true);
    expect(page.querySelector('.front-page-scroller').contains(page.querySelector('.front-page-top-row'))).toBe(false);
});

test.each(['mp4', 'webm'])('video %s uses original, autoplay/mute/loop/inline and focal point, with lifecycle cleanup', async ext => {
    mocks.request.mockResolvedValue({ ...response(), background: { storage_key: `site_media/front_page/original/movie.${ext}`,
        mime_type: `video/${ext}`, focal_x: 0.3, focal_y: 0.6 } });
    const page = renderFrontPage();
    await vi.waitFor(() => expect(page.querySelector('video')).not.toBeNull());
    const video = page.querySelector('video');
    expect(video.src).toContain(`/original/movie.${ext}`);
    expect(video.autoplay).toBe(true); expect(video.muted).toBe(true);
    expect(video.loop).toBe(true); expect(video.playsInline).toBe(true); expect(video.controls).toBe(false);
    expect(video.style.objectPosition).toBe('30% 60%');
    expect(video.parentElement.style.getPropertyValue('--front-page-background-1000')).toBe('');
    expect(page.querySelector('.front-page-scroller').contains(video)).toBe(false);
    page.dispatchEvent(new Event(VIEW_DEACTIVATE_EVENT));
    expect(video.hasAttribute('src')).toBe(false);
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
});

test('reduced motion prevents autoplay and reacts to changes without leaving a listener after teardown', async () => {
    const motion = { matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() };
    window.matchMedia.mockReturnValue(motion);
    mocks.request.mockResolvedValue({ ...response(), background: { storage_key: 'site_media/front_page/original/movie.mp4',
        mime_type: 'video/mp4', focal_x: 0.5, focal_y: 0.5 } });
    const page = renderFrontPage();
    await vi.waitFor(() => expect(page.querySelector('video')).not.toBeNull());
    const video = page.querySelector('video');
    expect(video.autoplay).toBe(false);
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
    const listener = motion.addEventListener.mock.calls[0][1];
    motion.matches = false; listener(); expect(video.autoplay).toBe(true);
    motion.matches = true; listener(); expect(video.autoplay).toBe(false);
    page.dispatchEvent(new Event(VIEW_DEACTIVATE_EVENT));
    expect(motion.removeEventListener).toHaveBeenCalledWith('change', listener);
});
