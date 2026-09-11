// @vitest-environment jsdom
// dataset_cover_test_palette.test.js
// Verifies public appearance settings and the protected light/dark palette editor.
// Connects optional cover images, shared card controls and persisted site settings.
// Preserves authorization while datasets without images gain the same editor.

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
        document.documentElement.removeAttribute('lang');
        history.replaceState({}, '', '/demo?view=card');
    });

    afterEach(() => {
        document.documentElement.removeAttribute('style');
        document.documentElement.removeAttribute('lang');
        vi.restoreAllMocks();
    });

    test('applies persisted light, dark, and shared values to every public cover hero', async () => {
        const hero = createCoverHero();
        const settings = createSettings();
        settings.dataset_cover_theme.light.oval_width = 36;
        settings.dataset_cover_theme.dark.image_opacity = 0.35;
        settings.dataset_cover_theme.light.image_blur = 2;
        settings.dataset_cover_theme.dark.image_blur = 0;
        settings.dataset_cover_theme.shared.card_image_width = 360;
        settings.dataset_cover_theme.shared.card_description_lines = 4;
        settings.dataset_cover_theme.shared.active_tab_fade = 32;
        settings.dataset_cover_theme.shared.active_tab_max_opacity = 0.85;
        settings.dataset_cover_theme.shared.active_tab_glow_intensity = 0.2;
        settings.dataset_cover_theme.shared.active_tab_glow_width = 1;
        settings.dataset_cover_theme.shared.active_tab_glow_blur = 1.5;
        settings.dataset_cover_theme.shared.brand_color = '#cc3366';
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
        expect(hero.style.getPropertyValue('--dataset-cover-light-image-blur')).toBe('2px');
        expect(hero.style.getPropertyValue('--dataset-cover-dark-image-blur')).toBe('0px');
        expect(document.documentElement.style.getPropertyValue('--dataset-background-light-image-blur')).toBe('2px');
        expect(document.documentElement.style.getPropertyValue('--dataset-background-dark-image-blur')).toBe('0px');
        expect(document.documentElement.style.getPropertyValue('--card_image_large_width')).toBe('360px');
        expect(document.documentElement.style.getPropertyValue('--card-description-lines')).toBe('4');
        expect(document.documentElement.style.getPropertyValue('--navtab-active-fade-width')).toBe('32px');
        expect(document.documentElement.style.getPropertyValue('--navtab-active-max-opacity')).toBe('0.85');
        expect(document.documentElement.style.getPropertyValue('--navtab-active-glow-intensity')).toBe('0.2');
        expect(document.documentElement.style.getPropertyValue('--navtab-active-glow-width')).toBe('1px');
        expect(document.documentElement.style.getPropertyValue('--navtab-active-glow-blur')).toBe('1.5px');
        expect(document.documentElement.style.getPropertyValue('--brand-hue')).toBe('340');
        expect(document.documentElement.style.getPropertyValue('--brand-sat')).toBe('60%');
        expect(document.documentElement.style.getPropertyValue('--brand-light')).toBe('50%');
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
        expect(hero.style.getPropertyValue('--dataset-cover-light-image-blur')).toBe('1px');
        expect(hero.style.getPropertyValue('--dataset-cover-dark-image-blur')).toBe('1px');
    });

    test('opens shared appearance controls without a cover and preserves settings on save', async () => {
        const hero = document.createElement('section');
        hero.classList.add('filterbar-inline-hero');
        document.body.appendChild(hero);
        const settings = createSettings();
        settings.dataset_cover_theme.light.image_blur = 5;
        settings.dataset_cover_theme.dark.image_blur = 0;
        const options = createMountOptions({ settingsRequestFn: vi.fn(async () => settings) });
        const control = await mountDatasetCoverTestPalette(hero, 'demo', options);

        expect(document.documentElement.style.getPropertyValue('--dataset-background-light-image-blur')).toBe('5px');
        expect(document.documentElement.style.getPropertyValue('--dataset-background-dark-image-blur')).toBe('0px');
        expect(options.requestFn).toHaveBeenCalledOnce();
        expect(control).not.toBeNull();
        expect(hero.classList.contains('filterbar-inline-hero--has-cover')).toBe(false);
        control.button.click();
        expect(control.panel.hidden).toBe(false);
        const cardWidth = control.panel.querySelector('[data-testid="dataset-cover-test-palette-card-image-width"]');
        const cardLines = control.panel.querySelector('[data-testid="dataset-cover-test-palette-card-description-lines"]');
        const brandColor = control.panel.querySelector('input[type="color"]');
        expect(cardWidth).not.toBeNull();
        expect(cardLines).not.toBeNull();
        expect(brandColor.value).toBe(settings.dataset_cover_theme.shared.brand_color);
        cardWidth.value = '365';
        cardWidth.dispatchEvent(new Event('input', { bubbles: true }));
        control.panel.querySelector('[data-testid="dataset-cover-test-palette-save"]').click();
        await Promise.resolve();
        await Promise.resolve();
        const saved = options.saveRequestFn.mock.calls[0][0];
        expect(saved.dataset_cover_theme.shared.card_image_width).toBe(365);
        expect(saved.dataset_cover_theme.light.image_blur).toBe(5);
        expect(saved.dataset_cover_theme.dark.image_blur).toBe(0);
        expect(saved.row_article_timestamp_display_mode).toBe('date_only');
        expect(hero.classList.contains('filterbar-inline-hero--has-cover')).toBe(false);
        control.destroy();
    });

    test.each([true, false])('keeps permission and feature-flag guards with cover=%s', async (cover) => {
        const hero = createCoverHero();
        hero.classList.toggle('filterbar-inline-hero--has-cover', cover);
        const denied = createMountOptions({ permissionCheck: vi.fn(() => false) });
        await expect(mountDatasetCoverTestPalette(hero, 'demo', denied)).resolves.toBeNull();
        expect(denied.permissionCheck).toHaveBeenCalledWith('/ui/admin/dataset_header_config');
        expect(denied.requestFn).not.toHaveBeenCalled();
        for (const requestFn of [
            vi.fn(async () => ({})),
            vi.fn(async () => ({ view_admin_cover_image_test_palette: false })),
            vi.fn(async () => ({ view_admin_cover_image_test_palette: 'true' })),
            vi.fn(async () => { throw new Error('unavailable'); }),
        ]) {
            await expect(mountDatasetCoverTestPalette(hero, 'demo', createMountOptions({ requestFn }))).resolves.toBeNull();
        }
        expect(hero.querySelector('[data-testid="dataset-cover-test-palette-button"]')).toBeNull();
    });

    test.each([
        ['fi', 'Avaa ulkoasun paletti', 'Ulkoasun asetukset'],
        ['en', 'Open appearance palette', 'Appearance settings'],
    ])('names the shared controls in %s and avoids duplicate palettes', async (language, label, title) => {
        const priorLanguage = localStorage.getItem('chosen_language');
        localStorage.setItem('chosen_language', language);
        const hero = document.createElement('section');
        hero.className = 'filterbar-inline-hero';
        document.body.append(hero);
        const control = await mountDatasetCoverTestPalette(hero, 'demo', createMountOptions());
        expect(control.button.getAttribute('aria-label')).toBe(label);
        expect(control.panel.textContent).toContain(title);
        await expect(mountDatasetCoverTestPalette(hero, 'demo', createMountOptions())).resolves.toBeNull();
        expect(hero.querySelectorAll('[data-testid="dataset-cover-test-palette-button"]')).toHaveLength(1);
        control.destroy();
        if (priorLanguage === null) localStorage.removeItem('chosen_language');
        else localStorage.setItem('chosen_language', priorLanguage);
    });

    test('updates mounted copy with the document language without changing the open draft', async () => {
        localStorage.setItem('chosen_language', 'en');
        document.documentElement.lang = 'fi-FI';
        const hero = createCoverHero();
        const options = createMountOptions();
        const control = await mountDatasetCoverTestPalette(hero, 'demo', options);
        control.button.click();
        const { panel } = control;
        const field = (name) => panel.querySelector(`[data-testid="dataset-cover-test-palette-${name}"]`);
        expect(control.button.title).toBe('Avaa ulkoasun paletti');
        field('tab-dark').click();
        field('image-opacity').value = '0.65';
        field('image-opacity').dispatchEvent(new Event('input', { bubbles: true }));
        field('mask-enabled').checked = true;
        field('mask-enabled').dispatchEvent(new Event('change', { bubbles: true }));
        field('brand-color').value = '#00aa77';
        field('brand-color').dispatchEvent(new Event('input', { bubbles: true }));
        field('card-image-width').value = '425';
        field('card-image-width').dispatchEvent(new Event('input', { bubbles: true }));
        const toolboxes = [...panel.querySelectorAll('details')];
        toolboxes.forEach((toolbox, index) => { toolbox.open = index % 2 === 0; });
        panel.style.cssText = 'left: 42px; top: 73px; right: auto; width: 490px; height: 680px;';
        const geometry = panel.style.cssText;
        const heroStyle = hero.style.cssText;
        const rootStyle = document.documentElement.style.cssText;
        const controls = [...panel.querySelectorAll('input')];
        const values = controls.map((input) => [input.value, input.checked]);
        const expanded = toolboxes.map((toolbox) => toolbox.open);

        for (const [language, openLabel, opacityLabel, title] of [
            ['en', 'Open appearance palette', 'Whole image opacity', 'Appearance settings'],
            ['fi', 'Avaa ulkoasun paletti', 'Koko kuvan peittävyys', 'Ulkoasun asetukset'],
        ]) {
            document.documentElement.lang = language;
            await Promise.resolve();
            expect(control.button.title).toBe(openLabel);
            expect(control.button.getAttribute('aria-label')).toBe(openLabel);
            expect(panel.querySelector('strong').textContent).toBe(title);
            expect(field('image-opacity').getAttribute('aria-label')).toBe(opacityLabel);
            expect(field('image-opacity').parentElement.querySelector('span').textContent).toBe(opacityLabel);
            expect(field('close').title).toBe(language === 'fi' ? 'Sulje ulkoasun asetukset' : 'Close appearance settings');
            expect(field('close').getAttribute('aria-label')).toBe(field('close').title);
            expect(field('save').textContent).toBe(language === 'fi' ? 'Tallenna asetukset' : 'Save settings');
            expect(field('reset').textContent).toBe(language === 'fi' ? 'Palauta tallennetut arvot' : 'Reset to saved values');
            expect(panel.hidden).toBe(false);
            expect(control.button.getAttribute('aria-expanded')).toBe('true');
            expect(field('tab-dark').getAttribute('aria-selected')).toBe('true');
            expect([...panel.querySelectorAll('input')]).toEqual(controls);
            expect(controls.map((input) => [input.value, input.checked])).toEqual(values);
            expect(toolboxes.map((toolbox) => toolbox.open)).toEqual(expanded);
            expect(panel.style.cssText).toBe(geometry);
            expect(hero.style.cssText).toBe(heroStyle);
            expect(document.documentElement.style.cssText).toBe(rootStyle);
        }
        expect(panel.textContent).toContain('Aineistovälilehdet');
        expect(panel.textContent).toContain('Kansikuva ja häivytys');
        expect(panel.textContent).toContain('Liukuvärin keskustan kohta');
        expect(panel.textContent).toContain('Tummennuskerroksen peittävyys');
        expect(panel.textContent).toContain('Kansi- ja taustakuvan sumennus');
        expect(panel.textContent).not.toMatch(/opacity|stop-piste|overlay|blur|hero|dataset/i);
        expect(options.saveRequestFn).not.toHaveBeenCalled();
        expect(options.settingsRequestFn).toHaveBeenCalledOnce();
        expect(options.requestFn).toHaveBeenCalledOnce();
        control.destroy();
        localStorage.removeItem('chosen_language');
    });

    test.each([true, false])('keeps pending and completed save status translated, success=%s', async (succeeds) => {
        document.documentElement.lang = 'fi';
        let finishSave;
        let failSave;
        const options = createMountOptions({
            saveRequestFn: vi.fn(() => new Promise((resolve, reject) => {
                finishSave = resolve;
                failSave = reject;
            })),
        });
        const control = await mountDatasetCoverTestPalette(createCoverHero(), 'demo', options);
        control.button.click();
        const save = control.panel.querySelector('[data-testid="dataset-cover-test-palette-save"]');
        const status = control.panel.querySelector('[role="status"]');
        save.click();
        expect(status.textContent).toBe('Tallennetaan…');
        document.documentElement.lang = 'en';
        await Promise.resolve();
        expect(status.textContent).toBe('Saving…');
        expect(save.disabled).toBe(true);
        if (succeeds) finishSave(options.saveRequestFn.mock.calls[0][0]);
        else failSave(new Error('Save unavailable'));
        await vi.waitFor(() => expect(save.disabled).toBe(false));
        expect(status.textContent).toBe(succeeds ? 'Settings saved.' : 'Saving failed.');
        document.documentElement.lang = 'fi';
        await Promise.resolve();
        expect(status.textContent).toBe(succeeds ? 'Asetukset tallennettu.' : 'Tallennus epäonnistui.');
        expect(options.saveRequestFn).toHaveBeenCalledOnce();
        control.destroy();
    });

    test('disconnects language observation when the palette is destroyed', async () => {
        document.documentElement.lang = 'fi';
        const options = createMountOptions();
        const control = await mountDatasetCoverTestPalette(createCoverHero(), 'demo', options);
        const disconnect = vi.spyOn(MutationObserver.prototype, 'disconnect');
        const heading = control.panel.querySelector('strong');
        control.destroy();
        expect(disconnect).toHaveBeenCalledOnce();
        document.documentElement.lang = 'en';
        await Promise.resolve();
        expect(heading.textContent).toBe('Ulkoasun asetukset');
        expect(control.button.getAttribute('aria-label')).toBe('Avaa ulkoasun paletti');
        expect(control.panel.isConnected).toBe(false);
        expect(options.saveRequestFn).not.toHaveBeenCalled();
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
        )).toHaveLength(12);
        expect(panel.querySelectorAll(
            '[data-testid="dataset-cover-test-palette-shared-controls"] input[type="range"]'
        )).toHaveLength(9);
        const toolboxes = panel.querySelectorAll('details.dataset-cover-test-palette__group');
        expect(toolboxes).toHaveLength(6);
        expect(panel.querySelectorAll('.dataset-cover-test-palette__group-icon')).toHaveLength(6);
        expect(panel.querySelectorAll('.dataset-cover-test-palette__group-chevron')).toHaveLength(6);
        expect(toolboxes[0].open).toBe(true);
        expect(toolboxes[2].open).toBe(false);
        toolboxes[2].querySelector('summary').click();
        expect(toolboxes[2].open).toBe(true);
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
        expect(hero.style.getPropertyValue('--dataset-cover-dark-image-blur')).toBe('3px');
        expect(hero.style.getPropertyValue('--dataset-cover-light-image-blur')).toBe('1px');
        const cardWidth = panel.querySelector('[data-testid="dataset-cover-test-palette-card-image-width"]');
        cardWidth.value = '420';
        cardWidth.dispatchEvent(new Event('input', { bubbles: true }));
        const descriptionLines = panel.querySelector(
            '[data-testid="dataset-cover-test-palette-card-description-lines"]'
        );
        descriptionLines.value = '1';
        descriptionLines.dispatchEvent(new Event('input', { bubbles: true }));
        const glowIntensity = panel.querySelector(
            '[data-testid="dataset-cover-test-palette-active-tab-glow-intensity"]'
        );
        glowIntensity.value = '0.15';
        glowIntensity.dispatchEvent(new Event('input', { bubbles: true }));
        const maximumOpacity = panel.querySelector(
            '[data-testid="dataset-cover-test-palette-active-tab-max-opacity"]'
        );
        maximumOpacity.value = '0.9';
        maximumOpacity.dispatchEvent(new Event('input', { bubbles: true }));
        const brandColor = panel.querySelector('[data-testid="dataset-cover-test-palette-brand-color"]');
        brandColor.value = '#00aa77';
        brandColor.dispatchEvent(new Event('input', { bubbles: true }));
        expect(document.documentElement.style.getPropertyValue('--card_image_large_width')).toBe('420px');
        expect(document.documentElement.style.getPropertyValue('--card-description-lines')).toBe('1');
        expect(document.documentElement.style.getPropertyValue('--navtab-active-glow-intensity')).toBe('0.15');
        expect(document.documentElement.style.getPropertyValue('--navtab-active-max-opacity')).toBe('0.9');
        expect(document.documentElement.style.getPropertyValue('--brand-hue')).toBe('162');
        expect(document.documentElement.style.getPropertyValue('--brand-sat')).toBe('100%');
        expect(document.documentElement.style.getPropertyValue('--brand-light')).toBe('33.33%');

        panel.querySelector('[data-testid="dataset-cover-test-palette-save"]').click();
        await vi.waitFor(() => expect(saveRequestFn).toHaveBeenCalledOnce());
        const payload = saveRequestFn.mock.calls[0][0];
        expect(payload.row_article_timestamp_display_mode).toBe('date_only');
        expect(payload.dataset_cover_theme.light.image_opacity).toBe(1);
        expect(payload.dataset_cover_theme.dark.image_opacity).toBe(0.5);
        expect(payload.dataset_cover_theme.light.image_blur).toBe(1);
        expect(payload.dataset_cover_theme.dark.image_blur).toBe(3);
        expect(payload.dataset_cover_theme.shared.image_blur).toBe(1);
        expect(payload.dataset_cover_theme.shared.card_image_width).toBe(420);
        expect(payload.dataset_cover_theme.shared.card_description_lines).toBe(1);
        expect(payload.dataset_cover_theme.shared.active_tab_glow_intensity).toBe(0.15);
        expect(payload.dataset_cover_theme.shared.active_tab_max_opacity).toBe(0.9);
        expect(payload.dataset_cover_theme.shared.brand_color).toBe('#00aa77');
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

    test('lets an admin hide a theme cover by persisting zero opacity and restore the preview', async () => {
        const hero = createCoverHero();
        const saveRequestFn = vi.fn(async (request) => request);
        const control = await mountDatasetCoverTestPalette(
            hero,
            'demo',
            createMountOptions({ saveRequestFn })
        );
        control.button.click();
        const { panel } = control;
        panel.querySelector('[data-testid="dataset-cover-test-palette-tab-dark"]').click();

        const opacity = panel.querySelector(
            '[data-testid="dataset-cover-test-palette-image-opacity"]'
        );
        const visible = panel.querySelector(
            '[data-testid="dataset-cover-test-palette-cover-visible"]'
        );
        opacity.value = '0.55';
        opacity.dispatchEvent(new Event('input', { bubbles: true }));
        expect(visible.checked).toBe(true);

        visible.checked = false;
        visible.dispatchEvent(new Event('change', { bubbles: true }));
        expect(opacity.value).toBe('0');
        expect(hero.style.getPropertyValue('--dataset-cover-dark-image-opacity')).toBe('0');

        visible.checked = true;
        visible.dispatchEvent(new Event('change', { bubbles: true }));
        expect(opacity.value).toBe('0.55');

        visible.checked = false;
        visible.dispatchEvent(new Event('change', { bubbles: true }));
        panel.querySelector('[data-testid="dataset-cover-test-palette-save"]').click();
        await vi.waitFor(() => expect(saveRequestFn).toHaveBeenCalledOnce());
        expect(saveRequestFn.mock.calls[0][0].dataset_cover_theme.dark.image_opacity).toBe(0);
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
