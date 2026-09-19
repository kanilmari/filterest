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
import { managementText, managementLabel, setManagementText, observeManagementLanguage } from './manage_table_i18n.js';
import { getDatasetUIVisibility, setDatasetUIVisibility } from './dataset_ui_visibility.js';
import { refreshTableUnified } from '../gt_1_row_crud/gt_1_2_row_read/table_refresh_unified.js';
import { invalidateDatabaseCatalogTreeCache } from '../../table_views/tree_view/tree_view_printer.js';
import { purgeStaleColumnState } from './column_manager_state_cleanup.js';
import { createDatasetDimensionPanels } from '../dataset_form/dataset_dimension_panels.js';
import { getCardRoleOptions, isValidCardRole } from '../../table_views/card_view/card_role_catalog.js';
import {
    COLUMN_TYPE_PARAMETER,
    DEFAULT_NUMERIC_PRECISION,
    DEFAULT_NUMERIC_SCALE,
    composeColumnTypeDefinition,
    findDatasetColumnType,
    getColumnTypeParameter,
    getDatasetColumnTypeOptions,
} from '../dataset_form/dataset_column_type_catalog.js';

export async function open_column_management_modal(table_name) {
    const columns = await fetch_columns_for_table(table_name);
    const declaredDefault = columns[0]?.new_columns_multilingual;
    const initialMultilingualDefault = typeof declaredDefault === 'boolean'
        ? declaredDefault : columns.some(column => column.is_multilingual === true);

    // Spell every stored type the way the shared catalogue does, so an
    // unrelated Save cannot rewrite a column merely because PostgreSQL and the
    // form use different names for the same type.
    columns.forEach(col => {
        col.data_type = findDatasetColumnType(col.data_type)?.value || col.data_type;
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

    const datasetLabel = managementLabel('manage_table_name');
    const datasetName = document.createElement('code');
    datasetName.className = 'manage-table-dataset-name';
    datasetName.textContent = table_name;
    datasetLabel.appendChild(datasetName);
    form.appendChild(datasetLabel);

    const visibilityPanel = document.createElement('section');
    visibilityPanel.className = 'manage-table-visibility';
    visibilityPanel.dataset.testid = 'manage-table-visibility';
    const visibilityStatus = setManagementText(document.createElement('p'), 'manage_table_visibility_loading');
    visibilityStatus.setAttribute('role', 'status');
    const restoreButton = setManagementText(document.createElement('button'), 'manage_table_restore');
    restoreButton.type = 'button';
    restoreButton.dataset.testid = 'manage-table-restore';
    restoreButton.hidden = true;
    visibilityPanel.append(visibilityStatus, restoreButton);
    form.appendChild(visibilityPanel);

    // Every dataset-level dimension is described once, by the controls both
    // dataset forms share, instead of being wired separately here.
    const datasetDimensions = createDatasetDimensionPanels({
        datasetName: table_name,
        columnNames: () => [...form.querySelectorAll('.column-row input[name="column_name"]')]
            .map(input => input.value.trim())
            .filter(Boolean),
    });
    form.append(...datasetDimensions.elements);

    const multilingualDefaultLabel = managementLabel('manage_table_multilingual_default');
    multilingualDefaultLabel.style.display = 'flex';
    multilingualDefaultLabel.style.alignItems = 'flex-start';
    multilingualDefaultLabel.style.gap = '8px';
    const multilingualDefaultInput = document.createElement('input');
    multilingualDefaultInput.type = 'checkbox';
    multilingualDefaultInput.dataset.testid = 'manage-table-multilingual-default';
    multilingualDefaultInput.checked = initialMultilingualDefault;
    multilingualDefaultLabel.prepend(multilingualDefaultInput);
    form.append(multilingualDefaultLabel);
    multilingualDefaultInput.addEventListener('change', () => {
        form.querySelectorAll('input[name="is_multilingual"]').forEach(input => {
            if (input.dataset.multilingualOverride !== 'true') {
                input.checked = multilingualDefaultInput.checked;
            }
        });
    });

    // The same catalogue the creation form offers, minus the types that only
    // describe how a column is born and cannot be a conversion target.
    const allowedTypeEntries = getDatasetColumnTypeOptions('edit');

    function createColumnRow(column_name_value, data_type_value, length_value, original = true, card_role_value = 'details') {
        const row = document.createElement('div');
        row.classList.add('column-row');
        const nameLabel = managementLabel('manage_table_column_name');
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
        const typeLabel = managementLabel('manage_table_data_type');
        const typeSelect = document.createElement('select');
        typeSelect.name = 'data_type';

        const emptyOpt = document.createElement('option');
        emptyOpt.value = '';
        setManagementText(emptyOpt, 'manage_table_select_type');
        typeSelect.appendChild(emptyOpt);

        const knownExistingType = findDatasetColumnType(data_type_value)?.value || '';
        allowedTypeEntries.forEach(entry => {
            const opt = document.createElement('option');
            opt.value = entry.value;
            setManagementText(opt, entry.labelKey);
            if (entry.value === knownExistingType) {
                opt.selected = true;
            }
            typeSelect.appendChild(opt);
        });

        // Existing PostgreSQL types outside the editor's creation choices must
        // remain selected, so an unrelated Save cannot reinterpret their schema.
        const existingType = String(data_type_value || '').toUpperCase();
        if (existingType && !knownExistingType) {
            const existingOption = document.createElement('option');
            existingOption.value = existingType;
            existingOption.textContent = existingType;
            existingOption.selected = true;
            typeSelect.appendChild(existingOption);
        }

        typeLabel.appendChild(typeSelect);
        row.appendChild(typeLabel);

        // Pituus (vain VARCHAR)
        const lengthLabel = managementLabel('manage_table_length');
        const lengthInput = document.createElement('input');
        lengthInput.type = 'number';
        lengthInput.name = 'length';
        lengthInput.value = length_value || '';
        lengthLabel.appendChild(lengthInput);
        row.appendChild(lengthLabel);

        // A decimal column carries its own two numbers, because the database
        // refuses a decimal type without them.
        const precisionLabel = managementLabel('dataset_column_type_precision');
        const precisionInput = document.createElement('input');
        precisionInput.type = 'number';
        precisionInput.name = 'precision';
        precisionInput.min = '1';
        precisionInput.max = '1000';
        precisionLabel.appendChild(precisionInput);
        row.appendChild(precisionLabel);

        const scaleLabel = managementLabel('dataset_column_type_scale');
        const scaleInput = document.createElement('input');
        scaleInput.type = 'number';
        scaleInput.name = 'scale';
        scaleInput.min = '0';
        scaleLabel.appendChild(scaleInput);
        row.appendChild(scaleLabel);

        // An untouched decimal column keeps its stored precision: this form
        // does not read it, so leaving the fields empty is what tells a Save
        // that nothing about the type changed.
        const syncTypeParameters = ({ prefill = false } = {}) => {
            const parameter = getColumnTypeParameter(typeSelect.value);
            const usesLength = parameter === COLUMN_TYPE_PARAMETER.LENGTH;
            const usesPrecision = parameter === COLUMN_TYPE_PARAMETER.PRECISION;
            lengthLabel.style.display = usesLength ? 'block' : 'none';
            if (!usesLength) lengthInput.value = '';
            precisionLabel.style.display = usesPrecision ? 'block' : 'none';
            scaleLabel.style.display = usesPrecision ? 'block' : 'none';
            if (!usesPrecision) {
                precisionInput.value = '';
                scaleInput.value = '';
            } else if (prefill && !precisionInput.value) {
                precisionInput.value = String(DEFAULT_NUMERIC_PRECISION);
                scaleInput.value = String(DEFAULT_NUMERIC_SCALE);
            }
        };
        typeSelect.addEventListener('change', () => syncTypeParameters({ prefill: true }));
        syncTypeParameters();

        if (!original) {
            const multilingualLabel = managementLabel('manage_table_column_multilingual');
            const multilingualInput = document.createElement('input');
            multilingualInput.type = 'checkbox';
            multilingualInput.name = 'is_multilingual';
            multilingualInput.dataset.testid = 'manage-table-new-column-multilingual';
            multilingualInput.checked = multilingualDefaultInput.checked;
            multilingualInput.style.width = 'auto';
            multilingualInput.style.justifySelf = 'start';
            multilingualInput.addEventListener('change', () => {
                multilingualInput.dataset.multilingualOverride = 'true';
            });
            multilingualLabel.append(multilingualInput);
            const syncMultilingualType = () => {
                const textColumn = ['TEXT', 'VARCHAR'].includes(typeSelect.value);
                multilingualLabel.style.display = textColumn ? 'grid' : 'none';
                multilingualInput.disabled = !textColumn;
            };
            typeSelect.addEventListener('change', syncMultilingualType);
            syncMultilingualType();
            row.append(multilingualLabel);
        }

        // How the column is presented on a card is part of the dataset's
        // definition, so it is set here as well as when the dataset is created.
        const roleLabel = managementLabel('card_role');
        const roleSelect = document.createElement('select');
        roleSelect.name = 'card_role';
        for (const { value, labelKey } of getCardRoleOptions({ includeLegacyVariants: true })) {
            const option = document.createElement('option');
            option.value = value;
            setManagementText(option, labelKey);
            roleSelect.appendChild(option);
        }
        const storedRole = String(card_role_value || 'details');
        roleSelect.value = isValidCardRole(storedRole) ? storedRole : 'details';
        if (roleSelect.value !== storedRole) roleSelect.value = 'details';
        roleSelect.dataset.originalRole = roleSelect.value;
        roleLabel.appendChild(roleSelect);
        row.appendChild(roleLabel);

        // Keep the removal control available to touch and keyboard users.
        const removeButton = document.createElement('button');
        removeButton.type = 'button';
        removeButton.textContent = '×';
        removeButton.className = 'column-remove-button';
        removeButton.dataset.manageTableAriaKey = 'manage_table_remove_column';
        removeButton.setAttribute('data-aria-label-lang-key', 'manage_table_remove_column');
        removeButton.setAttribute('aria-label', managementText('manage_table_remove_column'));

        removeButton.addEventListener('click', () => {
            row.remove();
        });
        row.appendChild(removeButton);

        return row;
    }

    // Luo rivit olemassa oleville sarakkeille
    columns.forEach(col => {
        const r = createColumnRow(
            col.column_name, col.data_type, col.character_maximum_length, true, col.card_element
        );
        form.appendChild(r);
    });

    // Luo ensimmäinen tyhjä uusi sarake -rivi
    const initialNewRow = createColumnRow('', '', '', false);
    form.appendChild(initialNewRow);

    // Lisää uusi sarake -painike
    const addRowButton = document.createElement('button');
    addRowButton.type = 'button';
    setManagementText(addRowButton, 'manage_table_add_column');
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

    // The links to other datasets sit after the columns, because a link names a
    // column of this dataset — including one this same Save is about to add.
    form.appendChild(datasetDimensions.foreignKeysElement);

    // Keep Save last and aligned to the right.
    const buttonRow = document.createElement('div');
    buttonRow.classList.add('form-actions');

    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    setManagementText(cancelButton, 'manage_table_cancel');
    cancelButton.classList.add('cancel-button');
    cancelButton.addEventListener('click', () => {
        hideModal();
    });
    buttonRow.appendChild(cancelButton);

    const saveButton = document.createElement('button');
    saveButton.type = 'submit';
    setManagementText(saveButton, 'manage_table_save');
    saveButton.dataset.testid = 'manage-table-save';
    saveButton.classList.add('submit-button');

    const deleteTableButton = document.createElement('button');
    deleteTableButton.type = 'button';
    deleteTableButton.dataset.testid = 'btn-delete-table';
    setManagementText(deleteTableButton, 'manage_table_delete');
    deleteTableButton.disabled = true;
    deleteTableButton.classList.add('danger-button');
    deleteTableButton.addEventListener('click', () => drop_table(table_name));
    buttonRow.append(deleteTableButton, saveButton);

    form.appendChild(buttonRow);

    let disposeLanguage = () => {};
    let disposed = false;
    createModal({
        titleDataLangKey: 'manage_table_title',
        titlePlainText: managementText('manage_table_title'),
        contentElements: [form],
        // The same width the creation form uses, so one dataset is described in
        // one layout rather than two.
        maxWidth: '968px',
        cleanupCallback: () => { disposed = true; disposeLanguage(); },
    });
    disposeLanguage = observeManagementLanguage(form);
    showModal();

    function showVisibility(uiHidden) {
        if (disposed) return;
        visibilityPanel.hidden = !uiHidden;
        restoreButton.hidden = !uiHidden;
        if (uiHidden) setManagementText(visibilityStatus, 'manage_table_hidden');
        deleteTableButton.disabled = false;
    }

    restoreButton.addEventListener('click', async () => {
        if (restoreButton.disabled) return;
        restoreButton.disabled = true;
        try {
            const result = await setDatasetUIVisibility(table_name, false);
            if (disposed) return;
            showVisibility(result.ui_hidden);
            showSuccessToast(managementText('manage_table_restored'));
        } catch (error) {
            if (!disposed) setManagementText(visibilityStatus, 'manage_table_restore_failed');
            console.warn('Dataset restoration failed:', error);
        } finally {
            restoreButton.disabled = false;
        }
    });

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (saveButton.disabled) return;

        const currentRows = form.querySelectorAll('.column-row');
        const currentColumns = [];

        let invalidInput = false;
        currentRows.forEach(r => {
            const nameInput = r.querySelector('input[name="column_name"]');
            const typeSelect = r.querySelector('select[name="data_type"]');
            const lengthInput = r.querySelector('input[name="length"]');

            const newName = nameInput.value.trim();
            if (newName && !isValidIdentifier(newName)) {
                showWarningToast(managementText('manage_table_invalid_name'));
                invalidInput = true;
                return;
            }

            // A decimal type travels complete, because the server builds the
            // length only for limited text. Empty fields mean the stored
            // precision stays untouched.
            const precisionInput = r.querySelector('input[name="precision"]');
            const scaleInput = r.querySelector('input[name="scale"]');
            const usesPrecision =
                getColumnTypeParameter(typeSelect.value) === COLUMN_TYPE_PARAMETER.PRECISION &&
                String(precisionInput?.value || '').trim() !== '';

            currentColumns.push({
                original_name: nameInput.dataset.originalName || null,
                new_name: newName,
                data_type: usesPrecision
                    ? composeColumnTypeDefinition(typeSelect.value, {
                        precision: precisionInput?.value,
                        scale: scaleInput?.value,
                    })
                    : typeSelect.value,
                length: lengthInput.value ? parseInt(lengthInput.value, 10) : null,
                is_multilingual: r.querySelector('input[name="is_multilingual"]')?.checked
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
                    length: currCol.data_type.toUpperCase() === 'VARCHAR' ? currCol.length : null,
                    ...(['TEXT', 'VARCHAR'].includes(currCol.data_type)
                        ? { is_multilingual: currCol.is_multilingual === true } : {})
                });
            }
        }

        // A role can only be assigned to a column that will exist after this
        // save. A half-finished new row — named, but without a chosen type — is
        // not created, so sending its role would make the server refuse the
        // whole request and lose every other change in it.
        const createdColumnNames = new Set(added_columns.map(column => column.new_name));
        const column_card_roles = {};
        currentRows.forEach(r => {
            const nameInput = r.querySelector('input[name="column_name"]');
            const roleSelect = r.querySelector('select[name="card_role"]');
            const columnName = nameInput?.value.trim();
            if (!columnName || !roleSelect) return;
            const isNewColumn = !nameInput.dataset.originalName;
            if (isNewColumn && !createdColumnNames.has(columnName)) return;
            // Otherwise: a new column's choice, or a role the person changed on
            // an existing column. An untouched column keeps whatever it has.
            if (isNewColumn || roleSelect.value !== roleSelect.dataset.originalRole) {
                column_card_roles[columnName] = roleSelect.value;
            }
        });

        const requestData = {
            dataset_name: table_name,
            modified_columns: modified_columns,
            added_columns: added_columns,
            removed_columns: removed_columns
        };
        if (Object.keys(column_card_roles).length > 0) {
            requestData.column_card_roles = column_card_roles;
        }


        if (multilingualDefaultInput.checked !== initialMultilingualDefault) {
            requestData.new_columns_multilingual = multilingualDefaultInput.checked;
        }

        const preventDeletion = datasetDimensions.preventDeletionChange();
        if (preventDeletion !== undefined) {
            requestData.prevent_deletion = preventDeletion;
        }

        saveButton.disabled = true;
        try {
            await endpoint_router('modifyColumns', {
                method: 'POST',
                body_data: requestData,
                suppressErrorToast: true,
            });
            datasetDimensions.acceptPreventDeletion();

            // Every remaining dimension owns its own route and is saved after
            // the schema change. The navigation trees read the dataset list and
            // its symbols from the cached catalog, so it is forgotten here: a
            // renamed dataset or a changed symbol appears in the navigation at once.
            const settled = await datasetDimensions.saveAll();

            invalidateDatabaseCatalogTreeCache();
            showSuccessToast(managementText('manage_table_saved'));
            if (settled) {
                hideModal();
            } else {
                showWarningToast(managementText('manage_table_settings_need_attention'));
            }

            const renamedMap = modified_columns
                .filter(c => c.original_name !== c.new_name)
                .map(c => ({ old_name: c.original_name, new_name: c.new_name }));
            purgeStaleColumnState(table_name, removed_columns, renamedMap);

            await refreshTableUnified(table_name, { skipUrlParams: true });

        } catch (error) {
            showWarningToast(managementText('manage_table_save_failed'));
            console.warn('Column management save failed:', error);
        } finally {
            saveButton.disabled = false;
        }
    });

    try {
        showVisibility((await getDatasetUIVisibility(table_name)).ui_hidden);
    } catch (error) {
        if (!disposed) setManagementText(visibilityStatus, 'manage_table_visibility_failed');
        console.warn('Dataset visibility lookup failed:', error);
    }
}
