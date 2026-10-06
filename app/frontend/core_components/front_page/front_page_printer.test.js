// front_page_printer.test.js
// Proves visit isolation, cancellation, bounded loading and compact Home rendering.
// Uses the real shared group and language renderer with a controlled endpoint.
// Prevents stale session responses from reappearing after navigation.
// @vitest-environment jsdom

import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { renderFrontPage } from './front_page_printer.js';
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
});

afterEach(() => {
    document.getElementById('front_page_container')?.dispatchEvent(new Event(VIEW_DEACTIVATE_EVENT));
    vi.useRealTimers();
});

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
    expect(page.querySelector('p').textContent).toBe('Safe excerpt');
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

test('empty page has translated empty text', async () => {
    mocks.request.mockResolvedValue({ viewer_id: 42, blocks: [] });
    const page = renderFrontPage();
    await vi.waitFor(() => expect(page.textContent).toContain('Ei tuloksia'));
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
    window.dispatchEvent(new Event('focus'));
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
    window.dispatchEvent(new Event('focus'));
    expect(page.textContent).not.toContain('Current account');
    await vi.waitFor(() => expect(page.querySelector('button')).not.toBeNull());
    expect(mocks.request.mock.calls.filter(([route]) => route === 'frontPage')).toHaveLength(1);
});
