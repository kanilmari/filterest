// @vitest-environment jsdom
// dataset_column_table.test.js
// Verifies the one column table both dataset forms draw: its header row, how
// every control is named, and each row's state and stored-value rules.
// Exists so the creation page and the Manage table dialog cannot drift back
// into two ways of describing a column.
import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('../../lang/translation_handler.js', () => ({
    getTranslationForKey: (key, { fallback } = {}) => fallback ?? key,
}));

const { createDatasetColumnTable } = await import('./dataset_column_table.js');

beforeEach(() => {
    document.body.replaceChildren();
    document.documentElement.lang = 'en';
});

function mount(options) {
    const table = createDatasetColumnTable(options);
    document.body.appendChild(table.element);
    return table;
}

const control = (row, name) => row.element.querySelector(`[name="${name}"]`);

describe('dataset column table', () => {
    test('names each field once, in one header row, and every control by its header', () => {
        const table = mount({ mode: 'edit' });
        const row = table.addColumn();
        const headers = [...table.table.querySelectorAll('[role="columnheader"]')];

        expect(table.table.getAttribute('role')).toBe('table');
        expect(headers.map((cell) => cell.textContent)).toEqual([
            'Column name', 'Data type', 'Length / precision', 'Card role', 'Multilingual text column', 'Actions',
        ]);
        for (const name of ['column_name', 'data_type', 'card_role', 'is_multilingual']) {
            const header = document.getElementById(control(row, name).getAttribute('aria-labelledby'));
            expect(header?.getAttribute('role'), name).toBe('columnheader');
        }
        // Each parameter is named by its own label, and removal by its text and the column.
        expect(control(row, 'length').closest('label').textContent).toBe('Length');
        const remove = row.element.querySelector('.dataset-column-table__remove');
        expect(remove.getAttribute('aria-labelledby').split(' ')).toEqual([remove.id, control(row, 'column_name').id]);
        // Rows carry cells, not repeated labels; a name reappears only when stacked.
        expect([...row.element.children].every((cell) => cell.getAttribute('role') === 'cell')).toBe(true);
        expect(row.element.querySelector('.dataset-column-table__cell-label').getAttribute('aria-hidden')).toBe('true');
    });

    test('two tables on one page never share an identity', () => {
        const first = mount({ mode: 'create' });
        const second = mount({ mode: 'create' });
        first.addColumn();
        second.addColumn();
        const ids = [...document.querySelectorAll('[id]')].map((element) => element.id);
        expect(ids.length).toBeGreaterThan(10);
        expect(new Set(ids).size).toBe(ids.length);
        expect(first.table.querySelectorAll('[role="columnheader"]')).toHaveLength(5);
    });

    test('a row states whether it is new or existing, and untouched or changed', () => {
        const table = mount({ mode: 'edit' });
        const stored = table.addColumn({ existing: true, name: 'title', dataType: 'TEXT' });
        const added = table.addColumn();

        expect(stored.state()).toEqual({ existing: true, changed: false });
        expect(added.state()).toEqual({ existing: false, changed: false });
        expect(stored.element.dataset.rowState).toBe('existing');

        control(stored, 'column_name').value = 'heading';
        control(stored, 'column_name').dispatchEvent(new Event('input', { bubbles: true }));
        expect(stored.state().changed).toBe(true);
        expect(stored.element.dataset.rowChanged).toBe('true');

        // Once the server holds what was read, that is the row's new baseline.
        expect(stored.read()).toMatchObject({ originalName: 'title', name: 'heading' });
        stored.markSaved('heading');
        expect(stored.state()).toEqual({ existing: true, changed: false });
        expect(stored.read().originalName).toBe('heading');
    });

    test('an edit made while a save was under way stays a change', () => {
        const table = mount({ mode: 'edit' });
        const row = table.addColumn({ existing: true, name: 'title', dataType: 'TEXT' });
        control(row, 'column_name').value = 'heading';
        row.read();
        control(row, 'column_name').value = 'headline';
        row.markSaved('heading');
        expect(row.state().changed).toBe(true);
        expect(row.read()).toMatchObject({ originalName: 'heading', name: 'headline' });
    });

    test('a stored type outside the catalogue stays selected and is read unchanged', () => {
        const table = mount({ mode: 'edit' });
        const row = table.addColumn({ existing: true, name: 'created', dataType: 'timestamp without time zone' });
        expect(control(row, 'data_type').value).toBe('TIMESTAMP WITHOUT TIME ZONE');
        expect(row.read().dataType).toBe('TIMESTAMP WITHOUT TIME ZONE');
    });

    test('an untouched decimal keeps its stored precision; choosing the type fills in two numbers', () => {
        const table = mount({ mode: 'edit' });
        const row = table.addColumn({ existing: true, name: 'amount', dataType: 'NUMERIC' });
        expect(control(row, 'precision').value).toBe('');
        expect(row.read().dataType).toBe('NUMERIC');

        const type = control(row, 'data_type');
        type.value = 'TEXT';
        type.dispatchEvent(new Event('change'));
        type.value = 'NUMERIC';
        type.dispatchEvent(new Event('change'));
        expect([control(row, 'precision').value, control(row, 'scale').value]).toEqual(['12', '2']);
        expect(row.read().dataType).toBe('NUMERIC(12,2)');
    });

    test('a stored role variant is kept in editing, and creation offers only plain roles', () => {
        const editing = mount({ mode: 'edit' });
        const row = editing.addColumn({ existing: true, name: 'summary', dataType: 'TEXT', role: 'description1+lang_key' });
        expect(control(row, 'card_role').value).toBe('description1+lang_key');
        expect(row.read().roleChanged).toBe(false);
        control(row, 'card_role').value = 'header';
        expect(row.read().roleChanged).toBe(true);
        row.acceptRole('header');
        expect(row.read().roleChanged).toBe(false);

        const creating = mount({ mode: 'create' });
        const values = [...control(creating.addColumn(), 'card_role').options].map((option) => option.value);
        expect(values).not.toContain('description1+lang_key');
        expect(values).toContain('details');
    });

    test('a column being added follows the dataset default until the person sets it', () => {
        let datasetDefault = true;
        const table = mount({ mode: 'edit', multilingualDefault: () => datasetDefault });
        const first = table.addColumn({ dataType: 'TEXT' });
        const second = table.addColumn({ dataType: 'TEXT' });
        expect(control(first, 'is_multilingual').checked).toBe(true);

        control(first, 'is_multilingual').click();
        datasetDefault = false;
        table.setMultilingualDefault(false);
        expect([control(first, 'is_multilingual').checked, control(second, 'is_multilingual').checked]).toEqual([false, false]);
        table.setMultilingualDefault(true);
        expect([control(first, 'is_multilingual').checked, control(second, 'is_multilingual').checked]).toEqual([false, true]);

        // Only text columns can be multilingual.
        const type = control(second, 'data_type');
        type.value = 'DATE';
        type.dispatchEvent(new Event('change'));
        expect(control(second, 'is_multilingual').disabled).toBe(true);

        // A saved column no longer offers the choice, but its cell keeps the table aligned.
        first.read();
        first.markSaved('title');
        expect(control(first, 'is_multilingual')).toBeNull();
        expect(first.element.querySelector('.dataset-column-table__cell--multilingual')).not.toBeNull();
    });

    test('creation has no multilingual column and requires a length for limited text; editing does not', () => {
        const creating = mount({ mode: 'create' });
        const created = creating.addColumn();
        expect(control(created, 'is_multilingual')).toBeNull();
        creating.table.querySelectorAll('[role="columnheader"]').forEach((cell) => {
            expect(cell.dataset.manageTableKey).not.toBe('manage_table_column_multilingual');
        });
        const type = control(created, 'data_type');
        type.value = 'VARCHAR';
        type.dispatchEvent(new Event('change'));
        expect(control(created, 'length').required).toBe(true);

        const editing = mount({ mode: 'edit' });
        const edited = editing.addColumn({ dataType: 'VARCHAR' });
        expect(control(edited, 'length').required).toBe(false);
    });

    test('the table lists names, adds and removes rows, and starts over', () => {
        const table = mount({ mode: 'create' });
        table.addColumn({ name: 'id', dataType: 'SERIAL' });
        table.addColumn();
        table.element.querySelector('[data-testid="dataset-column-add"]').click();
        expect(table.rows()).toHaveLength(3);
        expect(table.columnNames()).toEqual(['id']);

        table.rows()[0].element.querySelector('.dataset-column-table__remove').click();
        expect(table.rows()).toHaveLength(2);
        table.clear();
        expect(table.rows()).toHaveLength(0);
        expect(table.table.querySelector('[role="columnheader"]')).not.toBeNull();
    });
});
