// @vitest-environment jsdom
// Verifies the card-photo selector through the actual protected appearance palette.
// Connects preview, language changes, reset, persistence and older settings.
// Prevents selecting a style from silently saving or resetting other site values.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_DATASET_COVER_THEME, mountDatasetCoverTestPalette } from './dataset_cover_test_palette.js';

let mounted;
afterEach(() => {
    mounted?.destroy();
    mounted = null;
    document.body.innerHTML = '';
    document.documentElement.removeAttribute('lang');
    document.documentElement.removeAttribute('style');
    document.documentElement.removeAttribute('data-card-image-presentation');
});
function settings() {
    return {
        dataset_cover_theme: JSON.parse(JSON.stringify(DEFAULT_DATASET_COVER_THEME)),
        row_article_timestamp_display_mode: 'date_only',
    };
}
async function mount(initial, save = async value => value, permission = true) {
    const hero = document.createElement('section');
    document.body.append(hero);
    mounted = await mountDatasetCoverTestPalette(hero, 'demo', {
        requestFn: async () => ({ view_admin_cover_image_test_palette: true }),
        settingsRequestFn: async () => initial,
        permissionCheck: () => permission,
        saveRequestFn: save,
    });
    return mounted;
}
describe('site card image selector', () => {
    it('previews, relabels and resets without saving, then persists the selected mode', async () => {
        const initial = settings();
        initial.dataset_cover_theme.shared.card_image_presentation = 'cover';
        initial.dataset_cover_theme.shared.card_image_width = 420;
        const save = vi.fn(async value => value);
        const control = await mount(initial, save);
        const select = control.panel.querySelector('select');
        expect(select.value).toBe('cover');
        select.value = 'contain_blur';
        select.dispatchEvent(new Event('change'));
        expect(document.documentElement.dataset.cardImagePresentation).toBe('contain_blur');
        expect(save).not.toHaveBeenCalled();
        document.documentElement.lang = 'fi';
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(select.value).toBe('contain_blur');
        expect(select.getAttribute('aria-label')).toBe('Korttikuvan esitystapa');
        expect(select.selectedOptions[0].textContent).toBe('Koko kuva ja sumennettu tausta');
        control.resetPreview();
        expect(select.value).toBe('cover');
        expect(document.documentElement.dataset.cardImagePresentation).toBe('cover');
        select.value = 'contain';
        select.dispatchEvent(new Event('change'));
        control.panel.querySelector('[data-testid="dataset-cover-test-palette-save"]').click();
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(save).toHaveBeenCalledOnce();
        expect(save.mock.calls[0][0].dataset_cover_theme.shared).toMatchObject({
            card_image_presentation: 'contain', card_image_width: 420,
        });
        expect(save.mock.calls[0][0].row_article_timestamp_display_mode).toBe('date_only');
    });
    it('keeps older stored settings and supplies the missing complete-image default', async () => {
        const initial = settings();
        delete initial.dataset_cover_theme.shared.card_image_presentation;
        initial.dataset_cover_theme.shared.card_image_width = 440;
        const control = await mount(initial);
        expect(control.panel.querySelector('select').value).toBe('contain');
        expect(document.documentElement.style.getPropertyValue('--card_image_large_width')).toBe('440px');
    });
    it('applies the saved mode to visitors without exposing an editor', async () => {
        const initial = settings();
        initial.dataset_cover_theme.shared.card_image_presentation = 'contain_blur';
        expect(await mount(initial, undefined, false)).toBeNull();
        expect(document.documentElement.dataset.cardImagePresentation).toBe('contain_blur');
        expect(document.querySelector('select')).toBeNull();
    });
});
