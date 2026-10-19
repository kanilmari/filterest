// checkbox_table_features.js
// Adds opt-in grouped rows, identity-based ordering and computed boolean controls.
// Connects the table renderer to translated caller copy without changing legacy DOM.
import { deepClone, normalizeCheckboxState, toRenderableNode, toRowIdentifier } from './checkbox_table_values.js';

let nextTableIdentity = 0;

export function createCheckboxTableFeatures(options, state, root, table) {
    const { rowGroupKey, rowGroups = [], rowHeaderKey, reorder, cellAccessibleName,
        isCellSupported, renderUnsupportedCell, toolbar } = options;
    const rowIdKey = options.rowIdKey || 'id';
    const enabled = Boolean(rowGroupKey || rowHeaderKey || reorder || cellAccessibleName || isCellSupported ||
        state.columns.some(column => column.rowToggle || column.isCellSupported));
    const prefix = `vct-${++nextTableIdentity}`;
    const groups = new Map();
    let filter = null;
    let announcement;
    let filterHint;
    const frozen = () => options.baselinePolicy === 'verified-result' && state.saving;
    const id = row => toRowIdentifier(row, rowIdKey);
    const group = row => row?.[rowGroupKey];
    const order = rows => rows.map(id);
    const groupLabel = row => rowGroups.find(item => item.key === group(row))?.label || '';
    const context = (row, column) => ({ row, column, rowIndex: state.rows.findIndex(item => id(item) === id(row)),
        group: group(row), groupLabel: groupLabel(row), value: row[column.key], isEditMode: state.editing });

    if (toolbar === 'external') root.querySelector('.vct-toolbar').remove();
    if (enabled) root.classList.add('vct-features');
    if (reorder) {
        if (!reorder.labels?.up || !reorder.labels?.down || !reorder.labels?.position || !reorder.labels?.filtered) {
            throw new Error('Reordering requires translated up, down, position and filtered labels.');
        }
        announcement = document.createElement('span');
        announcement.className = 'vct-announcement';
        announcement.setAttribute('role', 'status');
        announcement.setAttribute('aria-live', 'polite');
        root.appendChild(announcement);
        filterHint = document.createElement('span');
        filterHint.id = `${prefix}-filter-hint`;
        filterHint.className = 'vct-filter-hint';
        filterHint.hidden = true;
        filterHint.textContent = reorder.labels.filtered;
        root.appendChild(filterHint);
    }

    function supported(row, column) {
        return !(column.isCellSupported || isCellSupported) ||
            Boolean((column.isCellSupported || isCellSupported)(context(row, column)));
    }
    function writable(row, column) {
        return Boolean(row) && state.editing && column.editable && !column.rowToggle && supported(row, column) &&
            !state.disabled(row, state.rows.indexOf(row), column) && !frozen();
    }
    function unsupported(row, column) {
        if (typeof renderUnsupportedCell !== 'function') {
            throw new Error('Unsupported cells require a translated renderUnsupportedCell.');
        }
        return toRenderableNode(renderUnsupportedCell(context(row, column)));
    }
    function toggleState(row, column) {
        const cells = column.rowToggle.columns.map(key => state.columns.find(item => item.key === key))
            .filter(item => item && !item.rowToggle && supported(row, item));
        const values = cells.map(item => normalizeCheckboxState(row[item.key]));
        return { cells, checked: values.length > 0 && values.every(value => value === 'checked'),
            mixed: values.includes('ambiguous') || (values.includes('checked') && values.includes('unchecked')),
            disabled: !cells.some(item => writable(row, item)) };
    }
    function toggle(row, column) {
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.className = 'vct-input-checkbox vct-row-toggle';
        input.dataset.columnKey = column.key;
        input.dataset.rowId = id(row);
        const current = toggleState(row, column);
        Object.assign(input, { checked: current.checked, indeterminate: current.mixed, disabled: current.disabled });
        input.addEventListener('change', () => {
            const currentRow = state.rows.find(item => id(item) === input.dataset.rowId);
            if (!currentRow) return;
            const aggregate = toggleState(currentRow, column);
            if (!aggregate.disabled) {
                aggregate.cells.filter(item => writable(currentRow, item)).forEach(item => {
                    currentRow[item.key] = !aggregate.checked;
                });
                state.recompute();
                state.render();
                root.querySelectorAll('.vct-row-toggle').forEach(node => {
                    if (node.dataset.rowId === id(currentRow) && node.dataset.columnKey === column.key) node.focus();
                });
            }
        });
        return input;
    }
    function refreshToggles() {
        root.querySelectorAll('.vct-row-toggle').forEach(input => {
            const row = state.rows.find(item => id(item) === input.dataset.rowId);
            const column = state.columns.find(item => item.key === input.dataset.columnKey);
            if (!row || !column) return;
            const current = toggleState(row, column);
            Object.assign(input, { checked: current.checked, indeterminate: current.mixed, disabled: current.disabled });
        });
    }
    function movable(row, delta) {
        if (!reorder || !state.editing || frozen() || filter || !row || group(row) !== reorder.group) return false;
        const index = state.rows.indexOf(row);
        const neighbour = state.rows[index + delta];
        return Boolean(neighbour && group(neighbour) === group(row));
    }
    function refreshMoves() {
        root.querySelectorAll('.vct-move').forEach(button => {
            const row = state.rows.find(item => id(item) === button.dataset.rowId);
            button.setAttribute('aria-disabled', String(!movable(row, Number(button.dataset.delta))));
            if (filter) {
                button.setAttribute('aria-describedby', filterHint.id);
                button.title = reorder.labels.filtered;
            } else {
                button.removeAttribute('aria-describedby');
                button.removeAttribute('title');
            }
        });
    }
    function moveRow(rowId, delta) {
        if (delta !== -1 && delta !== 1) return false;
        const row = state.rows.find(item => id(item) === String(rowId));
        if (!movable(row, delta)) return false;
        const index = state.rows.indexOf(row);
        [state.rows[index], state.rows[index + delta]] = [state.rows[index + delta], state.rows[index]];
        const active = document.activeElement;
        const nodes = new Map([...table.querySelectorAll('.vct-row')].map(node => [node.dataset.rowId, node]));
        state.rows.forEach(item => {
            const node = nodes.get(id(item));
            node?.parentElement.appendChild(node);
        });
        if (active instanceof HTMLElement && active.isConnected) active.focus();
        reorder.onChange?.({ rowId: id(row), order: deepClone(order(state.rows)) });
        const peers = state.rows.filter(item => group(item) === group(row));
        const values = { name: row[rowHeaderKey || reorder.inColumn], position: peers.indexOf(row) + 1, count: peers.length };
        announcement.textContent = typeof reorder.labels.position === 'function' ? reorder.labels.position(values) :
            reorder.labels.position.replace(/\{(name|position|count)\}/g, (_, key) => String(values[key]));
        state.recompute();
        refreshMoves();
        return true;
    }
    function decorateCell(cell, row, column) {
        if (enabled) cell.querySelectorAll('input[type="checkbox"]').forEach(input => {
            if (input.closest('label')) return;
            const target = document.createElement('label');
            target.className = 'vct-control-target';
            input.replaceWith(target);
            target.appendChild(input);
        });
        if (column.key === rowHeaderKey) cell.setAttribute('scope', 'row');
        if (cellAccessibleName) {
            const label = cellAccessibleName(context(row, column));
            cell.querySelectorAll('input, select, textarea, button').forEach(control => control.setAttribute('aria-label', label));
        }
        if (!reorder || column.key !== reorder.inColumn || group(row) !== reorder.group) return;
        for (const [delta, label] of [[-1, reorder.labels.up], [1, reorder.labels.down]]) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'vct-move';
            button.dataset.rowId = id(row);
            button.dataset.delta = String(delta);
            button.textContent = label;
            button.setAttribute('aria-label', `${label}: ${row[rowHeaderKey || column.key]}`);
            // Native buttons provide Enter and Space activation. No numeric index is captured.
            button.addEventListener('click', () => moveRow(button.dataset.rowId, delta));
            cell.appendChild(button);
        }
    }
    function appendRow(node, row, fallbackBody) {
        if (!rowGroupKey) { fallbackBody.appendChild(node); return; }
        fallbackBody.remove();
        const key = group(row);
        if (!groups.has(key)) {
            const body = document.createElement('tbody');
            const labelRow = document.createElement('tr');
            const label = document.createElement('th');
            label.id = `${prefix}-group-${groups.size}`;
            label.scope = 'rowgroup';
            label.colSpan = state.columns.length;
            label.textContent = groupLabel(row);
            labelRow.className = 'vct-group-label';
            labelRow.appendChild(label);
            body.setAttribute('aria-labelledby', label.id);
            body.appendChild(labelRow);
            groups.set(key, body);
        }
        groups.get(key).appendChild(node);
    }
    return {
        enabled, supported, writable, unsupported, toggle, refreshToggles, moveRow,
        orderChanged: () => Boolean(reorder) && JSON.stringify(order(state.rows)) !== JSON.stringify(order(state.base)),
        decorateCell,
        decorateHead() {
            if (rowGroupKey || rowHeaderKey || cellAccessibleName) table.querySelectorAll('thead th').forEach(node => node.scope = 'col');
        },
        clearGroups() { groups.forEach(body => body.remove()); groups.clear(); },
        appendRow,
        finishBody() {
            if (!enabled) return;
            const keys = [...rowGroups.map(item => item.key), ...groups.keys()];
            [...new Set(keys)].forEach(key => { if (groups.has(key)) table.appendChild(groups.get(key)); });
            table.querySelectorAll('.vct-row').forEach(node => {
                const row = state.rows.find(item => id(item) === node.dataset.rowId);
                node.hidden = Boolean(filter && !filter(row));
            });
            refreshMoves();
        },
        setRowFilter(predicate) {
            filter = typeof predicate === 'function' ? predicate : null;
            if (filterHint) filterHint.hidden = !filter;
            // Visibility only: neither rows nor the baseline are replaced.
            table.querySelectorAll('.vct-row').forEach(node => {
                const row = state.rows.find(item => id(item) === node.dataset.rowId);
                node.hidden = Boolean(filter && !filter(row));
            });
            refreshMoves();
        },
    };
}
