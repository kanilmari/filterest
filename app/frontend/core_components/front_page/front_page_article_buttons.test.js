// front_page_article_buttons.test.js
// Proves payload-only links, both mounts and language/session request freshness.
// Connects the real Home renderer to bounded server responses and lifecycle events.
// Keeps private configuration and obsolete labels out of the visible page.
// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderFrontPage } from './front_page_printer.js';
import { createFrontPageArticleButtons } from './front_page_article_buttons.js';
import { refreshLocalizedDatasetValues } from '../table_views/dataset_value_localizer.js';
import { invalidateSessionGeneration } from '../auth/session_generation_store.js';

const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('../endpoints/endpoint_router.js', () => ({ endpoint_router: mocks.request }));
vi.mock('../lang/translation_handler.js', () => ({ getTranslationForKey: key => key }));
vi.mock('./front_page_top_row_builder.js', () => ({ createFrontPageTopRow: () => {
    const element = document.createElement('div'); element.className = 'front-page-top-row';
    const tabs = document.createElement('div'); tabs.className = 'hero-dataset-tabs';
    const actions = document.createElement('div'); actions.className = 'filterbar-inline-hero__actions';
    element.append(tabs, actions); return { element, destroy() {} };
} }));
const buttons = [{ href: '/news/3?view=article_view', label: '<Contact>' },
    { href: '/about/1?view=article_view', label: 'Second' }];
function response(placement = 'below_text', article_buttons = buttons) {
    return { viewer_id: 42, article_buttons_placement: placement, article_buttons, show_blocks: false,
        hero: { description: { fi: 'Home text', en: 'Home text' } } };
}
async function mounted() {
    const page = renderFrontPage();
    await vi.waitFor(() => expect(page.getAttribute('aria-busy')).toBe('false'));
    return page;
}
beforeEach(() => {
    invalidateSessionGeneration({ revalidate: false });
    document.body.innerHTML = '<div id="tabs_container"></div>';
    localStorage.clear(); localStorage.setItem('chosen_language', 'fi');
    mocks.request.mockReset().mockResolvedValue(response());
});
afterEach(() => document.getElementById('front_page_container')?.__cleanupListeners?.());

test.each(['below_text', 'top_row'])('mounts accessible ordered payload links at %s', async placement => {
    mocks.request.mockResolvedValue(response(placement));
    const page = await mounted();
    const links = [...page.querySelectorAll('.front-page-article-button')];
    expect(links.map(link => link.textContent)).toEqual(['<Contact>', 'Second']);
    expect(links.map(link => link.getAttribute('href'))).toEqual(buttons.map(item => item.href));
    expect(links[0].querySelector('*')).toBeNull();
    const list = page.querySelector('.front-page-article-buttons');
    if (placement === 'below_text') {
        expect(list.previousElementSibling.className).toBe('front-page-description');
        expect(list.parentElement.classList.contains('front-page-hero')).toBe(true);
    } else {
        expect(list.previousElementSibling.className).toBe('hero-dataset-tabs');
        expect(list.nextElementSibling.className).toBe('filterbar-inline-hero__actions');
    }
    expect(mocks.request.mock.calls.map(([route]) => route)).toEqual(['frontPage']);
});
test.each(['below_text', 'top_row'])('empty %s has no link wrapper or leaked configuration', async placement => {
    mocks.request.mockResolvedValue({ ...response(placement, []), items: [{ label: 'Private target', table_uid: 777 }] });
    const page = await mounted();
    expect(page.querySelector('.front-page-article-buttons')).toBeNull();
    expect(page.textContent).not.toContain('Private target');
});
test('rejects malformed entries without deriving a label from private fields', () => {
    expect(createFrontPageArticleButtons([{ href: 'javascript:alert(1)', label: 'Bad' },
        { href: '//outside.test', label: 'Bad' }, { href: '/news/1', title: 'Private' },
        { href: '/\\outside.test', label: 'Bad' }, { href: '/news/1', label: '' }])).toBeNull();
});
test('a language switch refreshes labels through the one Home read', async () => {
    const page = await mounted();
    mocks.request.mockResolvedValue(response('below_text', [{ ...buttons[0], label: 'English contact' }]));
    localStorage.setItem('chosen_language', 'en');
    await refreshLocalizedDatasetValues('en');
    expect(page.querySelector('.front-page-article-button').textContent).toBe('English contact');
    expect(mocks.request).toHaveBeenLastCalledWith('frontPage', expect.objectContaining({ url_params: 'lang=en' }));
    expect(mocks.request).toHaveBeenCalledTimes(2);
});
test('a changed language cancels an old in-flight payload', async () => {
    let finish;
    mocks.request.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const page = renderFrontPage();
    const oldSignal = mocks.request.mock.calls[0][1].signal;
    mocks.request.mockResolvedValue(response('top_row', [{ ...buttons[0], label: 'New language' }]));
    localStorage.setItem('chosen_language', 'en'); await refreshLocalizedDatasetValues('en');
    finish(response()); await Promise.resolve();
    expect(oldSignal.aborted).toBe(true);
    expect(page.querySelector('.front-page-article-button').textContent).toBe('New language');
});
test('a session change removes rendered buttons before the next account read', async () => {
    const page = await mounted();
    invalidateSessionGeneration({ revalidate: false });
    expect(page.querySelector('.front-page-article-button')).toBeNull();
    mocks.request.mockResolvedValue(response('top_row', []));
    await mounted();
    expect(page.querySelector('.front-page-article-buttons')).toBeNull();
});
test('the independent stylesheet owns 44px links, focus and 700px phone placements', () => {
    const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'front_page_article_buttons.css'), 'utf8');
    expect(css).toContain('min-height: 44px'); expect(css).toContain(':focus-visible');
    expect(css).toContain('@media (width <= 700px)');
    expect(css).toContain('.front-page-hero > .front-page-article-buttons > a');
    expect(css).not.toContain('prefers-color-scheme');
});
test('top-row links align at the right edge, with no empty administrator column', () => {
    const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'front_page_article_buttons.css'), 'utf8');
    const row = css.match(/\.front-page > \.front-page-top-row:has\(> \.front-page-article-buttons\) \{([^}]+)\}/)[1];
    expect(row).toContain('grid-template-columns: minmax(0, 1fr) minmax(0, 2fr) minmax(0, 1fr);');
    expect(css).toContain(':where(:has(> .filterbar-inline-hero__actions:not(:empty)))');
    const list = css.match(/\.front-page-top-row > \.front-page-article-buttons \{([^}]+)\}/)[1];
    expect(list).toContain('grid-column: 3;'); expect(list).toContain('grid-row: 1;');
    expect(list).toContain('justify-self: end;'); expect(list).toContain('justify-content: flex-end;');
    expect(list).toContain('margin-inline-start: auto;');
    const phone = css.slice(css.indexOf('@media (width <= 700px)'));
    expect(phone).toMatch(/\.front-page-top-row > \.front-page-article-buttons \{[^}]*grid-row: 3;[^}]*width: 100%;[^}]*margin-inline-start: 0;/);
    expect(phone).toMatch(/\.front-page-top-row > \.front-page-article-buttons > a \{[^}]*width: 100%;/);
});
test('only top-row buttons become transparent outlined pills with theme contrast halos', () => {
    const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'front_page_article_buttons.css'), 'utf8');
    const pill = css.match(/\.front-page-top-row > \.front-page-article-buttons > \.front-page-article-button \{([^}]+)\}/)[1];
    expect(pill).toContain('background: transparent;'); expect(pill).toContain('border: 2px solid var(--text_color);');
    expect(pill).toContain('color: var(--text_color);'); expect(pill).toContain('border-radius: 999px;');
    expect(pill).toContain('font-weight: 700;'); expect(pill).toContain('padding: 10px 28px;');
    expect(pill).toMatch(/text-shadow:[\s\S]*var\(--bg_color\)/);
    expect(pill).toContain('box-shadow: 0 0 0 1px var(--bg_color), inset 0 0 0 1px var(--bg_color);');
    const belowText = css.match(/\n\.front-page-article-button \{([^}]+)\}/)[1];
    expect(belowText).toContain('padding: 10px 16px;');
    expect(belowText).not.toMatch(/border:|border-radius:|background:|color:|font-weight:|text-shadow:|box-shadow:/);
});
