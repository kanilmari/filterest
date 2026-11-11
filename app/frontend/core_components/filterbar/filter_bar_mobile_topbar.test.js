// @vitest-environment jsdom
// filter_bar_mobile_topbar.test.js
// Proves the phone search toggle in the assembled dataset toolbar.
// Connects button ownership, translated state, focus and existing search drafts.
// Guards against automatic search opening on scroll and displaced corner controls.
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanupFilterBarBuilderTestDom, resetFilterBarBuilderTestDom } from './filter_bar_builder_test_setup.js';
import { getLanguageWithBrowserFallback } from '../state_stores/lang_preference_reader.js';
beforeEach(async () => {
    const rules = await import('./shared_topbar_builder.js');
    const actual = await vi.importActual('./shared_topbar_builder.js');
    rules.shouldShowSharedTopBar.mockImplementation(actual.shouldShowSharedTopBar);
    resetFilterBarBuilderTestDom();
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(375);
    document.head.innerHTML = '<meta property="og:site_name" content="fintravel.fi"><link rel="icon" href="/frontend/icons/site_favicons/site-fintravel-ft-v1-16.png">';
    document.getElementById('navbar').classList.add('collapsed');
});
afterEach(() => { cleanupFilterBarBuilderTestDom(); vi.restoreAllMocks(); });

const LABELS = {
    fi: ['Näytä haku', 'Piilota haku'], en: ['Show search', 'Hide search'],
    'zh-CN': ['显示搜索', '隐藏搜索'], 'zh-TW': ['顯示搜尋', '隱藏搜尋'], 'zh-HK': ['顯示搜尋', '隱藏搜尋'],
};

test.each(Object.entries(LABELS))('phone search opens only by button, with focus and translated state in %s', async (language, labels) => {
    document.documentElement.lang = language;
    getLanguageWithBrowserFallback.mockReturnValue(language);
    const { create_filter_bar } = await import('./filter_bar_builder.js');
    const panel = create_filter_bar('demo', 'demo_uid', ['id'], { id: 'INTEGER' }, 1, false, 'card');
    const bar = document.querySelector('.dataset-shared-topbar');
    const menu = bar.querySelector('[data-testid="shared-topbar-menu-button"]');
    const filter = bar.querySelector('[data-testid="filterbar-toggle"]');
    const toggle = bar.querySelector('[data-testid="mobile-search-toggle"]');
    const identity = bar.querySelector('[data-testid="mobile-site-identity"]');
    const search = bar.querySelector('.dataset-search-panel');
    const input = document.createElement('input'); search.append(input);
    input.value = 'Helsinki';
    const submit = document.createElement('button'); search.append(submit);
    const onSubmit = vi.fn(); submit.addEventListener('click', onSubmit);
    expect(bar.hidden).toBe(false);
    expect(identity.textContent).toBe('Fintravel.fi');
    expect(identity.querySelector('img').src).toContain('site-fintravel');
    expect(identity.hidden).toBe(false); expect(search.hidden).toBe(true);
    expect(toggle.getAttribute('aria-label')).toBe(labels[0]);
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(toggle.getAttribute('aria-controls')).toBe(search.id);
    expect(menu.tabIndex).toBe(0); expect(filter.tabIndex).toBe(0);
    expect(toggle.nextElementSibling).toBe(filter);
    const parent = filter.parentElement;
    filter.click();
    expect(filter.parentElement).toBe(parent); expect(filter.tabIndex).toBe(0);
    document.querySelector('.scrollable_content').dispatchEvent(new Event('scroll'));
    expect(search.hidden).toBe(true); // Scroll must never open the phone search.
    toggle.click();
    expect(search.hidden).toBe(false); expect(identity.hidden).toBe(true);
    expect(identity.getAttribute('aria-hidden')).toBe('true');
    expect(document.activeElement).toBe(input);
    expect(toggle.getAttribute('aria-label')).toBe(labels[1]);
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(onSubmit).not.toHaveBeenCalled();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(search.hidden).toBe(true); expect(document.activeElement).toBe(toggle);
    expect(identity.hidden).toBe(false); expect(identity.getAttribute('aria-hidden')).toBe('false');
    expect(input.value).toBe('Helsinki'); expect(toggle.getAttribute('aria-pressed')).toBe('false');
    toggle.click(); toggle.click();
    expect(search.hidden).toBe(true); expect(document.activeElement).toBe(toggle);
    expect(onSubmit).not.toHaveBeenCalled(); expect(input.value).toBe('Helsinki');
    expect(bar.querySelector('[data-testid="filterbar-toggle"]')).toBe(filter);
    expect(bar.querySelector('[data-testid="shared-topbar-menu-button"]')).toBe(menu);
    panel.destroy(); expect(bar.isConnected).toBe(false);
});

test('desktop restores its search and returning to phone closes it; deactivation removes input focus', async () => {
    const { create_filter_bar } = await import('./filter_bar_builder.js');
    const panel = create_filter_bar('demo', 'demo_uid', [], {}, 1, false, 'card');
    const bar = document.querySelector('.dataset-shared-topbar');
    const toggle = bar.querySelector('[data-testid="mobile-search-toggle"]');
    const search = bar.querySelector('.dataset-search-panel');
    const input = document.createElement('input'); search.append(input);
    toggle.click(); expect(document.activeElement).toBe(input);
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(768);
    panel.__syncSharedTopBar();
    expect(toggle.hidden).toBe(true); expect(search.hidden).toBe(false);
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(375);
    panel.__syncSharedTopBar(); expect(search.hidden).toBe(true);
    toggle.click();
    const { isSharedTopBarHostActive } = await import('./shared_topbar_builder.js');
    isSharedTopBarHostActive.mockReturnValue(false);
    panel.__syncSharedTopBar();
    expect(search.hidden).toBe(true); expect(document.activeElement).not.toBe(input);
    expect(toggle.tabIndex).toBe(-1);
    isSharedTopBarHostActive.mockReturnValue(true);
});

test('changing language while search is open keeps the draft, focus and pressed state', async () => {
    getLanguageWithBrowserFallback.mockReturnValue('fi');
    const { create_filter_bar } = await import('./filter_bar_builder.js');
    create_filter_bar('demo', 'demo_uid', [], {}, 1, false, 'card');
    const bar = document.querySelector('.dataset-shared-topbar');
    const toggle = bar.querySelector('[data-testid="mobile-search-toggle"]');
    const input = document.createElement('input'); input.value = 'Helsinki';
    bar.querySelector('.dataset-search-panel').append(input);
    toggle.click();
    getLanguageWithBrowserFallback.mockReturnValue('zh-TW');
    document.documentElement.lang = 'zh-TW';
    await Promise.resolve();
    expect(toggle.getAttribute('aria-label')).toBe('隱藏搜尋');
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(document.activeElement).toBe(input); expect(input.value).toBe('Helsinki');
});

test('a phone article uses the translated dataset name; a dataset view keeps the site name', async () => {
    const { setChosenDatasetView } = await import('../state_stores/dataset_view_choice_saver.js');
    const { create_filter_bar } = await import('./filter_bar_builder.js');
    setChosenDatasetView('demo', 'article_view');
    const panel = create_filter_bar('demo', 'demo_uid', [], {}, 1, false, 'article_view');
    const bar = document.querySelector('.dataset-shared-topbar');
    const title = bar.querySelector('.dataset-shared-topbar__dataset-title');
    const identity = bar.querySelector('[data-testid="mobile-site-identity"]');
    expect(identity.textContent).toBe('Demo');
    title.textContent = 'Helsingin vanhat kartat';
    await Promise.resolve();
    expect(identity.textContent).toBe('Helsingin vanhat kartat');
    expect(identity.querySelector('span').title).toBe('Helsingin vanhat kartat');
    const inner = bar.querySelector('.dataset-shared-topbar__inner');
    const menu = bar.querySelector('[data-testid="shared-topbar-menu-button"]');
    const toggle = bar.querySelector('[data-testid="mobile-search-toggle"]');
    const filter = bar.querySelector('[data-testid="filterbar-toggle"]');
    for (const open of [false, true]) {
        if (open) toggle.click();
        const center = inner.children[1];
        expect([...inner.children].map(node => node.className)).toEqual([
            'dataset-shared-topbar__slot dataset-shared-topbar__slot--start',
            'dataset-shared-topbar__center',
            'dataset-shared-topbar__slot dataset-shared-topbar__slot--end dataset-corner-controls-topbar-end',
        ]);
        expect(inner.firstElementChild.contains(menu)).toBe(true);
        expect(identity.hidden).toBe(open);
        expect(center.querySelector('.dataset-search-panel').hidden).toBe(!open);
        expect(toggle.nextElementSibling).toBe(filter);
    }
    setChosenDatasetView('demo', 'card'); panel.__syncSharedTopBar();
    expect(identity.textContent).toBe('Fintravel.fi');
});
