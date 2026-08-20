// @vitest-environment jsdom
// Locks public cover settings plus the administrator light/dark editor contract.

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
    DEFAULT_DATASET_COVER_THEME,
    applyDatasetCoverThemeConfig,
    mountDatasetCoverTestPalette,
} from './dataset_cover_test_palette.js';

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function createSettings() {
    return {
        dataset_cover_theme: clone(DEFAULT_DATASET_COVER_THEME),
        row_article_timestamp_display_mode: 'date_only',
    };
}

function createCoverHero() {
    const hero = document.createElement('section');
    hero.classList.add('filterbar-inline-hero', 'filterbar-inline-hero--has-cover');
    document.body.appendChild(hero);
    return hero;
}

function createMountOptions(overrides = {}) {
    return {
        requestFn: vi.fn(async () => ({ view_admin_cover_image_test_palette: true })),
        settingsRequestFn: vi.fn(async () => createSettings()),
        saveRequestFn: vi.fn(async (request) => request),
        permissionCheck: () => true,
        ...overrides,
    };
}

describe('dataset cover presentation settings', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        history.replaceState({}, '', '/demo?view=card');
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    test('applies persisted light, dark, and shared values to every public cover hero', async () => {
        const hero = createCoverHero();
        const settings = createSettings();
        settings.dataset_cover_theme.light.oval_width = 36;
        settings.dataset_cover_theme.dark.image_opacity = 0.35;
        settings.dataset_cover_theme.shared.image_blur = 2;
        const flagRequest = vi.fn();

        await expect(mountDatasetCoverTestPalette(hero, 'demo', createMountOptions({
            requestFn: flagRequest,
            settingsRequestFn: vi.fn(async () => settings),
            permissionCheck: () => false,
        }))).resolves.toBeNull();

        expect(flagRequest).not.toHaveBeenCalled();
        expect(hero.style.getPropertyValue('--dataset-cover-light-mask-oval-x')).toBe('36%');
        expect(hero.style.getPropertyValue('--dataset-cover-light-mask-image')).toBe('initial');
        expect(hero.style.getPropertyValue('--dataset-cover-dark-mask-image')).toBe('none');
        expect(hero.style.getPropertyValue('--dataset-cover-dark-image-opacity')).toBe('0.35');
        expect(hero.style.getPropertyValue('--dataset-cover-image-blur')).toBe('2px');
        expect(hero.querySelector('[data-testid="dataset-cover-test-palette-button"]')).toBeNull();
    });

    test('falls back to approved source defaults if the public settings read fails', async () => {
        const hero = createCoverHero();
        await mountDatasetCoverTestPalette(hero, 'demo', createMountOptions({
            settingsRequestFn: vi.fn(async () => { throw new Error('unavailable'); }),
            permissionCheck: () => false,
        }));

        expect(hero.style.getPropertyValue('--dataset-cover-light-mask-oval-x')).toBe('32%');
        expect(hero.style.getPropertyValue('--dataset-cover-light-mask-position-y')).toBe('56%');
        expect(hero.style.getPropertyValue('--dataset-cover-dark-image-opacity')).toBe('0.3');
        expect(hero.style.getPropertyValue('--dataset-cover-hero-extra-height')).toBe('40px');
        expect(hero.style.getPropertyValue('--dataset-cover-image-blur')).toBe('1px');
    });

    test('keeps the palette admin-only and fails closed when its protected flag is absent', async () => {
        const hero = createCoverHero();
        await expect(mountDatasetCoverTestPalette(hero, 'demo', createMountOptions({
            requestFn: vi.fn(async () => ({ view_admin_cover_image_test_palette: false })),
        }))).resolves.toBeNull();
        await expect(mountDatasetCoverTestPalette(hero, 'demo', createMountOptions({
            requestFn: vi.fn(async () => { throw new Error('unavailable'); }),
        }))).resolves.toBeNull();
        expect(hero.querySelector('[data-testid="dataset-cover-test-palette-button"]')).toBeNull();
    });

    test('separates theme controls from shared controls and saves both themes atomically', async () => {
        const hero = createCoverHero();
        const saveRequestFn = vi.fn(async (request) => request);
        const control = await mountDatasetCoverTestPalette(
            hero,
            'demo',
            createMountOptions({ saveRequestFn })
        );
        control.button.click();
        const { panel } = control;

        expect(panel.querySelectorAll(
            '[data-testid="dataset-cover-test-palette-theme-controls"] input[type="range"]'
        )).toHaveLength(11);
        expect(panel.querySelectorAll(
            '[data-testid="dataset-cover-test-palette-shared-controls"] input[type="range"]'
        )).toHaveLength(2);
        expect(panel.querySelector('[data-testid="dataset-cover-test-palette-mask-enabled"]')
            .closest('.dataset-cover-test-palette__group')).not.toBeNull();

        panel.querySelector('[data-testid="dataset-cover-test-palette-tab-dark"]').click();
        expect(panel.querySelector('[data-testid="dataset-cover-test-palette-image-opacity"]').value)
            .toBe('0.3');
        const darkOpacity = panel.querySelector(
            '[data-testid="dataset-cover-test-palette-image-opacity"]'
        );
        darkOpacity.value = '0.5';
        darkOpacity.dispatchEvent(new Event('input', { bubbles: true }));
        expect(hero.style.getPropertyValue('--dataset-cover-dark-image-opacity')).toBe('0.5');
        expect(hero.style.getPropertyValue('--dataset-cover-light-image-opacity')).toBe('1');

        const blur = panel.querySelector('[data-testid="dataset-cover-test-palette-image-blur"]');
        blur.value = '3';
        blur.dispatchEvent(new Event('input', { bubbles: true }));
        expect(hero.style.getPropertyValue('--dataset-cover-image-blur')).toBe('3px');

        panel.querySelector('[data-testid="dataset-cover-test-palette-save"]').click();
        await vi.waitFor(() => expect(saveRequestFn).toHaveBeenCalledOnce());
        const payload = saveRequestFn.mock.calls[0][0];
        expect(payload.row_article_timestamp_display_mode).toBe('date_only');
        expect(payload.dataset_cover_theme.light.image_opacity).toBe(1);
        expect(payload.dataset_cover_theme.dark.image_opacity).toBe(0.5);
        expect(payload.dataset_cover_theme.shared.image_blur).toBe(3);
        await vi.waitFor(() => expect(panel.querySelector(
            '[data-testid="dataset-cover-test-palette-status"]'
        ).textContent).toMatch(/saved|tallennettu/i));

        darkOpacity.value = '0.8';
        darkOpacity.dispatchEvent(new Event('input', { bubbles: true }));
        panel.querySelector('[data-testid="dataset-cover-test-palette-reset"]').click();
        expect(darkOpacity.value).toBe('0.5');
        expect(hero.style.getPropertyValue('--dataset-cover-dark-image-opacity')).toBe('0.5');
        control.destroy();
    });

    test('keeps an unsuccessful save visible and leaves the current preview intact', async () => {
        const hero = createCoverHero();
        const control = await mountDatasetCoverTestPalette(hero, 'demo', createMountOptions({
            saveRequestFn: vi.fn(async () => { throw new Error('save failed'); }),
        }));
        control.button.click();
        const opacity = control.panel.querySelector(
            '[data-testid="dataset-cover-test-palette-image-opacity"]'
        );
        opacity.value = '0.8';
        opacity.dispatchEvent(new Event('input', { bubbles: true }));
        control.panel.querySelector('[data-testid="dataset-cover-test-palette-save"]').click();

        await vi.waitFor(() => expect(control.panel.querySelector(
            '[data-testid="dataset-cover-test-palette-status"]'
        ).textContent).toMatch(/failed|epäonnistui/i));
        expect(hero.style.getPropertyValue('--dataset-cover-light-image-opacity')).toBe('0.8');
        control.destroy();
    });

    test('closes with Escape, outside pointer, or close button and remains draggable', async () => {
        const hero = createCoverHero();
        const control = await mountDatasetCoverTestPalette(hero, 'demo', createMountOptions());
        control.button.click();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        expect(control.panel.hidden).toBe(true);

        control.button.click();
        document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
        expect(control.panel.hidden).toBe(true);

        control.button.click();
        control.panel.querySelector('[data-testid="dataset-cover-test-palette-close"]').click();
        expect(control.panel.hidden).toBe(true);

        expect(applyDatasetCoverThemeConfig(hero, createSettings().dataset_cover_theme)).toBe(true);
        control.destroy();
    });
});
