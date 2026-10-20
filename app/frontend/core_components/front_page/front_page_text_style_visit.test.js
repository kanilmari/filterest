// front_page_text_style_visit.test.js
// Proves real Home preview/reset/save callbacks rebuild text once and release motion listeners.
// Connects the printer's language rendering and deactivation to a controlled top-row palette.
// Covers site-name fallback and theme changes preserving the existing reveal nodes.
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { renderFrontPage } from './front_page_printer.js';
import { VIEW_DEACTIVATE_EVENT } from '../../reusable_components/view_lifecycle_events.js';
import { refreshLocalizedDatasetValues } from '../table_views/dataset_value_localizer.js';
import { invalidateSessionGeneration } from '../auth/session_generation_store.js';
import { DEFAULT_HOME_PRESENTATION as defaults } from '../../shared/front_page_presentation/validator.js';

const mocks = vi.hoisted(() => ({ request: vi.fn(), preview: null }));
vi.mock('../endpoints/endpoint_router.js', () => ({ endpoint_router: mocks.request }));
vi.mock('../lang/translation_handler.js', () => ({ getTranslationForKey: key => key }));
vi.mock('./front_page_top_row_builder.js', () => ({ createFrontPageTopRow: (_name, _refresh, options) => {
    mocks.preview = options.render;
    return { element: document.createElement('nav'), mount() {}, destroy() {} };
} }));
let motion;
let page;
beforeEach(() => {
    mocks.preview = null;
    invalidateSessionGeneration({ revalidate: false });
    const tabs = document.createElement('div'); tabs.id = 'tabs_container'; document.body.append(tabs);
    localStorage.setItem('chosen_language', 'fi');
    motion = { matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() };
    vi.stubGlobal('matchMedia', vi.fn(() => motion));
    mocks.request.mockResolvedValue({ viewer_id: 42, site_name: 'fintravel', blocks: [], presentation: defaults,
        hero: { title: { fi: '', en: 'Travel news and deals' }, slogan: { fi: 'yhdellä silmäyksellä', en: 'at a glance' },
            description: { fi: '**Alku**\nLoppu', en: '**Start**\nEnd' } } });
});
afterEach(() => {
    page?.__cleanupListeners?.();
    document.body.replaceChildren(); localStorage.clear(); vi.unstubAllGlobals(); vi.restoreAllMocks();
});
const story = { ...defaults, text_style: { preset: 'serif_story_v1', reveal: { mode: 'lines', start_ms: 3000, interval_ms: 800 } } };

test('preview rebuilds hero once, theme preserves it, reset restores default and deactivation removes listener', async () => {
    page = renderFrontPage();
    await vi.waitFor(() => expect(page.querySelector('h1')?.textContent).toBe('Fintravel'));
    mocks.preview(story);
    expect(page.querySelector('h1')?.textContent).toBe('Fintravel yhdellä silmäyksellä');
    expect(motion.addEventListener).toHaveBeenCalledTimes(1);
    const line = page.querySelector('.front-page-story-line');
    document.body.className = 'dark-mode';
    expect(page.querySelector('.front-page-story-line')).toBe(line);
    expect(motion.addEventListener).toHaveBeenCalledTimes(1);
    mocks.preview(defaults);
    expect(page.querySelector('.front-page-story-line')).toBeNull();
    expect(page.querySelector('.front-page-slogan')?.textContent).toBe('yhdellä silmäyksellä');
    expect(motion.removeEventListener).toHaveBeenCalledTimes(1);
    mocks.preview(story); // The same callback receives the saved presentation.
    expect(motion.addEventListener).toHaveBeenCalledTimes(2);
    page.dispatchEvent(new Event(VIEW_DEACTIVATE_EVENT));
    expect(motion.removeEventListener).toHaveBeenCalledTimes(2);
    expect(page.querySelector('h1')).toBeNull();
});

test('language render replaces lines and restarts once, without retaining the old listener', async () => {
    page = renderFrontPage();
    await vi.waitFor(() => expect(mocks.preview).toBeTypeOf('function'));
    mocks.preview(story);
    const first = page.querySelector('.front-page-story-line');
    await refreshLocalizedDatasetValues('en', page);
    expect(page.querySelector('h1')?.textContent).toBe('Travel news and deals at a glance');
    expect(page.querySelector('.front-page-hero')?.lang).toBe('en');
    expect(page.querySelector('.front-page-story-line')?.textContent).toBe('Start');
    expect(page.querySelector('.front-page-story-line')).not.toBe(first);
    expect(motion.addEventListener).toHaveBeenCalledTimes(2);
    expect(motion.removeEventListener).toHaveBeenCalledTimes(1);
});

test('long slogans stay unique across preview/save/reset and language rebuilds', async () => {
    const accent = 'Fintravel kokoaa yhteen sen, mitä matkaa suunnitteleva tarvitsee.';
    mocks.request.mockResolvedValue({ viewer_id: 42, site_name: 'fintravel', blocks: [], presentation: defaults,
        hero: { title: { fi: 'Matkatiedot', en: 'Travel' }, slogan: { fi: accent, en: 'at a glance' },
            description: { fi: '**Alku**\nLoppu', en: '**Start**\nEnd' } } });
    page = renderFrontPage();
    await vi.waitFor(() => expect(mocks.preview).toBeTypeOf('function'));
    for (let render = 0; render < 2; render++) {
        mocks.preview(story); // Preview and save use the same render callback.
        expect(page.querySelectorAll('.front-page-story-lead')).toHaveLength(1);
        expect(page.querySelector('.front-page-story-lead').textContent).toBe(accent);
        expect(page.querySelector('h1').textContent).toBe('Matkatiedot');
    }
    mocks.preview(defaults);
    expect(page.querySelector('.front-page-story-lead')).toBeNull();
    expect(page.querySelector('.front-page-slogan').textContent).toBe(accent);
    mocks.preview(story);
    await refreshLocalizedDatasetValues('en', page);
    expect(page.querySelectorAll('.front-page-title-accent')).toHaveLength(1);
    expect(page.querySelector('.front-page-story-lead')).toBeNull();
    await refreshLocalizedDatasetValues('fi', page);
    expect(page.querySelectorAll('.front-page-story-lead')).toHaveLength(1);
    expect(page.querySelector('.front-page-title-accent')).toBeNull();
    expect(page.querySelector('.front-page-story-line').style.getPropertyValue('--line-index')).toBe('0');
});

test.each(['fi', 'en'])('empty title keeps the site fallback and empty slogan omits the accent in %s', async language => {
    localStorage.setItem('chosen_language', language);
    mocks.request.mockResolvedValue({ viewer_id: 42, site_name: 'fintravel', blocks: [], presentation: story,
        hero: { title: { fi: '', en: '' }, slogan: { fi: '', en: '' }, description: { fi: 'Rivi', en: 'Line' } } });
    page = renderFrontPage();
    await vi.waitFor(() => expect(page.querySelector('h1')?.textContent).toBe('Fintravel'));
    expect(page.querySelector('.front-page-title-accent')).toBeNull();
    expect(page.querySelector('.front-page-slogan')).toBeNull();
    expect(page.querySelector('.front-page-hero')?.lang).toBe(language);
    expect(page.querySelector('.front-page-story-line')?.textContent).toBe(language === 'fi' ? 'Rivi' : 'Line');
});
