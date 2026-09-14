// @vitest-environment jsdom
// Verifies independent dataset saves, inheritance and preview lifecycle against real card projection.
// Bridges typed API fixtures and mounted card nodes without global settings writes.
// Protects field metadata, other datasets and retained article/card identity.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { buildDatasetCardPaletteControl } from './dataset_card_palette_control.js';
import { DATASET_COVER_PALETTE_COPY as COPY } from './dataset_cover_palette_copy.js';
import { applyCardFieldPresentationSetting, mountCardFieldGroup } from '../table_views/card_view/card_field_presentation.js';

const mounted = [];
const raw = (style = null, columns = null, table = 'example') => ({
    table_name: table, card_style_variant: style, card_detail_columns: columns,
    columns: [{ column_uid: 7, hide_everywhere: true, show_key_on_card: false }],
});
function card(dataset, view = 'card') {
    const list = document.createElement('div'); list.className = 'card_container';
    const outer = document.createElement('div'); outer.className = 'card'; outer.dataset.datasetName = dataset;
    const media = document.createElement('img'), checkbox = document.createElement('input'); checkbox.checked = true;
    outer.append(media, checkbox); list.append(outer); document.body.append(list);
    const render = vi.fn((parent, _all, style, columns) => {
        const field = document.createElement('span'); field.textContent = style + ':' + columns; parent.append(field);
    });
    mountCardFieldGroup(outer, outer, view, render);
    return { outer, media, checkbox, render };
}
async function setup(options = {}) {
    const saveRequestFn = options.saveRequestFn || vi.fn(async request => request);
    const control = buildDatasetCardPaletteControl({
        datasetName: 'example', copy: COPY.en, requestFn: vi.fn(async () => raw('modern', 2)),
        saveRequestFn, ...options,
    });
    mounted.push(control); document.body.append(control.element); await control.ready;
    const get = name => control.element.querySelector('[data-testid="dataset-card-palette-' + name + '"]');
    const choose = (name, value) => { get(name).value = value; get(name).dispatchEvent(new Event('change')); };
    return { ...control, get, choose, saveRequestFn };
}
beforeEach(() => {
    document.body.replaceChildren(); localStorage.clear();
    applyCardFieldPresentationSetting(true, 'modern', 2);
});
afterEach(() => { mounted.splice(0).forEach(control => control.destroy()); });
describe('dataset card palette', () => {
    test('changes an explicit dataset style and columns without changing site/other dataset/article or outer nodes', async () => {
        const own = card('example'), other = card('other'), article = card('example', 'article_view');
        const panel = await setup();
        panel.choose('style', 'standard'); panel.choose('columns', '4');
        expect(own.outer.dataset.cardStyleVariant).toBe('standard');
        expect(own.outer.dataset.cardDetailColumns).toBe('4');
        expect(other.outer.dataset.cardStyleVariant).toBe('modern');
        expect(other.outer.dataset.cardDetailColumns).toBe('2');
        expect(article.render).toHaveBeenCalledTimes(1);
        expect(document.documentElement.dataset.cardStyleVariant).toBe('modern');
        expect(own.outer.firstChild).toBe(own.media); expect(own.checkbox.checked).toBe(true);
        expect(panel.saveRequestFn).not.toHaveBeenCalled();
        panel.setCopy(COPY.fi);
        expect(panel.get('style').getAttribute('aria-label')).toBe('Tämä aineisto: kortin tyyli');
        expect(panel.get('columns').value).toBe('4');
        panel.destroy();
        expect(own.outer.dataset.cardStyleVariant).toBe('modern'); expect(own.outer.dataset.cardDetailColumns).toBe('2');
    });
    test('inherit uses current site values, saves only two overrides and leaves field cache metadata untouched', async () => {
        const own = card('example'); localStorage.setItem('example_tableMeta', JSON.stringify({ title: 'Keep', card_details_layout: 'inline' }));
        const panel = await setup();
        applyCardFieldPresentationSetting(true, 'standard', 3);
        expect(own.outer.dataset.cardStyleVariant).toBe('modern');
        panel.choose('style', 'inherit'); panel.choose('columns', 'inherit');
        expect(own.outer.dataset.cardStyleVariant).toBe('standard'); expect(own.outer.dataset.cardDetailColumns).toBe('3');
        panel.get('save').click();
        await vi.waitFor(() => expect(panel.get('save').disabled).toBe(false));
        expect(panel.saveRequestFn).toHaveBeenCalledExactlyOnceWith({
            table_name: 'example', card_style_variant: null, card_detail_columns: null,
        });
        expect(JSON.parse(localStorage.getItem('example_tableMeta'))).toEqual({
            title: 'Keep', card_details_layout: 'inline', card_style_variant: null, card_detail_columns: null,
        });
        expect(own.outer.dataset.cardStyleOverride).toBeUndefined();
        applyCardFieldPresentationSetting(true, 'modern', 1);
        expect(own.outer.dataset.cardStyleVariant).toBe('modern'); expect(own.outer.dataset.cardDetailColumns).toBe('1');
    });
    test('newer preview survives a slow successful save, while reset uses the committed values', async () => {
        let resolve; const saveRequestFn = vi.fn(() => new Promise(done => { resolve = done; }));
        const own = card('example'); const panel = await setup({ saveRequestFn });
        panel.choose('style', 'standard'); panel.choose('columns', '1'); panel.get('save').click();
        panel.choose('style', 'modern'); panel.choose('columns', '4');
        await vi.waitFor(() => expect(saveRequestFn).toHaveBeenCalledOnce());
        resolve({ table_name: 'example', card_style_variant: 'standard', card_detail_columns: 1 });
        await vi.waitFor(() => expect(panel.get('save').disabled).toBe(false));
        expect(own.outer.dataset.cardStyleVariant).toBe('modern'); expect(own.outer.dataset.cardDetailColumns).toBe('4');
        panel.get('reset').click();
        expect(own.outer.dataset.cardStyleVariant).toBe('standard'); expect(own.outer.dataset.cardDetailColumns).toBe('1');
    });
    test('a failed or mismatched save keeps the draft and never projects a claimed success', async () => {
        const onStatus = vi.fn();
        const panel = await setup({ saveRequestFn: vi.fn(async () => raw('modern', 2, 'other')), onStatus });
        panel.choose('columns', '4'); panel.get('save').click();
        await vi.waitFor(() => expect(panel.get('save').disabled).toBe(false));
        expect(onStatus).toHaveBeenLastCalledWith('datasetSaveFailed'); expect(panel.get('columns').value).toBe('4');
        expect(JSON.parse(localStorage.getItem('example_tableMeta')).card_detail_columns).toBe(2);
    });
    test('destroyed loading control does not overwrite later metadata or paint cards', async () => {
        let resolve; const requestFn = vi.fn(() => new Promise(done => { resolve = done; }));
        const control = buildDatasetCardPaletteControl({ datasetName: 'example', copy: COPY.en, requestFn });
        mounted.push(control); await vi.waitFor(() => expect(requestFn).toHaveBeenCalledOnce()); control.destroy();
        localStorage.setItem('example_tableMeta', '{"keep":true}');
        resolve(raw('standard', 1)); await control.ready;
        expect(localStorage.getItem('example_tableMeta')).toBe('{"keep":true}');
    });
    test('unknown or unloaded dataset disables only its own settings and never saves', async () => {
        const panel = await setup({ requestFn: vi.fn(async () => ({ table_name: 'example', columns: [] })) });
        expect(panel.get('style').disabled).toBe(true); expect(panel.get('save').disabled).toBe(true);
        expect(panel.element.textContent).toContain('Site defaults remain available');
        expect(panel.saveRequestFn).not.toHaveBeenCalled();
    });
    test.each([false, true])('serializes same-dataset saves and later reads; destroyed=%s', async destroyed => {
        let finishFirst;
        let server = raw('modern', 2);
        const own = card('example');
        const firstSave = vi.fn(request => {
            server = { ...raw(), ...request };
            return new Promise(resolve => { finishFirst = () => resolve(server); });
        });
        const secondSave = vi.fn(async request => { server = { ...raw(), ...request }; return server; });
        const first = await setup({ saveRequestFn: firstSave });
        const second = await setup({ saveRequestFn: secondSave });
        first.choose('columns', '1'); first.get('save').click();
        await vi.waitFor(() => expect(firstSave).toHaveBeenCalledOnce());
        if (destroyed) first.destroy();
        second.choose('columns', '4'); second.get('save').click();
        const laterRead = vi.fn(async () => server);
        const third = buildDatasetCardPaletteControl({ datasetName: 'example', copy: COPY.en, requestFn: laterRead });
        mounted.push(third); document.body.append(third.element);
        await Promise.resolve(); await Promise.resolve();
        expect(secondSave).not.toHaveBeenCalled();
        expect(laterRead).not.toHaveBeenCalled();
        finishFirst();
        await third.ready;
        await vi.waitFor(() => expect(second.get('save').disabled).toBe(false));
        expect(secondSave).toHaveBeenCalledOnce();
        expect(server.card_detail_columns).toBe(4);
        expect(JSON.parse(localStorage.getItem('example_tableMeta')).card_detail_columns).toBe(4);
        expect(own.outer.dataset.cardDetailColumns).toBe('4');
        expect(second.get('columns').value).toBe('4');
    });

});
