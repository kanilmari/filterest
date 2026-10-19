// checkbox_table_features.test.js
// Proves the opt-in settings matrix while the companion suite pins legacy output.
// Exercises identity, aggregate controls and revision-bound save/recovery boundaries.
// @vitest-environment jsdom
import { beforeEach, expect, test, vi } from 'vitest';
import { createVanillaCheckboxTable } from './vanilla_checkbox_table.js';

const rows = () => [
    { id: 'a', kind: 'fields', name: 'Otsikko UID:a', a: true, b: false, c: true },
    { id: 'b', kind: 'fields', name: '摘要 UID:b', a: false, b: false, c: false },
    { id: 'details', kind: 'blocks', name: 'Tiedot', a: true },
];
const columns = () => [
    { key: 'name', label: 'Kenttä', type: 'static' },
    ...['a', 'b', 'c'].map(key => ({ key, label: key.toUpperCase(), type: 'checkbox',
        isCellSupported: ({ row }) => row.kind === 'fields' || key === 'a',
        isCellDisabled: ({ row }) => row.readonly === true })),
    { key: 'all', label: 'Valitse kaikki', rowToggle: { columns: ['a', 'b', 'c'] } },
];
const context = { actorID: 4, datasetUID: '101', target: ['site'], family: 'article', revisions: { site: 'r1' } };
let host;
beforeEach(() => { localStorage.clear(); document.body.innerHTML = ''; host = document.body.appendChild(document.createElement('div')); });
function setup(extra = {}) {
    return createVanillaCheckboxTable({ containerElement: host, rows: rows(), columns: columns(),
        rowGroupKey: 'kind', rowGroups: [{ key: 'fields', label: 'Kentät' }, { key: 'blocks', label: 'Lohkot' }],
        rowHeaderKey: 'name', startInEditMode: true,
        reorder: { group: 'fields', inColumn: 'name', labels: { up: 'Ylös', down: 'Alas',
            filtered: 'Poista suodatin siirtääksesi', position: '{name}: sijainti {position}/{count}' } },
        cellAccessibleName: ({ groupLabel, row, column }) => `${groupLabel}, ${row.name}, ${column.label}, Näkyvissä`,
        renderUnsupportedCell: () => {
            const dash = document.createElement('span'); dash.textContent = '—'; dash.setAttribute('aria-label', 'Ei tuettu'); return dash;
        }, ...extra });
}
const rowNode = id => [...host.querySelectorAll('.vct-row')].find(node => node.dataset.rowId === id);
const checkbox = (id, key) => rowNode(id).querySelector(`[aria-label$="${key.toUpperCase()}, Näkyvissä"]`);
const toggle = id => rowNode(id).querySelector('.vct-row-toggle');
function change(id, key, value) {
    const node = checkbox(id, key); node.checked = value; node.dispatchEvent(new Event('change', { bubbles: true }));
}
function verifiedResult(payload) {
    return { rows: payload.rows, context: payload.context, revisions: { site: 'r2' }, metadata: payload.metadata };
}

test.each(Array.from({ length: 8 }, (_, mask) => [mask, [Boolean(mask & 4), Boolean(mask & 2), Boolean(mask & 1)]]))(
    'computed row toggle for three-cell combination %i', (_mask, values) => {
        const table = setup({ rows: [{ ...rows()[0], a: values[0], b: values[1], c: values[2] }] });
        expect(toggle('a').checked).toBe(values.every(Boolean));
        expect(toggle('a').indeterminate).toBe(values.some(Boolean) && !values.every(Boolean));
        toggle('a').click();
        expect(['a', 'b', 'c'].map(key => table.getRows({ draft: true })[0][key])).toEqual(values.map(() => !values.every(Boolean)));
        expect(table.getRows({ draft: true })[0]).not.toHaveProperty('all');
        expect(table.getChangeSet().changedCells.every(cell => cell.columnKey !== 'all')).toBe(true);
    });

test('supports a single-cell block, read-only rows and disabled supported cells', () => {
    const table = setup({ rows: [rows()[2], { ...rows()[0], readonly: true }] });
    expect(rowNode('details').querySelectorAll('input')).toHaveLength(2);
    expect(rowNode('details').querySelectorAll('[aria-label="Ei tuettu"]')).toHaveLength(2);
    expect(toggle('details').checked).toBe(true);
    toggle('details').click();
    expect(table.getRows({ draft: true })[0].a).toBe(false);
    expect(table.getRows({ draft: true })[0]).not.toHaveProperty('b');
    expect(toggle('a').disabled).toBe(true);
    expect(toggle('a').indeterminate).toBe(true);
});

test('aggregate includes mixed values but writes only supported enabled real cells and refreshes', () => {
    const cols = columns(); cols[2].isCellDisabled = () => true;
    const table = setup({ columns: cols, rows: [{ ...rows()[0], a: 'ambiguous' }] });
    expect(toggle('a').indeterminate).toBe(true);
    toggle('a').click();
    expect(table.getRows({ draft: true })[0]).toMatchObject({ a: true, b: false, c: true });
    change('a', 'a', false);
    expect(toggle('a').indeterminate).toBe(true);
    table.setColumnValues('b', true);
    expect(table.getRows({ draft: true })[0].b).toBe(false);
});

test('one native table has labelled groups, row headers and caller accessible names', () => {
    setup({ toolbar: 'external' });
    expect(host.querySelectorAll('table')).toHaveLength(1);
    expect(host.querySelector('.vct-toolbar')).toBeNull();
    const groups = [...host.querySelectorAll('tbody')];
    expect(groups).toHaveLength(2);
    expect(groups.map(group => document.getElementById(group.getAttribute('aria-labelledby')).textContent)).toEqual(['Kentät', 'Lohkot']);
    expect(rowNode('a').querySelector('th').scope).toBe('row');
    expect(checkbox('a', 'a').getAttribute('aria-label')).toBe('Kentät, Otsikko UID:a, A, Näkyvissä');
});

test('moves existing nodes by identity, retains boundary focus and edits the moved row', () => {
    const table = setup();
    const node = rowNode('a'), input = checkbox('a', 'b');
    const down = node.querySelector('[data-delta="1"]'); down.focus(); down.click();
    expect(document.activeElement).toBe(down);
    expect(rowNode('a')).toBe(node);
    expect(down.getAttribute('aria-disabled')).toBe('true');
    expect(table.moveRow('a', 1)).toBe(false);
    expect(table.moveRow('details', -1)).toBe(false);
    expect(table.moveRow('a', -2)).toBe(false);
    expect(host.querySelector('[role="status"]').textContent).toBe('Otsikko UID:a: sijainti 2/2');
    input.checked = true; input.dispatchEvent(new Event('change'));
    expect(table.getRows({ draft: true }).find(row => row.id === 'a').b).toBe(true);
    expect(table.getRows({ draft: true }).find(row => row.id === 'b').b).toBe(false);
});

test('custom input callbacks resolve stable IDs after a move', () => {
    let update;
    const cols = columns(); cols[1].renderEditableCell = ({ row, updateValue }) => {
        if (row.id === 'a') update = updateValue;
        return document.createElement('input');
    };
    const table = setup({ columns: cols }); table.moveRow('a', 1); update(false);
    expect(table.getChangeSet().changedCells).toEqual([{ rowId: 'a', columnKey: 'a', previousValue: true, nextValue: false }]);
});

test('order-only change is dirty; Cancel restores baseline order', () => {
    const table = setup(); table.moveRow('a', 1);
    expect(table.isDirty()).toBe(true); expect(table.getChangeSet().changedCells).toEqual([]);
    table.cancelChanges(); expect(table.isDirty()).toBe(false);
    expect(table.getRows({ draft: true }).map(row => row.id)).toEqual(['a', 'b', 'details']);
});

test('filter only changes node visibility, retains edits and explains disabled ordering', () => {
    const table = setup(); change('b', 'a', true);
    const node = rowNode('b'); table.setRowFilter(row => row.kind === 'blocks' || row.id === 'a');
    expect(rowNode('b')).toBe(node); expect(node.hidden).toBe(true);
    expect(table.getRows({ draft: true }).find(row => row.id === 'b').a).toBe(true);
    expect(table.moveRow('a', 1)).toBe(false);
    const button = rowNode('a').querySelector('.vct-move');
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(document.getElementById(button.getAttribute('aria-describedby')).textContent).toBe('Poista suodatin siirtääksesi');
    table.setRowFilter(null); expect(rowNode('b').hidden).toBe(false); expect(table.moveRow('a', 1)).toBe(true);
});

test('version-2 recovery keeps order, cell and metadata intents through disposal; Cancel clears', () => {
    const table = setup({ draftContext: context, draftMetadata: { priority: 1 }, storageKey: 'v2' });
    table.moveRow('a', 1); change('a', 'b', true); table.setDraftMetadata({ priority: 2 });
    const saved = JSON.parse(localStorage.getItem('v2'));
    expect(saved).toMatchObject({ version: 2, context: { actorID: 4, target: ['site'] }, revisions: { site: 'r1' }, metadata: { priority: 2 } });
    expect(saved).not.toHaveProperty('draftRows'); table.destroy(); expect(localStorage.getItem('v2')).not.toBeNull();
    const recovered = setup({ draftContext: context, draftMetadata: { priority: 1 }, storageKey: 'v2' });
    expect(recovered.getRecoveryState().status).toBe('recovered');
    expect(recovered.getChangeSet()).toMatchObject({ order: ['b', 'a', 'details'], metadata: { priority: 2 } });
    expect(recovered.isDirty()).toBe(true); recovered.cancelChanges();
    expect(recovered.getChangeSet().metadata).toEqual({ priority: 1 }); expect(localStorage.getItem('v2')).toBeNull();
});

function savedDraft() {
    const table = setup({ draftContext: context, storageKey: 'v2' });
    change('a', 'b', true); table.destroy(); return JSON.parse(localStorage.getItem('v2'));
}

test('stale revisions need explicit reconciliation; no silent replay or loss', () => {
    const saved = savedDraft();
    const table = setup({ draftContext: { ...context, revisions: { site: 'r9' } }, storageKey: 'v2' });
    expect(table.getRecoveryState().status).toBe('revision-conflict');
    expect(table.getRows({ draft: true })[0].b).toBe(false);
    expect(JSON.parse(localStorage.getItem('v2'))).toEqual(saved);
    expect(table.reconcileDraft()).toBe(true);
    expect(table.getRows({ draft: true })[0].b).toBe(true);
});

test.each(['discard', 'Cancel'])('standalone v2 recovery restores Edit after %s', action => {
    savedDraft();
    const table = setup({ draftContext: { ...context, revisions: { site: 'r9' } },
        storageKey: 'v2', startInEditMode: false });
    const edit = host.querySelector('.vct-btn-edit');
    expect(table.getRecoveryState().status).toBe('revision-conflict');
    expect(edit.disabled).toBe(true);
    if (action === 'discard') table.reconcileDraft({ discard: true });
    else table.cancelChanges();
    expect(localStorage.getItem('v2')).toBeNull();
    expect(table.getRows({ draft: true })).toEqual(rows());
    expect(edit.disabled).toBe(false);
    edit.click();
    expect(checkbox('a', 'b').disabled).toBe(false);
    change('a', 'b', true);
    expect(table.isDirty()).toBe(true);
});

test.each([
    ['invalid-identities', saved => saved.order[0] = 'unknown'],
    ['invalid-identities', saved => saved.order[0] = 'b'],
    ['invalid-order', saved => saved.order.reverse()],
    ['invalid-cells', saved => saved.changedCells[0].columnKey = 'all'],
    ['invalid-cells', saved => { saved.changedCells[0].rowId = 'details'; saved.changedCells[0].columnKey = 'b'; }],
    ['context-mismatch', saved => saved.context.actorID = 88],
])('rejects %s before any replay', (status, mutate) => {
    const saved = savedDraft(); mutate(saved); localStorage.setItem('v2', JSON.stringify(saved));
    const table = setup({ draftContext: context, storageKey: 'v2' });
    expect(table.getRecoveryState().status).toBe(status); expect(table.getRows({ draft: true })).toEqual(rows());
    expect(() => table.reconcileDraft()).toThrow(status);
    table.cancelChanges(); expect(localStorage.getItem('v2')).toBeNull();
});

test('verified Save adopts returned rows/revisions/metadata and clears recovered draft', async () => {
    savedDraft(); const onSave = vi.fn(payload => Promise.resolve(verifiedResult(payload)));
    const table = setup({ draftContext: context, storageKey: 'v2', baselinePolicy: 'verified-result', onSave });
    expect(await table.saveChanges()).toBe(true); expect(table.isDirty()).toBe(false);
    expect(table.getChangeSet().revisions).toEqual({ site: 'r2' }); expect(localStorage.getItem('v2')).toBeNull();
});

test.each([undefined, null, { rows: [] }])('verified-result rejects absent/incomplete readback %#', async result => {
    const onSaveError = vi.fn();
    const table = setup({ draftContext: context, storageKey: 'v2', baselinePolicy: 'verified-result', onSave: () => result, onSaveError });
    change('a', 'b', true);
    await expect(table.saveChanges()).rejects.toThrow('verified-result-required');
    expect(table.getRows()[0].b).toBe(false); expect(table.isDirty()).toBe(true);
    expect(localStorage.getItem('v2')).not.toBeNull(); expect(await table.saveChanges()).toBe(false);
    expect(onSaveError).toHaveBeenCalledWith(expect.objectContaining({ committed: true }));
});

test.each(['context', 'rows', 'metadata', 'order'])('rejects mismatched verified %s', async mismatch => {
    const table = setup({ draftContext: context, baselinePolicy: 'verified-result', onSave: payload => {
        const result = verifiedResult(payload);
        if (mismatch === 'context') result.context.actorID = 5;
        if (mismatch === 'rows') result.rows[0].b = false;
        if (mismatch === 'metadata') result.metadata = { other: true };
        if (mismatch === 'order') result.rows.reverse();
        return result;
    } });
    change('a', 'b', true); await expect(table.saveChanges()).rejects.toThrow('verified-result-mismatch');
    expect(table.getRows()).toEqual(rows());
});

test('freezes controls and ignores late verified responses after fresh context and destruction', async () => {
    let resolve;
    const table = setup({ draftContext: context, baselinePolicy: 'verified-result', onSave: payload =>
        new Promise(done => { resolve = () => done(verifiedResult(payload)); }) });
    change('a', 'b', true); const pending = table.saveChanges();
    expect([...host.querySelectorAll('input')].every(input => input.disabled)).toBe(true);
    expect(table.moveRow('a', 1)).toBe(false); table.setDraftMetadata({ ignored: true }); change('a', 'c', false);
    expect(table.getRows({ draft: true })[0].c).toBe(true);
    table.setRows(rows(), { context: { ...context, datasetUID: '202' }, revisions: { site: 'new' } });
    resolve(); expect(await pending).toBe(false); expect(table.getRows()).toEqual(rows());
    table.enterEditMode(); change('a', 'b', true); const disposed = table.saveChanges(); table.destroy(); resolve();
    expect(await disposed).toBe(false); expect(host.children).toHaveLength(0);
});

test('committed verification failure retains draft and blocks retries until fresh state', async () => {
    const onSave = vi.fn().mockRejectedValue(Object.assign(new Error('GET failed'), { committed: true, code: 'verification-failed' }));
    const table = setup({ draftContext: context, storageKey: 'v2', baselinePolicy: 'verified-result', onSave });
    table.setDraftMetadata({ name: 'new' }); expect(table.isDirty()).toBe(true);
    await expect(table.saveChanges()).rejects.toThrow('GET failed');
    expect(localStorage.getItem('v2')).not.toBeNull(); await expect(table.saveChanges()).resolves.toBe(false);
    expect(onSave).toHaveBeenCalledTimes(1);
    table.setRows(rows(), { revisions: { site: 'fresh' } }); table.setDraftMetadata({ name: 'retry' });
    onSave.mockImplementation(payload => verifiedResult(payload)); expect(await table.saveChanges()).toBe(true);
});

test('uncommitted rejection permits retry and keeps the draft', async () => {
    const onSave = vi.fn().mockRejectedValueOnce(new Error('write refused')).mockImplementation(payload => verifiedResult(payload));
    const table = setup({ draftContext: context, storageKey: 'v2', baselinePolicy: 'verified-result', onSave });
    change('a', 'b', true); await expect(table.saveChanges()).rejects.toThrow('write refused');
    expect(localStorage.getItem('v2')).not.toBeNull(); expect(await table.saveChanges()).toBe(true);
});


test('an explicit order intent remains dirty when the visible order returns to its baseline', () => {
    let table;
    table = setup({ draftContext: context, draftMetadata: null,
        reorder: { group: 'fields', inColumn: 'name', labels: { up: '上移', down: '下移',
            filtered: '清除搜索', position: '{name} {position}/{count}' },
            onChange: ({ order }) => table.setDraftMetadata({ orderIntent: order }) } });
    table.moveRow('a', 1); table.moveRow('a', -1);
    expect(table.getChangeSet().order).toEqual(['a', 'b', 'details']);
    expect(table.getChangeSet().changedCells).toEqual([]);
    expect(table.isDirty()).toBe(true);
    table.cancelChanges(); expect(table.isDirty()).toBe(false); expect(table.getChangeSet().metadata).toBeNull();
});

test('a verified result must include every baseline revision dependency', async () => {
    const table = setup({ draftContext: context, baselinePolicy: 'verified-result', onSave: payload =>
        ({ ...verifiedResult(payload), revisions: {} }) });
    change('a', 'b', true); await expect(table.saveChanges()).rejects.toThrow('verified-result-mismatch');
    expect(table.getRows()).toEqual(rows());
});


test('a malformed version-2 recovery remains available for deliberate discard', () => {
    localStorage.setItem('v2', 'null');
    const table = setup({ draftContext: context, storageKey: 'v2' });
    expect(table.getRecoveryState().status).toBe('invalid-draft');
    expect(localStorage.getItem('v2')).toBe('null');
    table.reconcileDraft({ discard: true });
    expect(table.getRows({ draft: true })).toEqual(rows());
});


test('read-only identity objects are not mistaken for editable cell intents', () => {
    const table = setup({ rows: [{ ...rows()[0], name: { label: 'Otsikko', uid: 'a' } }] });
    expect(table.isDirty()).toBe(false); expect(table.getChangeSet().changedCells).toEqual([]);
    table.setColumnValues('b', true);
    expect(table.getChangeSet().changedCells).toEqual([{ rowId: 'a', columnKey: 'b', previousValue: false, nextValue: true }]);
});
