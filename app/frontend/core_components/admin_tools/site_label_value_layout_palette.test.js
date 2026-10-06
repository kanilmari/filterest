// site_label_value_layout_palette.test.js
// Verifies the site selector's language keys, development-only option and preview/save/reset.
// Connects the real palette owner and shared state with connected card and article pairs.
// Ensures saved wrapping survives remounts and failed saves never claim success.
// @vitest-environment jsdom

import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mountDatasetCoverTestPalette } from './dataset_cover_test_palette.js';
import { DEFAULT_DATASET_COVER_THEME, resetSitePresentationStatesForTests } from './site_presentation_state.js';
import { applyLabelValueLayout } from '../../reusable_components/key_value_container/label_value_layout.js';

beforeEach(() => {
    document.body.replaceChildren(); document.head.replaceChildren();
    document.documentElement.lang = 'fi'; localStorage.clear(); resetSitePresentationStatesForTests();
});
afterEach(() => { document.head.replaceChildren(); vi.restoreAllMocks(); });

async function mountWrappingPalette(overrides = {}) {
    const settings = { dataset_cover_theme: JSON.parse(JSON.stringify(DEFAULT_DATASET_COVER_THEME)), row_article_timestamp_display_mode: 'date_time' };
    const hero = document.createElement('section'); document.body.append(hero);
    const options = {
        settingsRequestFn: vi.fn(async () => settings), saveRequestFn: vi.fn(async request => request),
        requestFn: vi.fn(async () => ({ view_admin_cover_image_test_palette: true })),
        permissionCheck: route => route === '/ui/admin/dataset_header_config', ...overrides,
    };
    const mounted = await mountDatasetCoverTestPalette(hero, 'demo', options);
    const select = mounted.panel.querySelector('[data-testid="dataset-cover-test-palette-label-value-layout"]');
    const button = name => mounted.panel.querySelector('[data-testid="dataset-cover-test-palette-' + name + '"]');
    return { mounted, select, button, options };
}

test.each(['dev', 'prod', 'test', ''])('offers Automatic only in development, environment=%s', async environment => {
    document.head.innerHTML = '<meta name="app-env" content="' + environment + '">';
    const { mounted, select } = await mountWrappingPalette();
    expect([...select.options].map(option => option.value)).toEqual(environment === 'dev' ? ['stacked', 'inline', 'auto'] : ['stacked', 'inline']);
    expect(select.closest('[data-testid="site-card-palette-settings"]')).not.toBeNull();
    expect(select.value).toBe('stacked');
    expect([...select.options].slice(0, 2).map(option => option.textContent)).toEqual(['Allekkain', 'Rinnakkain']);
    document.documentElement.lang = 'en';
    await vi.waitFor(() => expect(select.getAttribute('aria-label')).toBe('Field label and value layout'));
    expect([...select.options].slice(0, 2).map(option => option.textContent)).toEqual(['Stacked', 'Side by side']);
    mounted.destroy();
});

test.each(['stacked', 'inline', 'auto'])('previews, saves, resets and restores the saved %s choice on remount', async choice => {
    document.head.innerHTML = '<meta name="app-env" content="dev">';
    const pair = document.createElement('div'); pair.innerHTML = '<span>Osoite</span><span>Visible value</span>';
    applyLabelValueLayout(pair, pair.firstChild, pair.lastChild); document.body.append(pair);
    const nodes = [...pair.children];
    const { mounted, select, button, options } = await mountWrappingPalette();
    select.value = choice; select.dispatchEvent(new Event('change'));
    expect(pair.dataset.labelValueLayout).toBe(choice);
    expect(options.saveRequestFn).not.toHaveBeenCalled();
    button('tab-dark').click(); expect(select.value).toBe(choice);
    button('card-style').value = 'standard'; button('card-style').dispatchEvent(new Event('change'));
    expect(pair.dataset.labelValueLayout).toBe(choice);
    button('reset').click(); expect(select.value).toBe('stacked'); expect(pair.dataset.labelValueLayout).toBe('stacked');
    select.value = choice; select.dispatchEvent(new Event('change')); button('save').click();
    await vi.waitFor(() => expect(button('save').disabled).toBe(false));
    expect(options.saveRequestFn.mock.calls[0][0].dataset_cover_theme.shared.label_value_layout).toBe(choice);
    select.value = 'stacked'; select.dispatchEvent(new Event('change')); mounted.destroy();
    expect(pair.dataset.labelValueLayout).toBe(choice); expect([...pair.children]).toEqual(nodes);
    const again = await mountWrappingPalette({ settingsRequestFn: options.settingsRequestFn });
    expect(again.select.value).toBe(choice);
    again.mounted.destroy();
});

test('a failed save keeps the wrapping preview and reset returns to the saved default', async () => {
    const { mounted, select, button } = await mountWrappingPalette({ saveRequestFn: vi.fn(async () => { throw new Error('unavailable'); }) });
    select.value = 'inline'; select.dispatchEvent(new Event('change')); button('save').click();
    await vi.waitFor(() => expect(button('save').disabled).toBe(false));
    expect(document.querySelector('[data-testid="toast"]').dataset.toastLevel).toBe('error');
    expect(document.documentElement.dataset.labelValueLayout).toBe('inline');
    button('reset').click(); expect(select.value).toBe('stacked');
    expect(document.documentElement.dataset.labelValueLayout).toBe('stacked');
    mounted.destroy();
});
