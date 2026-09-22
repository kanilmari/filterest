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
import { findDatasetColumnType } from '../dataset_form/dataset_column_type_catalog.js';
import { createDatasetColumnTable } from '../dataset_form/dataset_column_table.js';

/** One column as the dialog remembers the server holding it. */
function toSavedColumn(columnName, dataType, length) {
    return { column_name: columnName, data_type: String(dataType || '').toUpperCase(), length: length ?? '' };
}

export async function open_column_management_modal(table_name) {
    const columns = await fetch_columns_for_table(table_name);
    const declaredDefault = columns[0]?.new_columns_multilingual;
    // What the server holds, as far as this dialog knows; it advances with
    // every schema change the server accepts (see acceptSavedColumns).
    let savedMultilingualDefault = typeof declaredDefault === 'boolean'
        ? declaredDefault : columns.some(column => column.is_multilingual === true);

    // Spell every stored type the way the shared catalogue does, so an
    // unrelated Save cannot rewrite a column merely because PostgreSQL and the
    // form use different names for the same type.
    columns.forEach(col => {
        col.data_type = findDatasetColumnType(col.data_type)?.value || col.data_type;
    });

    // The columns the server holds, which every Save compares against. It
    // starts as the columns the dialog opened with and advances the moment the
    // server accepts a schema change (see acceptSavedColumns).
    const saved_columns = columns.map(col => toSavedColumn(col.column_name, col.data_type, col.character_maximum_length));

    // The dataset form: drawn by the same rules as the creation form
    // (create_table_admin.css), so one dataset is described in one layout.
    const form = document.createElement('form');
    form.id = `column_management_form_${table_name}`;
    form.classList.add('column_management_forms', 'dataset-form');

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

    // The columns are the table both dataset forms share. It is placed after
    // the dataset's own settings, but the links to other datasets read its names.
    const columnTable = createDatasetColumnTable({
        mode: 'edit',
        multilingualDefault: () => multilingualDefaultInput.checked,
    });

    // Every dataset-level dimension is described once, by the controls both
    // dataset forms share, instead of being wired separately here.
    const datasetDimensions = createDatasetDimensionPanels({
        datasetName: table_name,
        columnNames: () => columnTable.columnNames(),
    });
    form.append(...datasetDimensions.elements);

    const multilingualDefaultLabel = managementLabel('manage_table_multilingual_default');
    multilingualDefaultLabel.classList.add('dataset-form-option');
    const multilingualDefaultInput = document.createElement('input');
    multilingualDefaultInput.type = 'checkbox';
    multilingualDefaultInput.dataset.testid = 'manage-table-multilingual-default';
    multilingualDefaultInput.checked = savedMultilingualDefault;
    multilingualDefaultLabel.prepend(multilingualDefaultInput);
    form.append(multilingualDefaultLabel);
    multilingualDefaultInput.addEventListener('change', () => {
        columnTable.setMultilingualDefault(multilingualDefaultInput.checked);
    });

    // The columns the dataset holds, then one blank row for a column to add.
    columns.forEach(col => columnTable.addColumn({
        existing: true,
        name: col.column_name,
        dataType: col.data_type,
        length: col.character_maximum_length,
        role: col.card_element,
    }));
    columnTable.addColumn();
    form.appendChild(columnTable.element);

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
        // The dialog is exactly as wide as the dataset form it frames; the form
        // itself takes the creation form's width (create_table_admin.css).
        width: 'fit-content',
        maxWidth: '96vw',
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

    // Once the server has taken a schema change, the dialog describes what it
    // now holds. A later setting can still be refused and keep the dialog open;
    // a retry compared against the columns as they were opened would repeat an
    // addition or rename the server already made, be refused for it, and take
    // the settings still waiting to be saved down with it. Only what was sent
    // is recorded, so an edit made while the request was under way stays a
    // change for the next Save.
    function acceptSavedColumns({ removed, changes, sentRows, sentRoles, multilingualDefault }) {
        // Find every changed column before renaming any, so two columns that
        // swap names in one save are not mistaken for each other.
        const updates = changes.map(change => ({
            change,
            entry: change.original_name
                ? saved_columns.find(column => column.column_name === change.original_name)
                : null,
        }));
        for (const name of removed) {
            const index = saved_columns.findIndex(column => column.column_name === name);
            if (index !== -1) saved_columns.splice(index, 1);
        }
        for (const { change, entry } of updates) {
            const held = toSavedColumn(change.new_name, change.data_type, change.length);
            if (entry) Object.assign(entry, held);
            else saved_columns.push(held);
            sentRows.get(change)?.markSaved(change.new_name);
        }
        for (const { row, role } of sentRoles) row.acceptRole(role);
        if (multilingualDefault !== undefined) savedMultilingualDefault = multilingualDefault;
    }

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (saveButton.disabled) return;

        const currentRows = columnTable.rows();
        const currentColumns = [];

        let invalidInput = false;
        currentRows.forEach(row => {
            const column = row.read();
            if (column.name && !isValidIdentifier(column.name)) {
                showWarningToast(managementText('manage_table_invalid_name'));
                invalidInput = true;
                return;
            }
            currentColumns.push({
                row,
                original_name: column.originalName,
                new_name: column.name,
                data_type: column.dataType,
                length: column.length,
                is_multilingual: column.isMultilingual,
                role: column.role,
                roleChanged: column.roleChanged,
            });
        });
        if (invalidInput) {
            return;
        }

        const removed_columns = [];
        const modified_columns = [];
        const added_columns = [];
        // The row each sent change came from, to be marked saved once accepted.
        const sentRows = new Map();

        // Alkuperäiset sarakkeet
        for (const initCol of saved_columns) {
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
                    const change = {
                        original_name: found.original_name,
                        new_name: found.new_name,
                        data_type: found.data_type,
                        length: found.data_type.toUpperCase() === 'VARCHAR' ? found.length : null
                    };
                    modified_columns.push(change);
                    sentRows.set(change, found.row);
                }
            }
        }

        // Uudet sarakkeet
        for (const currCol of currentColumns) {
            if (!currCol.original_name && currCol.new_name !== '' && currCol.data_type !== '') {
                const change = {
                    original_name: "",
                    new_name: currCol.new_name,
                    data_type: currCol.data_type,
                    length: currCol.data_type.toUpperCase() === 'VARCHAR' ? currCol.length : null,
                    ...(['TEXT', 'VARCHAR'].includes(currCol.data_type)
                        ? { is_multilingual: currCol.is_multilingual === true } : {})
                };
                added_columns.push(change);
                sentRows.set(change, currCol.row);
            }
        }

        // A role can only be assigned to a column that will exist after this
        // save. A half-finished new row — named, but without a chosen type — is
        // not created, so sending its role would make the server refuse the
        // whole request and lose every other change in it.
        const createdColumnNames = new Set(added_columns.map(column => column.new_name));
        const column_card_roles = {};
        const sentRoles = [];
        currentColumns.forEach(({ row, original_name, new_name, role, roleChanged }) => {
            if (!new_name) return;
            const isNewColumn = !original_name;
            if (isNewColumn && !createdColumnNames.has(new_name)) return;
            // Otherwise: a new column's choice, or a role the person changed on
            // an existing column. An untouched column keeps whatever it has.
            if (isNewColumn || roleChanged) {
                column_card_roles[new_name] = role;
                sentRoles.push({ row, role });
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


        if (multilingualDefaultInput.checked !== savedMultilingualDefault) {
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
            // Before anything else can fail: the columns are saved now, and a
            // retry must compare against them rather than repeat them.
            acceptSavedColumns({
                removed: removed_columns,
                changes: [...modified_columns, ...added_columns],
                sentRows,
                sentRoles,
                multilingualDefault: requestData.new_columns_multilingual,
            });

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
