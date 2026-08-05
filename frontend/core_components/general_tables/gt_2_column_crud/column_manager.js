// column_manager.js
// Manages adding, renaming, type-editing, and deleting columns on an existing table via a modal dialog.
// Bridges column-fetching, endpoint routing, confirmation modals, and toast notifications into one column-management panel.
// Exists to centralise all column-level DDL interactions so the toolbar can expose them through a single entry point.

import { createModal, showModal, hideModal } from '../../../reusable_components/modal/modal_builder.js';
import { fetch_columns_for_table } from '../../endpoints/endpoint_column_fetcher.js';
import { endpoint_router } from '../../endpoints/endpoint_router.js';
import { isValidIdentifier } from '../../../reusable_components/dom_container_builder.js';
import { showSuccessToast, showWarningToast } from '../../../reusable_components/notifications/toast_notification_printer.js';
import { drop_table } from '../gt_3_table_crud/gt_3_2_table_delete/table_remover.js';
import { getTranslationForKey } from '../../lang/translation_handler.js';
import { refreshTableUnified } from '../gt_1_row_crud/gt_1_2_row_read/table_refresh_unified.js';
import { getUnifiedTableState, setUnifiedTableState } from '../../state_stores/table_state_store.js';
import { getHiddenColumns } from '../../filterbar/filter_list/column_visibility_handler.js';
import { getOpenedFilters, saveOpenedFilters } from '../../filterbar/filterbar_engine/filterbar_state_saver.js';

/**
 * Rewrites persisted dataset UI state after schema changes remove or rename columns.
 * Keeps sort/filter/visibility UI storage aligned with the latest column names.
 * Exists so column-management saves can stay inside the SPA shell without stale localStorage keys.
 * @param {string} key
 * @param {Set<string>} removedSet
 * @param {Record<string, string>} renameIndex
 * @returns {string | null}
 */
function rewriteStoredFilterKey(key, removedSet, renameIndex) {
    let suffix = '';
    let baseKey = key;

    if (key.endsWith('_from')) {
        suffix = '_from';
        baseKey = key.slice(0, -suffix.length);
    } else if (key.endsWith('_to')) {
        suffix = '_to';
        baseKey = key.slice(0, -suffix.length);
    }

    if (removedSet.has(baseKey)) {
        return null;
    }

    return `${renameIndex[baseKey] || baseKey}${suffix}`;
}

/**
 * Rewrites persisted dataset UI state after schema changes remove or rename columns.
 * Keeps sort/filter/visibility UI storage aligned with the latest column names.
 * Exists so column-management saves can stay inside the SPA shell without stale localStorage keys.
 * @param {string} tableName
 * @param {string[]} removedColumns
 * @param {{ old_name: string, new_name: string }[]} renamedMap
 */
function purgeStaleColumnState(tableName, removedColumns, renamedMap) {
    if (!removedColumns.length && !renamedMap.length) return;

    const removedSet = new Set(removedColumns);
    const renameIndex = Object.fromEntries(renamedMap.map(r => [r.old_name, r.new_name]));

    // --- A. Unified table state (sort + filters) ---
    const state = getUnifiedTableState(tableName);
    let stateChanged = false;

    if (state.sort && state.sort.column) {
        if (removedSet.has(state.sort.column)) {
            state.sort.column = null;
            state.sort.direction = null;
            stateChanged = true;
        } else if (renameIndex[state.sort.column]) {
            state.sort.column = renameIndex[state.sort.column];
            stateChanged = true;
        }
    }

    if (state.filters) {
        const nextFilters = {};
        for (const [key, value] of Object.entries(state.filters)) {
            const nextKey = rewriteStoredFilterKey(key, removedSet, renameIndex);
            if (!nextKey) {
                stateChanged = true;
                continue;
            }
            if (nextKey !== key) {
                stateChanged = true;
            }
            nextFilters[nextKey] = value;
        }
        state.filters = nextFilters;
    }

    if (stateChanged) {
        state.offset = 0;
        setUnifiedTableState(tableName, state);
    }

    // --- B. Hidden columns ---
    const hiddenMap = getHiddenColumns(tableName);
    let hiddenChanged = false;

    for (const col of removedColumns) {
        if (hiddenMap[col]) {
            delete hiddenMap[col];
            hiddenChanged = true;
        }
    }
    for (const { old_name, new_name } of renamedMap) {
        if (hiddenMap[old_name]) {
            hiddenMap[new_name] = true;
            delete hiddenMap[old_name];
            hiddenChanged = true;
        }
    }

    if (hiddenChanged) {
        localStorage.setItem(`${tableName}_hide_columns`, JSON.stringify(hiddenMap));
    }

    // --- C. Open filters ---
    const openFilters = getOpenedFilters(tableName);
    const seenFilters = new Set();
    const updatedFilters = [];
    let openFiltersChanged = false;

    for (const filterName of openFilters) {
        if (removedSet.has(filterName)) {
            openFiltersChanged = true;
            continue;
        }

        const nextFilterName = renameIndex[filterName] || filterName;
        if (nextFilterName !== filterName || seenFilters.has(nextFilterName)) {
            openFiltersChanged = true;
        }
        if (seenFilters.has(nextFilterName)) {
            continue;
        }

        seenFilters.add(nextFilterName);
        updatedFilters.push(nextFilterName);
    }

    if (openFiltersChanged) {
        saveOpenedFilters(tableName, updatedFilters);
    }
}

export async function open_column_management_modal(table_name) {
    const columns = await fetch_columns_for_table(table_name);

    // Muunna character varying -> VARCHAR
    columns.forEach(col => {
        if (col.data_type.toLowerCase() === "character varying") {
            col.data_type = "VARCHAR";
        }
    });

    const initial_columns = columns.map(col => ({
        column_name: col.column_name,
        data_type: col.data_type.toUpperCase(),
        length: col.character_maximum_length || ''
    }));

    // Käytetään vain yhtä "form"-elementtiä pääkontainerina:
    const form = document.createElement('form');
    form.id = `column_management_form_${table_name}`;
    form.classList.add('column_management_forms');
    form.style.display = 'grid';
    form.style.gridTemplateColumns = '1fr';
    form.style.gridGap = '10px';
    form.style.backgroundColor = 'var(--bg_color)';
    form.style.color = 'var(--text_color)';
    form.style.border = '1px solid var(--border_color)';
    form.style.padding = '10px';

    const allowedTypes = ['INTEGER', 'VARCHAR', 'TEXT', 'BOOLEAN', 'DATE'];

    function createColumnRow(column_name_value, data_type_value, length_value, original = true) {
        const row = document.createElement('div');
        row.classList.add('column-row');
        row.style.display = 'grid';
        row.style.gridTemplateColumns = '1fr 1fr';
        row.style.gridGap = '5px';
        row.style.border = '1px solid var(--table_border_color)';
        row.style.padding = '5px';

        // Asetetaan suhteellinen asemointi, jotta poistonappi voidaan ankkuroida oikeaan yläkulmaan:
        row.style.position = 'relative';

        // Nimi
        const nameLabel = document.createElement('label');
        nameLabel.textContent = getTranslationForKey('name') || 'Nimi: ';
        const nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.name = 'column_name';
        nameInput.value = column_name_value || '';
        if (original) {
            nameInput.dataset.originalName = column_name_value;
        }
        nameLabel.appendChild(nameInput);
        row.appendChild(nameLabel);

        // Tietotyyppi
        const typeLabel = document.createElement('label');
        typeLabel.textContent = getTranslationForKey('data_type') || ' Tietotyyppi: ';
        const typeSelect = document.createElement('select');
        typeSelect.name = 'data_type';

        const emptyOpt = document.createElement('option');
        emptyOpt.value = '';
        emptyOpt.textContent = getTranslationForKey('select') || '--Valitse--';
        typeSelect.appendChild(emptyOpt);

        allowedTypes.forEach(t => {
            const opt = document.createElement('option');
            opt.value = t;
            opt.textContent = t;
            if (data_type_value && t === data_type_value.toUpperCase()) {
                opt.selected = true;
            }
            typeSelect.appendChild(opt);
        });

        typeLabel.appendChild(typeSelect);
        row.appendChild(typeLabel);

        // Pituus (vain VARCHAR)
        const lengthLabel = document.createElement('label');
        lengthLabel.textContent = getTranslationForKey('length_varchar_only') || 'Pituus (vain VARCHAR): ';
        const lengthInput = document.createElement('input');
        lengthInput.type = 'number';
        lengthInput.name = 'length';
        lengthInput.value = length_value || '';
        lengthLabel.appendChild(lengthInput);
        row.appendChild(lengthLabel);

        // Piilotetaan pituuskenttä, jos tyyppi ei ole VARCHAR
        if (data_type_value !== 'VARCHAR') {
            lengthLabel.style.display = 'none';
        }
        typeSelect.addEventListener('change', () => {
            if (typeSelect.value === 'VARCHAR') {
                lengthLabel.style.display = 'block';
            } else {
                lengthLabel.style.display = 'none';
                lengthInput.value = '';
            }
        });

        // Poista-painike (punainen rasti, aina divin oikeassa yläkulmassa, näkyy hoveroitaessa)
        const removeButton = document.createElement('button');
        removeButton.type = 'button';
        removeButton.textContent = '×';
        removeButton.style.position = 'absolute';
        removeButton.style.top = '5px';
        removeButton.style.right = '5px';
        removeButton.style.color = 'red';
        removeButton.style.border = 'none';
        removeButton.style.backgroundColor = 'transparent';
        removeButton.style.fontSize = '18px';
        removeButton.style.cursor = 'pointer';
        removeButton.style.opacity = '0';
        removeButton.style.transition = 'opacity 0.2s';

        // Näytä rasti hoverissa, piilota kun ei hover
        row.addEventListener('mouseenter', () => {
            removeButton.style.opacity = '1';
        });
        row.addEventListener('mouseleave', () => {
            removeButton.style.opacity = '0';
        });

        removeButton.addEventListener('click', () => {
            row.remove();
        });
        row.appendChild(removeButton);

        return row;
    }

    // Luo rivit olemassa oleville sarakkeille
    columns.forEach(col => {
        const dt = allowedTypes.includes(col.data_type.toUpperCase()) ? col.data_type : '';
        const r = createColumnRow(col.column_name, dt, col.character_maximum_length, true);
        form.appendChild(r);
    });

    // Luo ensimmäinen tyhjä uusi sarake -rivi
    const initialNewRow = createColumnRow('', '', '', false);
    form.appendChild(initialNewRow);

    // Lisää uusi sarake -painike
    const addRowButton = document.createElement('button');
    addRowButton.type = 'button';
    addRowButton.dataset.langKey = 'add_new_column';
    addRowButton.style.backgroundColor = 'var(--button_bg_color)';
    addRowButton.style.color = 'var(--button_text_color)';
    addRowButton.addEventListener('mouseenter', () => {
        addRowButton.style.backgroundColor = 'var(--button_hover_bg_color)';
        addRowButton.style.color = 'var(--button_hover_text_color)';
    });
    addRowButton.addEventListener('mouseleave', () => {
        addRowButton.style.backgroundColor = 'var(--button_bg_color)';
        addRowButton.style.color = 'var(--button_text_color)';
    });
    addRowButton.addEventListener('click', () => {
        const newRow = createColumnRow('', '', '', false);
        form.insertBefore(newRow, addRowButton);
    });
    form.appendChild(addRowButton);

    // Kolme nappia: Peruuta, Tallenna, Poista taulu
    const buttonRow = document.createElement('div');
    buttonRow.classList.add('form-actions');

    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.dataset.langKey = 'cancel';
    cancelButton.classList.add('cancel-button');
    cancelButton.addEventListener('click', () => {
        hideModal();
    });
    buttonRow.appendChild(cancelButton);

    const saveButton = document.createElement('button');
    saveButton.type = 'submit';
    saveButton.dataset.langKey = 'save_changes';
    saveButton.classList.add('submit-button');
    buttonRow.appendChild(saveButton);

    const deleteTableButton = document.createElement('button');
    deleteTableButton.type = 'button';
    deleteTableButton.dataset.testid = 'btn-delete-table';
    deleteTableButton.dataset.langKey = 'delete_the_whole_table';
    deleteTableButton.classList.add('danger-button');
    deleteTableButton.addEventListener('click', () => drop_table(table_name));
    buttonRow.appendChild(deleteTableButton);

    form.appendChild(buttonRow);

    createModal({
        // Näytetään otsikko vain data-lang-keyllä:
        titleDataLangKey: `manage_table+${table_name}`,
        contentElements: [form],
        maxWidth: '768px'
    });
    showModal();

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const currentRows = form.querySelectorAll('.column-row');
        const currentColumns = [];

        let invalidInput = false;
        currentRows.forEach(r => {
            const nameInput = r.querySelector('input[name="column_name"]');
            const typeSelect = r.querySelector('select[name="data_type"]');
            const lengthInput = r.querySelector('input[name="length"]');

            const newName = nameInput.value.trim();
            if (newName && !isValidIdentifier(newName)) {
                showWarningToast(getTranslationForKey('invalid_column_name') || `Virheellinen sarakenimi "${newName}". Käytä vain a-z, A-Z, numeroita ja alaviivaa.`);
                invalidInput = true;
                return;
            }

            currentColumns.push({
                original_name: nameInput.dataset.originalName || null,
                new_name: newName,
                data_type: typeSelect.value,
                length: lengthInput.value ? parseInt(lengthInput.value, 10) : null
            });
        });
        if (invalidInput) {
            return;
        }

        const removed_columns = [];
        const modified_columns = [];
        const added_columns = [];

        // Alkuperäiset sarakkeet
        for (const initCol of initial_columns) {
            const found = currentColumns.find(c => c.original_name === initCol.column_name);
            if (!found) {
                removed_columns.push(initCol.column_name);
            } else {
                const changedName = found.original_name !== found.new_name;
                let changedType = false;

                if (found.data_type && found.data_type !== initCol.data_type) {
                    changedType = true;
                } else if (initCol.data_type === 'VARCHAR') {
                    const origLen = initCol.length === '' ? null : parseInt(initCol.length, 10);
                    const newLen = found.length;
                    if (origLen !== newLen) {
                        changedType = true;
                    }
                }

                if ((changedName || changedType) && found.data_type !== '') {
                    modified_columns.push({
                        original_name: found.original_name,
                        new_name: found.new_name,
                        data_type: found.data_type,
                        length: found.data_type.toUpperCase() === 'VARCHAR' ? found.length : null
                    });
                }
            }
        }

        // Uudet sarakkeet
        for (const currCol of currentColumns) {
            if (!currCol.original_name && currCol.new_name !== '' && currCol.data_type !== '') {
                added_columns.push({
                    original_name: "",
                    new_name: currCol.new_name,
                    data_type: currCol.data_type,
                    length: currCol.data_type.toUpperCase() === 'VARCHAR' ? currCol.length : null
                });
            }
        }

        const requestData = {
            dataset_name: table_name,
            modified_columns: modified_columns,
            added_columns: added_columns,
            removed_columns: removed_columns
        };


        try {
            await endpoint_router('modifyColumns', {
                method: 'POST',
                body_data: requestData
            });

            showSuccessToast(getTranslationForKey('changes_saved_successfully') || 'Muutokset tallennettu onnistuneesti.');
            hideModal();

            const renamedMap = modified_columns
                .filter(c => c.original_name !== c.new_name)
                .map(c => ({ old_name: c.original_name, new_name: c.new_name }));
            purgeStaleColumnState(table_name, removed_columns, renamedMap);

            await refreshTableUnified(table_name, { skipUrlParams: true });

        } catch (error) {
            console.warn('Virhe tallennettaessa muutoksia:', error);
        }
    });
}
