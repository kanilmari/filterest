// @vitest-environment jsdom
// inline_editor_state.test.js
// Verifies confirmed edits, discarded drafts and every editor lifetime ending.
// Connects real editCell controls, routed request outcomes and the shared refresh hold.
// Keeps early exits and retry controls from stranding an SSE refresh or saving on removal.

import { afterEach, beforeEach, expect, test, vi } from 'vitest';
const { request, options, permitted } = vi.hoisted(() => ({ request: vi.fn(), options: vi.fn(), permitted: vi.fn() }));
vi.mock('../../../endpoints/endpoint_router.js', () => ({ endpoint_router: request }));
vi.mock('../../../endpoints/endpoint_data_fetcher.js', () => ({ fetchFilterOptions: options }));
vi.mock('../../../../reusable_components/notifications/toast_notification_printer.js', () => ({ showWarningToast: vi.fn() }));
vi.mock('../../../lang/translation_handler.js', () => ({ getTranslationForKey: key => key }));
vi.mock('../../../service_catalog/service_catalog_moderation.js', () => ({
    readCachedUserPermissions: () => ({}), canEditServiceCatalogColumn: permitted,
}));
import { editCell } from './cell_editor.js';
import { beginInlineEditor, discardInlineEditors, hasOpenInlineEditor, setHeldInlineChange,
    subscribeToInlineEditorClose } from './inline_editor_state.js';
import { disposeCardResources } from '../../../table_views/card_view/card_resource_lifecycle.js';
import { setChosenDatasetView, forgetChosenDatasetView } from '../../../state_stores/dataset_view_choice_saver.js';

beforeEach(() => {
    document.body.replaceChildren(); localStorage.clear(); localStorage.setItem('chosen_language', 'en');
    request.mockReset().mockResolvedValue({}); options.mockReset().mockResolvedValue([{ value: 12, label: 'New label' }]);
    permitted.mockReset().mockReturnValue(true);
    forgetChosenDatasetView('orders');
});
afterEach(() => { discardInlineEditors(); setHeldInlineChange('orders', false); document.body.replaceChildren(); });
const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const unavailable = () => Object.assign(new Error('maintenance'), { status: 503, isServiceUnavailable: true });

function fixture({ value = 'Original', column = 'title', type = 'text', dataset = 'orders', columns, types, data } = {}) {
    const table = document.createElement('table'); const row = table.createTBody().insertRow();
    const cell = row.insertCell(); cell.className = 'table_data_cell'; cell.tabIndex = 0;
    cell.dataset.rowIndex = '0'; cell.dataset.colIndex = '1'; cell.dataset.column = column;
    cell.textContent = String(value); document.body.append(table);
    const rows = data || [{ id: 7, [column]: value }];
    return { cell, rows, open: () => editCell(cell, columns || ['id', column], rows,
        types || { [column]: { data_type: type } }, dataset) };
}

test.each(['Enter', 'Ctrl+Enter', 'Escape', 'changed blur', 'unchanged blur', 'refused', 'synchronous throw', '503', 'removed'])(
    'plan row: %s with a held same-cell change', async ending => {
        const { cell, rows, open } = fixture(); await open();
        const input = cell.querySelector('input, textarea'); input.value = 'Draft';
        setHeldInlineChange('orders', true);
        let closes = 0; const unsubscribe = subscribeToInlineEditorClose(() => { closes++; });
        try {
            if (ending === 'refused') request.mockRejectedValueOnce(new Error('denied'));
            if (ending === 'synchronous throw') request.mockImplementationOnce(() => { throw new Error('request threw'); });
            if (ending === '503') request.mockRejectedValueOnce(unavailable());
            if (ending === 'unchanged blur') input.value = 'Original';
            if (ending === 'removed') { disposeCardResources(cell.closest('table')); input.dispatchEvent(new Event('blur')); cell.closest('table').remove(); }
            else if (['Enter', 'Ctrl+Enter', 'Escape'].includes(ending)) input.dispatchEvent(new KeyboardEvent('keydown', {
                key: ending === 'Ctrl+Enter' ? 'Enter' : ending, ctrlKey: ending === 'Ctrl+Enter', bubbles: true,
            }));
            else input.dispatchEvent(new Event('blur'));
            await settle();
            const saves = !['Escape', 'unchanged blur', 'removed'].includes(ending);
            expect(request).toHaveBeenCalledTimes(saves ? 1 : 0);
            if (saves) expect(request.mock.calls[0][1].body_data.value).toBe('Draft');
            expect(rows[0].title).toBe(['Enter', 'Ctrl+Enter', 'changed blur'].includes(ending) ? 'Draft' : 'Original');
            expect(hasOpenInlineEditor('orders')).toBe(ending === '503');
            expect(closes).toBe(ending === '503' ? 0 : 1);
            if (ending === '503') expect(input.value).toBe('Draft');
        } finally { unsubscribe(); }
    }
);

test.each(['invalid column', 'denied', 'read only', 'missing regular row', 'missing foreign row', 'setup throws'])(
    'setup exit: %s releases before its caller returns', async ending => {
        const f = fixture();
        if (ending === 'invalid column') f.cell.dataset.colIndex = '9';
        if (ending === 'denied') permitted.mockReturnValue(false);
        if (ending === 'setup throws') permitted.mockImplementation(() => { throw new Error('setup'); });
        const data = ending.includes('missing') ? [] : f.rows;
        const types = ending === 'missing foreign row' ? { title: { foreign_table: 'services' } }
            : { title: { data_type: 'text', editable_in_ui: ending !== 'read only' } };
        const opening = editCell(f.cell, ['id', 'title'], data, types, 'orders');
        if (ending === 'setup throws') await expect(opening).rejects.toThrow('setup'); else await opening;
        expect(hasOpenInlineEditor('orders')).toBe(false); expect(request).not.toHaveBeenCalled();
    }
);

test('setup is open before its first await and saving stays open until the POST answers', async () => {
    const f = fixture(); const opening = f.open();
    expect(hasOpenInlineEditor('orders')).toBe(true); await opening;
    let answer; request.mockImplementationOnce(() => new Promise(resolve => { answer = resolve; }));
    const input = f.cell.querySelector('input'); input.value = 'Confirmed'; input.blur();
    await settle(); expect(f.cell.dataset.inlineSaveState).toBe('saving');
    expect(hasOpenInlineEditor('orders')).toBe(true);
    answer({}); await settle(); expect(hasOpenInlineEditor('orders')).toBe(false);
});

test('detached editor releases its hold even where removal emits no blur', async () => {
    const f = fixture(); await f.open(); f.cell.closest('table').remove(); await settle();
    expect(hasOpenInlineEditor('orders')).toBe(false); expect(request).not.toHaveBeenCalled();
});

test('discard mark is set before removal blur, and repeated events cannot save the old draft', async () => {
    const f = fixture(); await f.open(); const input = f.cell.querySelector('input'); input.value = 'Unconfirmed';
    const swap = vi.spyOn(f.cell, 'replaceChildren').mockImplementation(() => input.dispatchEvent(new Event('blur')));
    discardInlineEditors(f.cell); input.dispatchEvent(new Event('blur')); await settle();
    expect(request).not.toHaveBeenCalled(); expect(hasOpenInlineEditor('orders')).toBe(false); swap.mockRestore();
});

test.each(['unchanged', 'Escape', 'outside', 'success', 'refused', '503', 'discard'])(
    'constrained option exit: %s', async ending => {
        localStorage.setItem('full_tree_data', JSON.stringify({ column_details: [{
            table_name: 'system_db_tables', column_name: 'card_details_layout', editable_in_ui: true,
        }] }));
        const f = fixture({ value: 'single_line', column: 'card_details_layout', dataset: 'system_db_tables' }); await f.open();
        const select = f.cell.querySelector('select'); select.value = ending === 'unchanged' ? 'single_line' : 'stacked';
        if (ending === 'refused') request.mockRejectedValueOnce(new Error('denied'));
        if (ending === '503') request.mockRejectedValueOnce(unavailable());
        if (ending === 'outside') document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
        else if (ending === 'discard') { disposeCardResources(f.cell); select.dispatchEvent(new Event('change')); }
        else select.dispatchEvent(new KeyboardEvent('keydown', { key: ending === 'Escape' ? 'Escape' : 'Enter' }));
        await settle(); expect(hasOpenInlineEditor('system_db_tables')).toBe(ending === '503');
        expect(request).toHaveBeenCalledTimes(['success', 'refused', '503'].includes(ending) ? 1 : 0);
    }
);

test.each(['same option', 'Escape', 'blur', 'clear', 'outside', 'success', 'refused', '503', 'discard'])(
    'foreign key exit: %s', async ending => {
        options.mockResolvedValue([{ value: 4, label: 'Old' }, { value: 12, label: 'New label' }]);
        const f = fixture({ column: 'service_id', value: 4, types: { service_id: { data_type: 'integer', foreign_table: 'services' } } });
        await f.open(); await vi.waitFor(() => expect(f.cell.querySelector('.msd-option[data-option-value="12"]')).not.toBeNull());
        const input = f.cell.querySelector('[data-testid="inline-fk-search-input"]');
        if (ending === 'refused') request.mockRejectedValueOnce(new Error('denied'));
        if (ending === '503') request.mockRejectedValueOnce(unavailable());
        if (ending === 'Escape') input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        else if (ending === 'blur') input.dispatchEvent(new FocusEvent('blur', { relatedTarget: document.body }));
        else if (ending === 'clear') f.cell.querySelector('.msd-clear-btn').click();
        else if (ending === 'outside') document.body.click();
        else if (ending === 'discard') { const option = f.cell.querySelector('.msd-option[data-option-value="12"]'); disposeCardResources(f.cell); option.click(); }
        else f.cell.querySelector(`.msd-option[data-option-value="${ending === 'same option' ? 4 : 12}"]`).click();
        await settle(); expect(hasOpenInlineEditor('orders')).toBe(ending === '503');
        expect(request).toHaveBeenCalledTimes(['success', 'refused', '503'].includes(ending) ? 1 : 0);
    }
);

test('503 retry remains open, then Escape drops the draft without another request', async () => {
    const f = fixture(); await f.open(); request.mockRejectedValueOnce(unavailable());
    const input = f.cell.querySelector('input'); input.value = 'Draft'; input.blur(); await settle();
    expect(hasOpenInlineEditor('orders')).toBe(true);
    input.focus(); input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); await settle();
    expect(hasOpenInlineEditor('orders')).toBe(false); expect(request).toHaveBeenCalledTimes(1);
});

test.each(['normal', 'table'])('held multilingual edit re-reads with the %s projection and preserves another language', async view => {
    setChosenDatasetView('orders', view);
    const f = fixture({ value: { en: 'Old', fi: 'Vanha' }, types: { title: { data_type: 'text', is_multilingual: true } } });
    await f.open(); setHeldInlineChange('orders', true);
    setChosenDatasetView('orders', view === 'normal' ? 'table' : 'normal'); // The editor retains its opening view.
    const current = { en: 'Other confirmed text', fi: 'Uusi' };
    request.mockResolvedValueOnce({ data: [{ id: 7, title: view === 'normal' ? JSON.stringify(current) : current }] });
    const input = f.cell.querySelector('input, textarea'); input.value = 'My confirmed text'; input.blur(); await settle();
    expect(request.mock.calls[0][0]).toBe('getResults');
    expect(request.mock.calls[0][1].url_params).toBe(`?dataset=orders&id=7&view_key=${view}`);
    expect(JSON.parse(request.mock.calls[1][1].body_data.value)).toEqual({ en: 'My confirmed text', fi: 'Uusi' });
    expect(hasOpenInlineEditor('orders')).toBe(false);
});

test.each(['rejected', '503', 'reported error', 'unsuccessful', 'missing row', 'missing field'])('failed multilingual reread (%s) retains draft and hold for retry', async failure => {
    const f = fixture({ value: { en: 'Old', fi: 'Vanha' }, types: { title: { data_type: 'text', is_multilingual: true } } });
    await f.open(); setHeldInlineChange('orders', true);
    if (failure === 'rejected') request.mockRejectedValueOnce(new Error('read failed'));
    else if (failure === '503') request.mockRejectedValueOnce(unavailable());
    else request.mockResolvedValueOnce({ error: failure === 'reported error', success: failure !== 'unsuccessful',
        data: failure === 'missing row' ? [] : failure === 'missing field' ? [{ id: 7 }]
            : [{ id: 7, title: { fi: 'Uusi' } }] });
    const input = f.cell.querySelector('input, textarea'); input.value = 'Draft'; input.blur(); await settle();
    expect(request).toHaveBeenCalledTimes(1); expect(request.mock.calls[0][0]).toBe('getResults');
    expect(hasOpenInlineEditor('orders')).toBe(true); expect(input.value).toBe('Draft');
    expect(f.cell.dataset.inlineSaveState).toBe('retry');
    input.focus(); input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); await settle();
    expect(hasOpenInlineEditor('orders')).toBe(false); expect(request).toHaveBeenCalledTimes(1);
});

test.each(['English', '123', '[]', 'null', 'true', '"English"', [], 123, true])(
    'a successful held reread of %j confirms once with the ordinary plain payload', async current => {
        const f = fixture({ value: { en: 'Old', fi: 'Vanha' }, types: { title: { data_type: 'text', is_multilingual: true } } });
        await f.open(); setHeldInlineChange('orders', true);
        request.mockResolvedValueOnce({ data: [{ id: 7, title: current }] });
        const input = f.cell.querySelector('input, textarea'); input.value = 'Confirmed';
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })); await settle();
        expect(request.mock.calls).toEqual([
            ['getResults', { url_params: '?dataset=orders&id=7&view_key=table' }],
            ['updateRow', { method: 'POST', url_params: '?dataset=orders',
                body_data: { id: 7, column: 'title', value: 'Confirmed' } }],
        ]);
        expect(f.rows[0].title).toBe('Confirmed'); expect(hasOpenInlineEditor('orders')).toBe(false);
    }
);

test.each(['English', '123'])('a plain multilingual opening value %s opens and confirms with or without a hold', async value => {
    for (const held of [false, true]) {
        request.mockClear();
        const f = fixture({ value, types: { title: { data_type: 'text', is_multilingual: true } } });
        await f.open(); setHeldInlineChange('orders', held);
        const input = f.cell.querySelector('input, textarea'); expect(input.value).toBe(value);
        if (held) request.mockResolvedValueOnce({ data: [{ id: 7, title: value }] });
        input.value = 'Confirmed'; input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })); await settle();
        expect(request).toHaveBeenCalledTimes(held ? 2 : 1);
        expect(request.mock.calls.at(-1)).toEqual(['updateRow', { method: 'POST', url_params: '?dataset=orders',
            body_data: { id: 7, column: 'title', value: 'Confirmed' } }]);
        expect(hasOpenInlineEditor('orders')).toBe(false); f.cell.closest('table').remove();
    }
});

test.each([null, ''])('an initially empty multilingual cell (%s) merges a held language change', async value => {
    const f = fixture({ value, types: { title: { data_type: 'text', is_multilingual: true } } });
    await f.open(); setHeldInlineChange('orders', true);
    request.mockResolvedValueOnce({ data: [{ id: 7, title: { fi: 'Uusi' } }] });
    const input = f.cell.querySelector('input, textarea'); input.value = 'English'; input.blur(); await settle();
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[0]).toEqual(['getResults', { url_params: '?dataset=orders&id=7&view_key=table' }]);
    expect(JSON.parse(request.mock.calls[1][1].body_data.value)).toEqual({ fi: 'Uusi', en: 'English' });
    expect(hasOpenInlineEditor('orders')).toBe(false);
});

test.each([null, ''])('an initially empty multilingual cell (%s) without a hold keeps the existing request', async value => {
    const f = fixture({ value, types: { title: { data_type: 'text', is_multilingual: true } } });
    await f.open();
    const input = f.cell.querySelector('input, textarea'); input.value = 'English'; input.blur(); await settle();
    expect(request.mock.calls).toEqual([['updateRow', {
        method: 'POST', url_params: '?dataset=orders', body_data: { id: 7, column: 'title', value: 'English' },
    }]]);
});

test.each([null, '', 'null'])('an initially empty multilingual cell without a language object on re-read (%s) keeps the existing payload', async current => {
    const f = fixture({ value: null, types: { title: { data_type: 'text', is_multilingual: true } } });
    await f.open(); setHeldInlineChange('orders', true);
    request.mockResolvedValueOnce({ data: [{ id: 7, title: current }] });
    const input = f.cell.querySelector('input, textarea'); input.value = 'English'; input.blur(); await settle();
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[1]).toEqual(['updateRow', {
        method: 'POST', url_params: '?dataset=orders', body_data: { id: 7, column: 'title', value: 'English' },
    }]);
});

test('a multilingual reread answering after discard never sends the update', async () => {
    const f = fixture({ value: { en: 'Old' }, types: { title: { data_type: 'text', is_multilingual: true } } });
    await f.open(); setHeldInlineChange('orders', true); let answer;
    request.mockImplementationOnce(() => new Promise(resolve => { answer = resolve; }));
    const input = f.cell.querySelector('input, textarea'); input.value = 'Draft'; input.blur();
    discardInlineEditors(f.cell); answer({ data: [{ id: 7, title: { en: 'Current' } }] }); await settle();
    expect(request).toHaveBeenCalledTimes(1); expect(hasOpenInlineEditor('orders')).toBe(false);
});

test('all endings use one DOM lifetime mechanism, including initialization with no editor', () => {
    const cell = document.createElement('div'); document.body.append(cell);
    const editor = beginInlineEditor(cell, 'orders', () => {});
    expect(hasOpenInlineEditor('orders')).toBe(true); editor.ready(); expect(hasOpenInlineEditor('orders')).toBe(false);
});

test('invalid temporal input closes without a write and releases the hold', async () => {
    const f = fixture({ value: '2026-11-02', type: 'date' }); await f.open();
    const input = f.cell.querySelector('input'); input.value = ''; input.blur(); await settle();
    expect(request).not.toHaveBeenCalled(); expect(hasOpenInlineEditor('orders')).toBe(false);
});

test('a confirmed POST answering after discard cannot reselect its old cell', async () => {
    const f = fixture(); await f.open(); let answer;
    request.mockImplementationOnce(() => new Promise(resolve => { answer = resolve; }));
    const input = f.cell.querySelector('input'); input.value = 'Confirmed'; input.blur();
    discardInlineEditors(f.cell); const search = document.createElement('input'); document.body.append(search); search.focus();
    answer({}); await settle();
    expect(document.activeElement).toBe(search); expect(f.rows[0].title).toBe('Original');
    expect(hasOpenInlineEditor('orders')).toBe(false); expect(request).toHaveBeenCalledTimes(1);
});

test('a search control entered during a confirmed save keeps focus when the answer arrives', async () => {
    const f = fixture(); await f.open(); let answer;
    request.mockImplementationOnce(() => new Promise(resolve => { answer = resolve; }));
    const input = f.cell.querySelector('input'); input.value = 'Confirmed'; input.blur();
    const search = document.createElement('input'); document.body.append(search); search.focus();
    answer({}); await settle();
    expect(document.activeElement).toBe(search); expect(f.cell.classList.contains('selected_for_editing')).toBe(true);
});

test.each([null, ''])('a held multilingual save starts from another confirmed clear (%s)', async value => {
    const f = fixture({ value: { en: 'Old', fi: 'Vanha' }, types: { title: { data_type: 'text', is_multilingual: true } } });
    await f.open(); setHeldInlineChange('orders', true);
    request.mockResolvedValueOnce({ data: [{ id: 7, title: value }] });
    const input = f.cell.querySelector('input, textarea'); input.value = 'Confirmed'; input.blur(); await settle();
    expect(JSON.parse(request.mock.calls[1][1].body_data.value)).toEqual({ en: 'Confirmed' });
    expect(hasOpenInlineEditor('orders')).toBe(false);
});

test.each([['text', null], ['integer', null], ['integer', '']])(
    'an unchanged %s editor opened on %s saves nothing on blur or Escape', async (type, value) => {
        for (const ending of ['blur', 'Escape']) {
            const f = fixture({ type, value }); await f.open();
            const input = f.cell.querySelector('input');
            if (ending === 'Escape') {
                input.value = type === 'integer' ? '55' : 'Unconfirmed';
                input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
            } else input.blur();
            await settle();
            expect(request).not.toHaveBeenCalled(); expect(hasOpenInlineEditor('orders')).toBe(false);
            f.cell.closest('table').remove();
        }
    }
);
