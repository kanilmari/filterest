// front_page_printer.test.js
// Proves visit isolation, cancellation, bounded loading and compact Home rendering.
// Uses the real shared group and language renderer with a controlled endpoint.
// Prevents stale session responses from reappearing after navigation.
// @vitest-environment jsdom

import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { setFrontPageAvailability, isSeparateFrontPageEnabled } from './front_page_availability.js';
import { renderFrontPage, refreshFrontPage } from './front_page_printer.js';
import { VIEW_DEACTIVATE_EVENT } from '../../reusable_components/view_lifecycle_events.js';
import { refreshLocalizedDatasetValues } from '../table_views/dataset_value_localizer.js';
import { invalidateSessionGeneration } from '../auth/session_generation_store.js';
import { toggleNavbarVisibility } from '../navigation/menu_button/navbar_visibility_handler.js';

const mocks = vi.hoisted(() => ({ request: vi.fn(), start: vi.fn(), tabs: [], image: vi.fn(), avatar: vi.fn() }));
vi.mock('../navigation/main_tabs/main_dataset_tabs.js', () => ({
    getMainDatasetTabs: () => mocks.tabs, subscribeMainDatasetTabs: () => () => {},
}));
vi.mock('../table_views/card_view/card_avatar_builder.js', () => ({
    createImageElement: mocks.image, create_seeded_avatar: mocks.avatar,
}));
vi.mock('./front_page_navigation.js', () => ({ openNormalStartView: mocks.start, openFrontPage: vi.fn(), isSeparateFrontPageEnabled: () => false, isFrontPageShowing: () => false }));
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
    sessionStorage.setItem('user_permissions', JSON.stringify(['/ui/view/article_view']));
    localStorage.setItem('chosen_language', 'fi');
    mocks.request.mockReset().mockResolvedValue(response());
    mocks.start.mockReset().mockResolvedValue();
    mocks.tabs = [];
    mocks.image.mockReset().mockImplementation(() => document.createElement('img'));
    mocks.avatar.mockReset().mockImplementation(async (_seed, letter) => {
        const avatar = document.createElement('div');
        avatar.textContent = letter;
        return avatar;
    });
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

test.each([700, 701])('Home mounts the reversible phone host at %ipx with media outside the scroller', async width => {
    window.matchMedia = vi.fn(query => ({ matches: query === '(width <= 700px)' && width <= 700,
        addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    document.body.insertAdjacentHTML('afterbegin', '<div id="navbar" class="collapsed"></div><button id="showMenuButton"></button>');
    mocks.request.mockResolvedValue({ ...response(), background: {
        storage_key: 'site_media/front_page/original/test.webp', focal_x: 0.5, focal_y: 0.5,
    } });
    const page = renderFrontPage();
    await vi.waitFor(() => expect(page.querySelector('.front-page-top-row')).not.toBeNull());
    const scroller = page.querySelector('.front-page-scroller');
    const row = page.querySelector('.front-page-top-row');
    const background = page.querySelector('.front-page-background');
    expect(background.parentElement).toBe(page);
    expect(scroller.contains(background)).toBe(false);
    if (width <= 700) {
        expect(scroller.firstElementChild.className).toBe('front-page-phone-topbar');
        expect(scroller.firstElementChild.querySelector('#showMenuButton')).not.toBeNull();
        expect(scroller.firstElementChild.nextElementSibling).toBe(row);
        expect(row.nextElementSibling.classList.contains('front-page-content')).toBe(true);
    } else {
        expect(page.querySelector('.front-page-phone-topbar')).toBeNull();
        expect(row.parentElement).toBe(page);
        expect(row.nextElementSibling).toBe(scroller);
    }
    page.dispatchEvent(new Event(VIEW_DEACTIVATE_EVENT));
    expect(document.getElementById('showMenuButton').parentElement).toBe(document.body);
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
    localStorage.setItem('chosen_language', 'en');
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

test('Home boxes follow tab order with shared images, letter fallbacks and one link per row', async () => {
    const datasets = ['app_travel_info', 'app_travel_deals', 'app_blogs'];
    mocks.tabs = datasets.map(dataset => ({ dataset, text: dataset, langKey: dataset }));
    const block = response('Suomen matkakohteet').blocks[0];
    mocks.request.mockResolvedValue({ viewer_id: 42, blocks: datasets.map(dataset => ({
        ...block, dataset, data: [
            { ...block.data[0], cached_image: './storage/test/300/home.jpg' },
            { ...block.data[0], id: 43 },
        ],
    })) });
    const page = renderFrontPage();
    await vi.waitFor(() => expect(page.querySelectorAll('.supplemental-dataset-result')).toHaveLength(6));
    const groups = [...page.querySelectorAll('.front-page-blocks > section')];
    const tabs = [...page.querySelectorAll('.hero-dataset-tabs__button')];
    expect(groups.map(group => group.dataset.dataset)).toEqual(tabs.map(tab => tab.dataset.dataset));
    expect(groups.map(group => group.dataset.dataset)).toEqual(datasets);
    await vi.waitFor(() => expect(mocks.image).toHaveBeenCalledTimes(3));
    await vi.waitFor(() => expect(mocks.avatar).toHaveBeenCalledTimes(3));
    expect(mocks.image).toHaveBeenCalledWith('./storage/test/300/home.jpg', false,
        expect.objectContaining({ renderSlot: 'small_thumbnail', rowLabel: 'Suomen matkakohteet' }));
    expect(mocks.avatar).toHaveBeenCalledWith('43_', 'S', false);
    for (const group of groups) {
        const rows = [...group.querySelectorAll('li')];
        expect(rows.map(row => row.querySelector('a').dataset.rowId)).toEqual(['42', '43']);
        for (const row of rows) {
            expect(row.querySelectorAll('a[href], button, [tabindex]')).toHaveLength(1);
            expect(row.querySelector('a').tabIndex).toBe(0);
            expect(row.querySelector('.supplemental-dataset-thumbnail').getAttribute('aria-hidden')).toBe('true');
            expect(row.querySelector('p').textContent).toBe('Safe excerpt');
        }
        await vi.waitFor(() => expect(rows[1].querySelector('.card_small_image_inner')?.textContent).toBe('S'));
        expect(group.lastElementChild.className).toBe('supplemental-dataset-show-all');
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

// Owner 14.10.2026: signed-in and signed-out Home share the dataset opener/closer contract.
test.each([1, 42].flatMap(viewer => [false, true].map(open => ({ viewer, open }))))(
    'viewer $viewer mounts the same Home identity and reachable toggle with the panel open=$open',
    async ({ viewer, open }) => {
        document.body.innerHTML = `<div class="body_content">
            <button id="showMenuButton" aria-hidden="true" aria-expanded="true" tabindex="-1"></button>
            <nav id="navbar"><button id="hideMenuButton"></button></nav>
            <div id="tabs_container"></div></div>`;
        const button = document.getElementById('showMenuButton');
        const close = document.getElementById('hideMenuButton');
        if (!open) toggleNavbarVisibility();
        mocks.request.mockResolvedValue({ viewer_id: viewer, site_name: 'Fintravel', blocks: [] });
        const page = renderFrontPage();
        await vi.waitFor(() => expect(page.getAttribute('aria-busy')).toBe('false'));
        const identity = page.querySelector('.front-page-top-row__identity');
        expect(identity.querySelector('#showMenuButton')).toBe(button);
        expect(identity.querySelector('.front-page-site-name').textContent).toBe('Fintravel');
        for (const expanded of [open, !open, open]) {
            expect(page.querySelector('.dataset-shared-topbar__menu-slot').hidden).toBe(expanded);
            expect(button.getAttribute('aria-hidden')).toBe(String(expanded));
            expect(button.getAttribute('aria-expanded')).toBe(String(expanded));
            expect(button.tabIndex).toBe(expanded ? -1 : 0);
            expect(button.classList.contains('menu-toggle-visible')).toBe(!expanded);
            expect(close.getAttribute('aria-hidden')).toBe(String(!expanded));
            expect(close.tabIndex).toBe(expanded ? 0 : -1);
            toggleNavbarVisibility();
        }
        page.dispatchEvent(new Event(VIEW_DEACTIVATE_EVENT));
        expect(button.parentElement).toBe(document.querySelector('.body_content'));
        expect(close.getAttribute('aria-hidden')).toBe(String(open));
        expect(button.getAttribute('aria-hidden')).toBe(String(!open));
        // Leave the shared visibility owner open for the next independent fixture.
        if (open) toggleNavbarVisibility();
    },
);

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

test('a request stopped by a leave the browser cancelled loads once more, and only once (G5)', async () => {
    const stopped = () => new TypeError('Failed to fetch');
    try {
        window.dispatchEvent(new Event('beforeunload'));
        mocks.request.mockRejectedValueOnce(stopped());
        const page = renderFrontPage();
        await vi.waitFor(() => expect(page.textContent).toContain('Current account'));
        expect(mocks.request).toHaveBeenCalledTimes(2);
        expect(page.textContent).not.toContain('Lataus epäonnistui');

        document.body.innerHTML = '<div id="tabs_container"></div>';
        mocks.request.mockReset().mockRejectedValueOnce(stopped()).mockRejectedValueOnce(stopped());
        const again = renderFrontPage();
        await vi.waitFor(() => expect(again.querySelector('[aria-live]').textContent).toContain('Lataus epäonnistui'));
        expect(mocks.request).toHaveBeenCalledTimes(2);
    } finally {
        window.dispatchEvent(new Event('pageshow'));
    }
    document.body.innerHTML = '<div id="tabs_container"></div>';
    mocks.request.mockReset().mockRejectedValueOnce(stopped());
    const unrelated = renderFrontPage();
    await vi.waitFor(() => expect(unrelated.querySelector('[aria-live]').textContent).toContain('Lataus epäonnistui'));
    expect(mocks.request).toHaveBeenCalledTimes(1);
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

// Owner 14.10.2026: identity and actions remain unchanged when the open-menu slot disappears.
test('top row keeps its shared tabs/actions and identity while only the hidden menu shows its borrowed toggle', async () => {
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
    expect(page.querySelector('.hero-dataset-tabs__button[aria-current]')).toBeNull();
    navbar.classList.remove('collapsed');
    window.dispatchEvent(new Event('navbar-visibility-changed'));
    expect(identity.querySelector('.dataset-shared-topbar__menu-slot').hidden).toBe(true);
    page.dispatchEvent(new Event(VIEW_DEACTIVATE_EVENT));
    expect(menu.parentNode).toBe(originalParent);
});

test('hero title and slogan follow fi/en, with site-name and empty slogan fallback', async () => {
    mocks.request.mockResolvedValue({ ...response(), site_name: 'my site', hero: {
        title: { fi: 'Oma otsikko', en: 'Our title' }, slogan: { fi: 'Oma iskulause\ntoisella rivillä', en: '' },
    } });
    const page = renderFrontPage();
    await vi.waitFor(() => expect(page.querySelector('h1')?.textContent).toBe('Oma otsikko'));
    expect(page.querySelector('.morphing-subtitle').textContent).toBe('Oma iskulause\ntoisella rivillä');
    localStorage.setItem('chosen_language', 'en');
    await refreshLocalizedDatasetValues('en');
    expect(page.querySelector('h1').textContent).toBe('Our title');
    expect(page.querySelector('.front-page-slogan').hidden).toBe(true);
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


test('title, larger slogan and description form separate safe paragraphs and update languages independently', async () => {
    mocks.request.mockResolvedValue({ ...response(), hero: {
        title: { fi: 'Otsikko', en: '' }, slogan: { fi: 'Iskulause\nrivi\n\nToinen', en: '' },
        description: { fi: 'Kuvaus\nrivi\n\nLopuksi', en: 'Only description' },
    } });
    const page = renderFrontPage();
    await vi.waitFor(() => expect(page.querySelector('h1')?.textContent).toBe('Otsikko'));
    const hero = page.querySelector('.front-page-hero');
    expect([...hero.children].map(element => element.tagName)).toEqual(['H1', 'DIV', 'DIV']);
    expect(hero.querySelector('.front-page-slogan').children).toHaveLength(2);
    expect(hero.querySelector('.front-page-description').children).toHaveLength(2);
    expect(hero.querySelector('.front-page-description p').textContent).toBe('Kuvaus\nrivi');
    expect(page.querySelector('.front-page-text-stage').dataset.anchor).toBe('center-center');
    expect(hero.dataset.alignment).toBe('start');
    localStorage.setItem('chosen_language', 'en');
    await refreshLocalizedDatasetValues('en');
    expect(hero.querySelector('.front-page-slogan').hidden).toBe(true);
    expect(hero.querySelector('.front-page-description').textContent).toBe('Only description');
});


test.each(['json', 'text'])('404 %s front page unavailable turns Home off and opens the normal start without a retry box', async bodyType => {
    setFrontPageAvailability({ separate_front_page: true });
    mocks.request.mockRejectedValueOnce(Object.assign(new Error('diagnostic copy is not the server contract'), { status: 404, responseBody: bodyType === 'json' ? JSON.stringify({ error: 'front page unavailable', code: 404 }) : 'front page unavailable\n' }));
    const page = renderFrontPage();
    await vi.waitFor(() => expect(mocks.start).toHaveBeenCalledOnce());
    expect(isSeparateFrontPageEnabled()).toBe(false);
    expect(localStorage.getItem('separate_front_page')).toBe('false');
    expect(page.querySelector('.front-page-status')).toBeNull();
    expect(page.textContent).not.toContain('Lataus epäonnistui');
});

test.each([[404, 'dataset missing'], [500, 'front page unavailable'], [0, 'offline']])(
    'other failure %s/%s retains Home and the retry box', async (status, message) => {
        setFrontPageAvailability({ separate_front_page: true });
        mocks.request.mockRejectedValueOnce(Object.assign(new Error(message), { status, responseBody: JSON.stringify({ error: message, code: status }) }));
        const page = renderFrontPage();
        await vi.waitFor(() => expect(page.querySelector('.front-page-status button')).not.toBeNull());
        expect(isSeparateFrontPageEnabled()).toBe(true);
        expect(mocks.start).not.toHaveBeenCalled();
    });

test('a late unavailable response from a departed visit cannot disable current Home', async () => {
    setFrontPageAvailability({ separate_front_page: true });
    let fail;
    mocks.request.mockReturnValueOnce(new Promise((_, reject) => { fail = reject; }));
    const page = renderFrontPage();
    page.dispatchEvent(new Event(VIEW_DEACTIVATE_EVENT));
    fail(Object.assign(new Error('front page unavailable'), { status: 404, responseBody: JSON.stringify({ error: 'front page unavailable', code: 404 }) }));
    await Promise.resolve(); await Promise.resolve();
    expect(isSeparateFrontPageEnabled()).toBe(true);
    expect(mocks.start).not.toHaveBeenCalled();
});

test('an older unavailable response cannot disable a newer enabled policy in the same visit', async () => {
    let fail;
    mocks.request.mockReturnValueOnce(new Promise((_, reject) => { fail = reject; }));
    const page = renderFrontPage();
    setFrontPageAvailability({ separate_front_page: true });
    fail(Object.assign(new Error('front page unavailable'), { status: 404, responseBody: 'front page unavailable' }));
    await vi.waitFor(() => expect(page.getAttribute('aria-busy')).toBe('false'));
    expect(isSeparateFrontPageEnabled()).toBe(true);
    expect(mocks.start).not.toHaveBeenCalled();
    expect(page.querySelector('.front-page-status button')).toBeNull();
});

test.each(['content', 'failure'])('newer enabled policy settles its fresh Home request with %s', async outcome => {
    let fail;
    mocks.request.mockReturnValueOnce(new Promise((_, reject) => { fail = reject; }));
    if (outcome === 'failure') mocks.request.mockRejectedValueOnce(new Error('offline'));
    const page = renderFrontPage();
    setFrontPageAvailability({ separate_front_page: true });
    fail(Object.assign(new Error('front page unavailable'), { status: 404, responseBody: 'front page unavailable' }));
    await vi.waitFor(() => expect(page.getAttribute('aria-busy')).toBe('false'));
    expect(isSeparateFrontPageEnabled()).toBe(true);
    expect(localStorage.getItem('separate_front_page')).toBe('true');
    expect(mocks.start).not.toHaveBeenCalled();
    expect(mocks.request).toHaveBeenCalledTimes(2);
    expect(page.querySelector('.front-page-skeleton')).toBeNull();
    if (outcome === 'content') {
        expect(page.querySelector('.front-page-scroller')).not.toBeNull();
        expect(page.textContent).toContain('Current account');
    } else {
        expect(page.querySelector('.front-page-status button')?.textContent).toBe('Lataa sivu uudelleen');
    }
});
