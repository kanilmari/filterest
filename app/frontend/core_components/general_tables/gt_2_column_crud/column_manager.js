// column_manager.js
// Hosts the dataset form in its editing mode, in the dataset's Manage table dialog.
// Bridges the form with the dialog around it and with the table view behind
// it: stale column state is purged and the view refreshed once the server
// holds a change.
// Exists as a thin host: the form and its editing adapter live in
// dataset_form/, shared with the dataset creation page.
import { createModal, showModal, hideModal } from '../../../reusable_components/modal/modal_builder.js';
import { drop_table } from '../gt_3_table_crud/gt_3_2_table_delete/table_remover.js';
import { refreshTableUnified } from '../gt_1_row_crud/gt_1_2_row_read/table_refresh_unified.js';
import { purgeStaleColumnState } from './column_manager_state_cleanup.js';
import { buildDatasetForm } from '../dataset_form/dataset_form.js';
import { createDatasetEditSource } from '../dataset_form/dataset_edit_source.js';
import { datasetFormText } from '../dataset_form/dataset_form_text.js';

export async function open_column_management_modal(table_name) {
    const source = await createDatasetEditSource(table_name, { drop: () => drop_table(table_name) });
    const form = buildDatasetForm({
        mode: 'edit',
        source,
        host: {
            close: () => hideModal(),
            afterSave: async ({ removedColumns = [], renamedColumns = [] }) => {
                purgeStaleColumnState(table_name, removedColumns, renamedColumns);
                await refreshTableUnified(table_name, { skipUrlParams: true });
            },
        },
    });

    createModal({
        titleDataLangKey: 'manage_table_title',
        titlePlainText: datasetFormText('manage_table_title'),
        contentElements: [form.element],
        // The dialog is exactly as wide as the dataset form it frames.
        width: 'fit-content',
        maxWidth: '96vw',
        cleanupCallback: () => form.dispose(),
    });
    showModal();
    await form.ready;
}
