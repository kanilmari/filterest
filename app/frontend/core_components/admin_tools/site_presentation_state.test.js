// @vitest-environment jsdom
// Exercises durable public settings, cross-consumer races and the pre-stylesheet cache reader.
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import {
    DEFAULT_DATASET_COVER_THEME, PUBLIC_PRESENTATION_CACHE_KEY, brandColorComponents,
    createSitePresentationState, resetSitePresentationStatesForTests, isValidThemeConfig, normalizePresentationSettings,
} from './site_presentation_state.js';
import { mountDatasetCoverTestPalette } from './dataset_cover_test_palette.js';

const clone = (v) => JSON.parse(JSON.stringify(v));
const settings = (brand = '#e61aad') => ({
    dataset_cover_theme: { ...clone(DEFAULT_DATASET_COVER_THEME),
        shared: { ...DEFAULT_DATASET_COVER_THEME.shared, brand_color: brand } },
    row_article_timestamp_display_mode: 'date_only',
});
const deferred = () => {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
};
const hue = () => document.documentElement.style.getPropertyValue('--brand-hue');
const bootstrap = readFileSync('frontend/public/site_presentation_bootstrap.js', 'utf8');
const boot = () => window.eval(bootstrap);
const putCache = (snapshot) => localStorage.setItem(PUBLIC_PRESENTATION_CACHE_KEY, JSON.stringify({
    schema_version: 1, settings: snapshot, brand: brandColorComponents(snapshot.dataset_cover_theme.shared.brand_color),
}));

beforeEach(() => {
    localStorage.clear();
    document.body.replaceChildren();
    document.documentElement.removeAttribute('style');
    document.documentElement.removeAttribute('lang');
    resetSitePresentationStatesForTests();
});

describe('public presentation state', () => {
    test('defaults old column counts to two and separates preview from saved settings', async () => {
        const old = settings(); delete old.dataset_cover_theme.shared.card_detail_columns;
        old.dataset_cover_theme.shared.card_show_all_fields = false;
        expect(normalizePresentationSettings(old).dataset_cover_theme.shared.card_detail_columns).toBe(2);
        expect(normalizePresentationSettings(old).dataset_cover_theme.shared.card_show_all_fields).toBe(false);
        putCache(old);
        const stored = settings(); stored.dataset_cover_theme.shared.card_detail_columns = 3;
        const state = createSitePresentationState({ requestFn: async () => stored });
        expect(document.documentElement.dataset.cardDetailColumns).toBe('2');
        await state.loadSettings();
        expect(document.documentElement.dataset.cardDetailColumns).toBe('3');
        const owner = {}, preview = state.savedSettings(); preview.dataset_cover_theme.shared.card_detail_columns = 4;
        state.setPreview(owner, preview);
        expect(document.documentElement.dataset.cardDetailColumns).toBe('4');
        expect(JSON.parse(localStorage.getItem(PUBLIC_PRESENTATION_CACHE_KEY)).settings.dataset_cover_theme.shared.card_detail_columns).toBe(3);
        state.releasePreview(owner);
        expect(document.documentElement.dataset.cardDetailColumns).toBe('3');
    });
    test.each([null, '3', false, {}, 0, 5, 2.5])('rejects invalid detail columns %j', value => {
        const input = settings(); input.dataset_cover_theme.shared.card_detail_columns = value;
        expect(isValidThemeConfig(input.dataset_cover_theme)).toBe(false);
    });
    test('defaults legacy styles to modern and restores the saved style after preview', async () => {
        const old = settings(); delete old.dataset_cover_theme.shared.card_style_variant;
        putCache(old);
        const stored = settings(); stored.dataset_cover_theme.shared.card_style_variant = 'standard';
        const state = createSitePresentationState({ requestFn: async () => stored });
        expect(state.savedSettings().dataset_cover_theme.shared.card_style_variant).toBe('modern');
        expect(document.documentElement.dataset.cardStyleVariant).toBe('modern');
        await state.loadSettings();
        expect(document.documentElement.dataset.cardStyleVariant).toBe('standard');
        const owner = {}, preview = state.savedSettings(); preview.dataset_cover_theme.shared.card_style_variant = 'modern';
        state.setPreview(owner, preview);
        expect(document.documentElement.dataset.cardStyleVariant).toBe('modern');
        expect(JSON.parse(localStorage.getItem(PUBLIC_PRESENTATION_CACHE_KEY)).settings.dataset_cover_theme.shared.card_style_variant).toBe('standard');
        state.releasePreview(owner);
        expect(document.documentElement.dataset.cardStyleVariant).toBe('standard');
    });
    test.each([null, true, 0, {}, 'unknown'])('rejects an invalid site card style %j', value => {
        const input = settings(); input.dataset_cover_theme.shared.card_style_variant = value;
        expect(isValidThemeConfig(input.dataset_cover_theme)).toBe(false);
    });
    test('defaults old cached card fields to true and keeps explicit false through load, preview and restore', async () => {
        const old = settings(); delete old.dataset_cover_theme.shared.card_show_all_fields;
        putCache(old);
        const stored = settings(); stored.dataset_cover_theme.shared.card_show_all_fields = false;
        const state = createSitePresentationState({ requestFn: async () => stored });
        expect(state.savedSettings().dataset_cover_theme.shared.card_show_all_fields).toBe(true);
        await state.loadSettings();
        expect(document.documentElement.dataset.cardShowAllFields).toBe('false');
        const owner={}; const preview=state.savedSettings(); preview.dataset_cover_theme.shared.card_show_all_fields=true;
        state.setPreview(owner,preview);
        expect(document.documentElement.dataset.cardShowAllFields).toBe('true');
        expect(JSON.parse(localStorage.getItem(PUBLIC_PRESENTATION_CACHE_KEY)).settings.dataset_cover_theme.shared.card_show_all_fields).toBe(false);
        state.releasePreview(owner);
        expect(document.documentElement.dataset.cardShowAllFields).toBe('false');
        expect(normalizePresentationSettings(old).dataset_cover_theme.shared.card_show_all_fields).toBe(true);
    });

    test.each([null, 'false', 0, {}])('rejects invalid card field boolean %j', (value) => {
        const input=settings(); input.dataset_cover_theme.shared.card_show_all_fields=value;
        expect(isValidThemeConfig(input.dataset_cover_theme)).toBe(false);
    });

    test('deduplicates simultaneous consumers and retains a validated successful snapshot', async () => {
        const pending = deferred();
        const requestFn = vi.fn(() => pending.promise);
        const state = createSitePresentationState({ requestFn });
        const first = state.loadSettings(), second = state.loadSettings();
        await Promise.resolve();
        expect(requestFn).toHaveBeenCalledTimes(1);
        pending.resolve(settings());
        expect(await first).toEqual(await second);
        await state.loadSettings();
        expect(requestFn).toHaveBeenCalledTimes(1);
        expect(JSON.parse(localStorage.getItem(PUBLIC_PRESENTATION_CACHE_KEY)).settings).toEqual(settings());
    });

    test('uses the known snapshot on a failed revalidation without persisting defaults', async () => {
        putCache(settings());
        const original = localStorage.getItem(PUBLIC_PRESENTATION_CACHE_KEY);
        const state = createSitePresentationState({ requestFn: vi.fn().mockRejectedValue(new Error('offline')) });
        expect(await state.loadSettings()).toEqual(settings());
        state.paint();
        expect(hue()).toBe('316.76');
        expect(localStorage.getItem(PUBLIC_PRESENTATION_CACHE_KEY)).toBe(original);
    });

    test('rejects invalid API settings and retries after failure without writing a default cache', async () => {
        const requestFn = vi.fn().mockResolvedValueOnce({ dataset_cover_theme: {} }).mockResolvedValueOnce(settings());
        const state = createSitePresentationState({ requestFn });
        await state.loadSettings();
        expect(localStorage.getItem(PUBLIC_PRESENTATION_CACHE_KEY)).toBeNull();
        await state.loadSettings();
        expect(state.savedSettings()).toEqual(settings());
        expect(requestFn).toHaveBeenCalledTimes(2);
    });

    test('an older GET cannot replace a successful save or its cached brand', async () => {
        const get = deferred();
        const state = createSitePresentationState({ requestFn: () => get.promise });
        const oldGet = state.loadSettings();
        await state.saveSettings(settings(), async (payload) => payload);
        get.resolve(settings('#1a8fe6'));
        await oldGet;
        state.paint();
        expect(state.savedSettings()).toEqual(settings());
        expect(hue()).toBe('316.76');
        expect(JSON.parse(localStorage.getItem(PUBLIC_PRESENTATION_CACHE_KEY)).settings).toEqual(settings());
    });

    test('serializes saves so a slower previous response cannot overtake a later user save', async () => {
        const first = deferred();
        const saveFn = vi.fn().mockImplementationOnce(() => first.promise).mockImplementationOnce(async (payload) => payload);
        const state = createSitePresentationState();
        const a = state.saveSettings(settings('#cc3366'), saveFn);
        const b = state.saveSettings(settings(), saveFn);
        await Promise.resolve();
        expect(saveFn).toHaveBeenCalledTimes(1);
        first.resolve(settings('#cc3366'));
        await a; await b;
        expect(saveFn).toHaveBeenCalledTimes(2);
        expect(state.savedSettings()).toEqual(settings());
        expect(hue()).toBe('316.76');
    });

    test('preview and failure never replace durable cache; only the owner can cancel', async () => {
        putCache(settings());
        const original = localStorage.getItem(PUBLIC_PRESENTATION_CACHE_KEY);
        const state = createSitePresentationState();
        const a = {}, b = {};
        state.setPreview(a, settings('#cc3366'));
        state.setPreview(b, settings('#6699cc'));
        expect(state.releasePreview(a)).toBe(false);
        expect(hue()).toBe('210');
        await expect(state.saveSettings(settings('#6699cc'), async () => { throw Error('offline'); })).rejects.toThrow();
        expect(localStorage.getItem(PUBLIC_PRESENTATION_CACHE_KEY)).toBe(original);
        state.releasePreview(b);
        expect(hue()).toBe('316.76');
    });

    test('caches only known public fields', async () => {
        const payload = settings();
        payload.private_flags = { admin: true };
        payload.dataset_cover_theme.secret = 'never-cache';
        payload.dataset_cover_theme.shared.extra = 'never-cache';
        const state = createSitePresentationState({ requestFn: async () => payload });
        await state.loadSettings();
        expect(state.savedSettings()).toEqual(settings());
        expect(localStorage.getItem(PUBLIC_PRESENTATION_CACHE_KEY)).not.toContain('never-cache');
        expect(localStorage.getItem(PUBLIC_PRESENTATION_CACHE_KEY)).not.toContain('private_flags');
    });

    test('does not expose internal saved objects for draft mutation', async () => {
        const state = createSitePresentationState({ requestFn: async () => settings() });
        const snapshot = await state.loadSettings();
        snapshot.dataset_cover_theme.shared.brand_color = '#000000';
        expect(state.savedSettings()).toEqual(settings());
    });

    test('keeps an already bootstrapped hue when full snapshot validation or GET fails', async () => {
        localStorage.setItem(PUBLIC_PRESENTATION_CACHE_KEY, JSON.stringify({
            schema_version: 1, settings: {}, brand: { hue: 316.76, saturation: 80.31, lightness: 50.2 },
        }));
        boot();
        const state = createSitePresentationState({ requestFn: async () => { throw Error('offline'); } });
        await state.loadSettings();
        state.paint();
        expect(hue()).toBe('316.76');
    });

    test('storage denied does not prevent a valid response or its live paint', async () => {
        const storage = { getItem() { throw Error('denied'); }, setItem() { throw Error('denied'); } };
        const state = createSitePresentationState({ requestFn: async () => settings(), storage });
        await state.loadSettings();
        state.paint();
        expect(hue()).toBe('316.76');
    });
});

describe('early public-brand paint', () => {
    test('runs a blocking cache reader before the stylesheet, without modules or inline injection', () => {
        const html = readFileSync('frontend/index.html', 'utf8');
        const script = '<script src="/frontend/public/site_presentation_bootstrap.js"></script>';
        expect(html.indexOf(script)).toBeGreaterThan(0);
        expect(html.indexOf(script)).toBeLessThan(html.indexOf('<link rel="stylesheet"'));
        putCache(settings());
        boot();
        expect(hue()).toBe('316.76');
        expect(document.documentElement.style.getPropertyValue('--brand-sat')).toBe('80.31%');
    });

    test.each([
        'invalid-json',
        JSON.stringify({ schema_version: 2, brand: { hue: 3, saturation: 3, lightness: 3 } }),
        JSON.stringify({ schema_version: 1, brand: { hue: '3; color:red', saturation: 3, lightness: 3 } }),
        JSON.stringify({ schema_version: 1, brand: { hue: 361, saturation: 3, lightness: 3 } }),
    ])('ignores an unsafe or unsupported cache: %s', (value) => {
        localStorage.setItem(PUBLIC_PRESENTATION_CACHE_KEY, value);
        boot();
        expect(hue()).toBe('');
    });
});

describe('palette lifecycle', () => {
    const hero = () => document.body.appendChild(document.createElement('section'));
    const options = (settingsRequestFn) => ({
        settingsRequestFn, requestFn: async () => ({ view_admin_cover_image_test_palette: true }),
        saveRequestFn: async (payload) => payload, permissionCheck: () => true,
    });
    const inputBrand = (control, color) => {
        const input = control.panel.querySelector('[data-testid="dataset-cover-test-palette-brand-color"]');
        input.value = color;
        input.dispatchEvent(new Event('input', { bubbles: true }));
    };
    test('destroyed mount after delayed GET never paints globals or attaches controls', async () => {
        putCache(settings());
        boot();
        const get = deferred();
        let alive = true;
        const node = hero();
        const pending = mountDatasetCoverTestPalette(node, 'demo', {
            ...options(() => get.promise), canCommit: () => alive,
        });
        alive = false;
        get.resolve(settings('#1a8fe6'));
        expect(await pending).toBeNull();
        expect(hue()).toBe('316.76');
        expect(node.style.length).toBe(0);
        expect(document.querySelector('[data-testid="dataset-cover-test-palette"]')).toBeNull();
    });

    test('destroying the old palette cannot reset a newer preview; reset uses latest saved values', async () => {
        const opts = options(async () => settings());
        const a = await mountDatasetCoverTestPalette(hero(), 'a', opts);
        const b = await mountDatasetCoverTestPalette(hero(), 'b', opts);
        inputBrand(a, '#cc3366');
        inputBrand(b, '#6699cc');
        a.resetPreview();
        expect(hue()).toBe('210');
        a.destroy();
        expect(hue()).toBe('210');
        b.panel.querySelector('[data-testid="dataset-cover-test-palette-save"]').click();
        await vi.waitFor(() => expect(document.querySelector('[data-testid="toast"] .toast-notification-content').textContent).toMatch(/saved/i));
        const c = await mountDatasetCoverTestPalette(hero(), 'c', opts);
        expect(hue()).toBe('210');
        expect(c.panel.querySelector('[data-testid="dataset-cover-test-palette-brand-color"]').value).toBe('#6699cc');
        c.destroy();
        inputBrand(b, '#000000');
        b.resetPreview();
        expect(hue()).toBe('210');
        b.destroy();
        expect(hue()).toBe('210');
    });

    test('keeps a newer focused draft while the previous save completes', async () => {
        const pending = deferred();
        const control = await mountDatasetCoverTestPalette(hero(), 'demo', {
            ...options(async () => settings()), saveRequestFn: () => pending.promise,
        });
        inputBrand(control, '#cc3366');
        control.panel.querySelector('[data-testid="dataset-cover-test-palette-save"]').click();
        inputBrand(control, '#6699cc');
        control.button.click();
        const focusedInput = control.panel.querySelector('[data-testid="dataset-cover-test-palette-brand-color"]');
        focusedInput.closest('details').open = true;
        focusedInput.focus();
        expect(document.activeElement).toBe(focusedInput);
        pending.resolve(settings('#cc3366'));
        await vi.waitFor(() => expect(document.querySelector('[data-testid="toast"] .toast-notification-content').textContent).toMatch(/saved/i));
        expect(hue()).toBe('210');
        expect(document.activeElement).toBe(focusedInput);
        control.resetPreview();
        expect(hue()).toBe('340');
        control.destroy();
    });
});
