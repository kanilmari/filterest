// @vitest-environment jsdom
// dataset_cover_test_palette.test.js
// Proves the three-place palette through its real controls and rendering owners.
// Connects v2 API patches, authorization and independent draft/save lifecycles.
// Guards sparse presence, language focus, scope switches and request races.
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mountDatasetCoverTestPalette, applyDatasetCoverThemeConfig } from './dataset_cover_test_palette.js';
import { resetSitePresentationStatesForTests, DEFAULT_DATASET_COVER_THEME } from './site_presentation_state.js';
import { datasetAppearanceState } from '../table_views/dataset_appearance_state.js';
import { DATASET_APPEARANCE_PATHS_BY_PLACE } from '../../shared/dataset_appearance/validator.js';
import { paletteMountOptions, paletteSnapshot, applyTabPatch, applySitePatch } from './dataset_appearance_palette_test_fixtures.js';

const mounted = [];
beforeEach(() => {
    document.body.replaceChildren(); localStorage.clear(); document.documentElement.lang = 'en';
    resetSitePresentationStatesForTests();
});
afterEach(() => { mounted.splice(0).forEach(control => control.destroy()); vi.restoreAllMocks(); });
async function setup(overrides = {}, snapshot = paletteSnapshot(), name = 'demo') {
    const hero = document.body.appendChild(document.createElement('section'));
    datasetAppearanceState.accept(name, snapshot);
    const options = paletteMountOptions(overrides, snapshot);
    const control = await mountDatasetCoverTestPalette(hero, name, options);
    if (control) mounted.push(control);
    const get = id => control.panel.querySelector(`[data-testid="dataset-cover-test-palette-${id}"]`);
    const row = path => control.panel.querySelector(`[data-appearance-path="${path}"]`);
    const change = (id, value) => {
        const input = get(id); input.value = String(value);
        input.dispatchEvent(new Event(input.type === 'range' || input.type === 'color' ? 'input' : 'change'));
    };
    const save = async () => { get('save').click(); await vi.waitFor(() => expect(get('save').disabled).toBe(false)); };
    return { control, hero, options, get, row, change, save };
}
const status = () => document.querySelector('[data-testid="toast"] .toast-notification-content')?.textContent;

test('opens This tab first every time with native scope radios, ordered places and no extra appearance read', async () => {
    const { control, get, options } = await setup();
    control.button.click();
    const radios = [...get('scope').querySelectorAll('input')];
    expect(radios.map(input => [input.type, input.value, input.checked])).toEqual([
        ['radio', 'tab', true], ['radio', 'site', false],
    ]);
    expect(radios[0].name).toBe(radios[1].name);
    expect([...control.panel.querySelectorAll('[data-place]')].map(row => row.dataset.place))
        .toEqual([...Array(15).fill('tab_only'), ...Array(9).fill('site_default'), ...Array(7).fill('site_only')]);
    expect(get('scope').parentElement).toBe(control.panel);
    expect(get('save').closest('.dataset-cover-test-palette__actions').parentElement).toBe(control.panel);
    expect(options.datasetSettingsRequestFn).not.toHaveBeenCalled();
    get('scope-site').click(); expect(get('scope-site').checked).toBe(true);
    expect(get('image-opacity').closest('details').hidden).toBe(true);
    expect(get('tab-light').parentElement.hidden).toBe(true);
    expect(get('save').textContent).toBe('Save all datasets');
    get('close').click(); control.button.click();
    expect(get('scope-tab').checked).toBe(true); expect(get('save').textContent).toBe('Save this tab');
});

test('all nine defaults preserve equality, zero and false as overrides; removal is staged until Save', async () => {
    const initial = paletteSnapshot(11, { 'shared.card_show_all_fields': false, 'shared.filterbar_content_top_space': 0,
        'shared.card_image_width': 300 });
    const { row, change, get, options, save } = await setup({}, initial);
    for (const path of DATASET_APPEARANCE_PATHS_BY_PLACE.site_default) {
        expect(row(path).querySelector(':scope > small').textContent)
            .toBe(Object.hasOwn(initial.overrides, path) ? 'Override' : 'Site default');
        expect(row(path).querySelector('button').textContent).toBe('Use site default');
    }
    expect(row('light.image_opacity').querySelector('button')).toBeNull();
    expect(row('shared.brand_color').querySelector('button').textContent).toBe('Edit in All datasets');
    change('card-style', 'modern'); // Equality remains explicit.
    row('shared.card_show_all_fields').querySelector('button').click();
    expect(get('card-fields-all').checked).toBe(true);
    expect(datasetAppearanceState.savedSnapshot('demo').overrides['shared.card_show_all_fields']).toBe(false);
    expect(options.datasetSaveRequestFn).not.toHaveBeenCalled();
    await save();
    expect(options.datasetSaveRequestFn.mock.calls[0][0]).toEqual({ schema_version: 2, dataset_uid: 11,
        tab_set: {}, set: { 'shared.card_style_variant': 'modern' }, unset: ['shared.card_show_all_fields'],
        version: '1', shared_version: 'site-1' });
    expect(datasetAppearanceState.savedSnapshot('demo').overrides).toEqual({
        'shared.card_style_variant': 'modern', 'shared.filterbar_content_top_space': 0, 'shared.card_image_width': 300,
    });
});

test('tab cover alias and opacity share a value and both themes save atomically with card/article/header overrides', async () => {
    const { get, change, hero, options, save } = await setup();
    change('hero-height', 80); change('image-opacity', 0.8);
    get('tab-dark').click(); change('image-opacity', 0.55); change('image-blur', 3);
    get('cover-visible').click(); expect(get('image-opacity').value).toBe('0');
    get('cover-visible').click(); expect(get('image-opacity').value).toBe('0.55');
    get('cover-visible').click();
    change('card-image-width', 420); change('article-image-caption-position', 'overlay');
    change('filterbar-content-top-space', 0); get('card-fields-values').click();
    expect(hero.style.getPropertyValue('--dataset-cover-dark-image-opacity')).toBe('0');
    await save();
    expect(options.datasetSaveRequestFn.mock.calls[0][0]).toMatchObject({ schema_version: 2,
        tab_set: { 'shared.hero_extra_height': 80, 'light.image_opacity': 0.8, 'dark.image_opacity': 0, 'dark.image_blur': 3 },
        set: { 'shared.card_image_width': 420, 'shared.article_image_caption_position': 'overlay',
            'shared.filterbar_content_top_space': 0, 'shared.card_show_all_fields': false }, unset: [] });
    expect(options.saveRequestFn).not.toHaveBeenCalled();
});

test('scope switches keep independent drafts, preview only the selected scope and update known local site tokens', async () => {
    const { control, get, change, hero, options, save } = await setup();
    const other = document.body.appendChild(document.createElement('section'));
    datasetAppearanceState.accept('other', paletteSnapshot(22)); datasetAppearanceState.bind(other, 'other');
    change('hero-height', 100); change('card-style', 'standard');
    expect(hero.dataset.cardStyleVariant).toBe('standard'); expect(other.dataset.cardStyleVariant).toBe('modern');
    get('scope-site').click(); change('brand-color', '#cc3366'); change('card-detail-columns', 4);
    expect(hero.style.getPropertyValue('--dataset-cover-hero-extra-height')).toBe('40px');
    expect(hero.dataset.cardStyleVariant).toBe('modern'); expect(other.dataset.cardDetailColumns).toBe('4');
    get('scope-tab').click();
    expect(hero.style.getPropertyValue('--dataset-cover-hero-extra-height')).toBe('100px');
    expect(hero.dataset.cardStyleVariant).toBe('standard'); expect(other.dataset.cardDetailColumns).toBe('2');
    expect(get('brand-color').value).toBe('#1a8fe6'); // Saved site value in the read-only tab row.
    get('scope-site').click(); expect(get('brand-color').value).toBe('#cc3366');
    await save();
    expect(options.saveRequestFn.mock.calls[0][0]).toEqual({ schema_version: 2, version: 'site-1',
        set: { 'shared.brand_color': '#cc3366', 'shared.card_detail_columns': 4 } });
    get('scope-tab').click(); expect(get('hero-height').value).toBe('100'); await save();
    expect(options.datasetSaveRequestFn.mock.calls[0][0].shared_version).toBe('site-1-next');
    change('hero-height', 150); get('close').click();
    expect(hero.style.getPropertyValue('--dataset-cover-hero-extra-height')).toBe('150px');
    control.destroy(); expect(hero.style.getPropertyValue('--dataset-cover-hero-extra-height')).toBe('100px');
    expect(other.dataset.cardDetailColumns).toBe('4');
});

test.each(['tab', 'site'])('%s newer edits survive saving, adopt its revision, and Reset restores the committed scope', async scope => {
    let finish;
    const request = vi.fn(patch => new Promise(resolve => { finish = () => resolve(scope === 'tab'
        ? applyTabPatch(paletteSnapshot(), patch) : applySitePatch(null, patch)); }));
    const { get, change, save, control } = await setup({ [scope === 'tab' ? 'datasetSaveRequestFn' : 'saveRequestFn']: request });
    if (scope === 'site') get('scope-site').click();
    const id = scope === 'tab' ? 'hero-height' : 'active-tab-fade';
    change(id, 60); const pending = save(); await vi.waitFor(() => expect(request).toHaveBeenCalledOnce());
    change(id, 80); get(id).closest('details').open = true; control.button.click();
    if (scope === 'site') get('scope-site').click();
    get(id).focus(); finish(); await pending;
    expect(get(id).value).toBe('80'); expect(document.activeElement).toBe(get(id));
    const second = save(); await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    expect(request.mock.calls[1][0].version).toBe(scope === 'tab' ? '2' : 'site-1-next');
    finish(); await second; get('reset').click(); expect(get(id).value).toBe('80');
});

test.each(['tab', 'site'])('%s Reset while saving follows the eventual saved result; inactive requests never restore preview', async scope => {
    let finish;
    const request = vi.fn(patch => new Promise(resolve => { finish = () => resolve(scope === 'tab'
        ? applyTabPatch(paletteSnapshot(), patch) : applySitePatch(null, patch)); }));
    const { get, change, save, hero } = await setup({ [scope === 'tab' ? 'datasetSaveRequestFn' : 'saveRequestFn']: request });
    if (scope === 'site') get('scope-site').click();
    const id = scope === 'tab' ? 'hero-height' : 'active-tab-fade';
    change(id, 60); const pending = save(); await vi.waitFor(() => expect(request).toHaveBeenCalledOnce());
    get('reset').click(); get(scope === 'tab' ? 'scope-site' : 'scope-tab').click(); finish(); await pending;
    get(`scope-${scope}`).click(); expect(get(id).value).toBe('60');
    expect(hero.style.getPropertyValue('--dataset-cover-hero-extra-height')).toBe(scope === 'tab' ? '60px' : '40px');
});

test.each(['tab', 'site'])('%s conflict retains draft, loaded tokens and translated refusal', async scope => {
    const request = vi.fn(async () => { throw Object.assign(Error('changed'), { status: 409 }); });
    const { get, change, save } = await setup({ [scope === 'tab' ? 'datasetSaveRequestFn' : 'saveRequestFn']: request });
    if (scope === 'site') get('scope-site').click();
    const id = scope === 'tab' ? 'hero-height' : 'active-tab-fade';
    change(id, 60); await save(); expect(status()).toContain('draft is kept'); expect(get(id).value).toBe('60');
    document.documentElement.lang = 'fi'; await vi.waitFor(() => expect(status()).toContain('Luonnoksesi säilyy'));
    await save(); expect(request.mock.calls[1][0].version).toBe(scope === 'tab' ? '1' : 'site-1');
    if (scope === 'tab') expect(request.mock.calls[1][0].shared_version).toBe('site-1');
});

test('independent tab/site rights retain readable rows and disabled Save; card rights still gate card editing', async () => {
    const { get, row, options } = await setup({ permissionCheck: route => ![
        '/api/admin/site-presentation-settings', '/ui/admin/card_visibility',
    ].includes(route) });
    expect(get('hero-height').disabled).toBe(false); expect(get('save').disabled).toBe(false);
    expect(get('card-style').disabled).toBe(true); expect(get('article-image-caption-position').disabled).toBe(false);
    expect(get('brand-color').value).toBe('#1a8fe6'); expect(get('brand-color').disabled).toBe(true);
    expect(row('shared.brand_color').textContent).toContain('Site-wide');
    expect(row('shared.brand_color').querySelector('button').disabled).toBe(true);
    expect(get('access').textContent).toContain('do not have permission');
    get('scope-site').click(); expect(get('save').disabled).toBe(true); get('save').click();
    expect(options.saveRequestFn).not.toHaveBeenCalled();
    const second = await setup({ permissionCheck: route => route !== '/api/admin/dataset-appearance' }, paletteSnapshot(33), 'read-tab');
    expect(second.get('save').disabled).toBe(true); expect(second.get('hero-height').disabled).toBe(true);
    expect(second.get('mediaEditor').disabled).toBe(false); // Existing media rights are independent of appearance writes.
    second.row('shared.brand_color').querySelector('button').click();
    expect(second.get('scope-site').checked).toBe(true); expect(second.get('brand-color').disabled).toBe(false);
});

test('FI/EN and fallback changes retain focus, both drafts and scope without a request', async () => {
    const { control, get, change, options } = await setup();
    control.button.click(); change('hero-height', 100); get('scope-site').click(); change('active-tab-fade', 42);
    get('active-tab-fade').closest('details').open = true; get('active-tab-fade').focus();
    for (const language of ['fi', 'en', 'unknown', 'fi-FI']) {
        document.documentElement.lang = language;
        await vi.waitFor(() => expect(get('scope-tab').parentElement.textContent).toBe(language.startsWith('fi') ? 'Tämä välilehti' : 'This tab'));
        expect(document.activeElement).toBe(get('active-tab-fade')); expect(get('active-tab-fade').value).toBe('42');
        expect(get('scope-site').checked).toBe(true);
    }
    get('scope-tab').click(); expect(get('hero-height').value).toBe('100');
    expect(options.saveRequestFn).not.toHaveBeenCalled(); expect(options.datasetSaveRequestFn).not.toHaveBeenCalled();
});

test('late save after teardown cannot reclaim preview or paint a deleted dataset', async () => {
    let finish;
    const { control, get, change, options } = await setup({ datasetSaveRequestFn: vi.fn(patch => new Promise(resolve => {
        finish = () => resolve(applyTabPatch(paletteSnapshot(), patch));
    })) });
    change('hero-height', 100); get('save').click(); await vi.waitFor(() => expect(options.datasetSaveRequestFn).toHaveBeenCalledOnce());
    control.destroy(); datasetAppearanceState.forget('demo'); finish(); await Promise.resolve(); await Promise.resolve();
    expect(datasetAppearanceState.savedSnapshot('demo')).toBeNull(); expect(control.panel.isConnected).toBe(false);
});

test('flag and route gating fail closed while public theme rendering remains available', async () => {
    const { control } = await setup({ requestFn: async () => ({ view_admin_cover_image_test_palette: false }) });
    expect(control).toBeNull();
    const hero = document.createElement('section');
    expect(applyDatasetCoverThemeConfig(hero, DEFAULT_DATASET_COVER_THEME)).toBe(true);
    expect(hero.style.getPropertyValue('--dataset-cover-light-mask-oval-x')).toBe('32%');
});

test('tab actions open the existing media/field editors with this dataset and keep the draft', async () => {
    const openMediaEditor = vi.fn(), openFieldEditor = vi.fn();
    const { control, get, change } = await setup({ openMediaEditor, openFieldEditor });
    control.button.click(); change('hero-height', 100); get('mediaEditor').click();
    expect(openMediaEditor).toHaveBeenCalledWith('demo'); expect(control.panel.hidden).toBe(true);
    control.button.click(); expect(get('hero-height').value).toBe('100'); get('fieldEditor').click();
    expect(openFieldEditor.mock.calls[0][0]).toBe('demo');
    control.button.click(); get('scope-site').click(); expect(get('fieldEditor').parentElement.hidden).toBe(true);
});

test('all nine tab controls save explicit values together, then stage removal without losing owned cover values', async () => {
    const { change, get, row, options, save } = await setup();
    change('card-image-width', 380); change('card-image-presentation', 'contain_blur');
    change('article-image-caption-position', 'overlay'); get('card-fields-values').click();
    change('label-value-layout', 'inline'); change('card-style', 'standard');
    change('card-description-lines', 5); change('card-detail-columns', 4); change('filterbar-content-top-space', 0);
    await save();
    expect(Object.keys(options.datasetSaveRequestFn.mock.calls[0][0].set).sort())
        .toEqual([...DATASET_APPEARANCE_PATHS_BY_PLACE.site_default].sort());
    for (const path of DATASET_APPEARANCE_PATHS_BY_PLACE.site_default) row(path).querySelector('button').click();
    expect(Object.keys(datasetAppearanceState.savedSnapshot('demo').overrides)).toHaveLength(9);
    await save();
    expect(options.datasetSaveRequestFn.mock.calls[1][0].unset.sort())
        .toEqual([...DATASET_APPEARANCE_PATHS_BY_PLACE.site_default].sort());
    expect(datasetAppearanceState.savedSnapshot('demo').overrides).toEqual({});
    expect(Object.keys(datasetAppearanceState.savedSnapshot('demo').tab_values)).toHaveLength(28);
});

test.each(['tab', 'site'])('%s refuses a successful response with a mismatched value and retains its draft', async scope => {
    const wrongResponse = scope === 'tab' ? paletteSnapshot() : applySitePatch(null, { set: {} });
    const { get, change, save } = await setup({ [scope === 'tab' ? 'datasetSaveRequestFn' : 'saveRequestFn']: async () => wrongResponse });
    if (scope === 'site') get('scope-site').click();
    const id = scope === 'tab' ? 'hero-height' : 'active-tab-fade';
    change(id, 60); await save(); expect(status()).toBe('Saving failed.'); expect(get(id).value).toBe('60');
    get('reset').click(); expect(get(id).value).toBe(scope === 'tab' ? '40' : '25');
});

test('scope switching during a request keeps drafts and disables Save without a false permission explanation', async () => {
    let finish;
    const { get, change, options } = await setup({ datasetSaveRequestFn: vi.fn(patch => new Promise(resolve => {
        finish = () => resolve(applyTabPatch(paletteSnapshot(), patch));
    })) });
    change('hero-height', 60); get('save').click(); await vi.waitFor(() => expect(options.datasetSaveRequestFn).toHaveBeenCalledOnce());
    get('scope-site').click(); change('active-tab-fade', 42);
    expect(get('save').disabled).toBe(true); expect(get('access').hidden).toBe(true);
    get('save').click(); expect(options.saveRequestFn).not.toHaveBeenCalled();
    finish(); await vi.waitFor(() => expect(get('save').disabled).toBe(false));
    expect(get('active-tab-fade').value).toBe('42');
    get('scope-tab').click(); expect(get('hero-height').value).toBe('60');
});

test('reload refusal keeps the draft and follows the existing FI/EN fallback copy', async () => {
    const { change, get, save } = await setup({ datasetSaveRequestFn: async () => {
        throw Object.assign(Error('reload'), { failureNotice: { langKey: 'dataset_appearance_reload' } });
    } });
    change('hero-height', 100); await save(); expect(status()).toContain('save format changed');
    expect(document.querySelector('[data-testid="toast"]').dataset.toastLevel).toBe('error');
    document.documentElement.lang = 'fi'; await vi.waitFor(() => expect(status()).toContain('tallennustapa on muuttunut'));
    expect(get('hero-height').value).toBe('100');
});
