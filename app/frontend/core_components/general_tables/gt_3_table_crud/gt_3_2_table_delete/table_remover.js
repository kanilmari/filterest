// table_remover.js
// Defaults to reversible interface removal and requires exact-name permanent deletion.
// Uses the existing request pipeline; the server enforces administrator authorization.
import { endpoint_router } from '../../../endpoints/endpoint_router.js';
import { setRedirectNotice, clearDatasetSelectionState } from '../../../state_stores/dataset_selection_saver.js';
import { hideModal } from '../../../../reusable_components/modal/modal_builder.js';
import { redirectToRootInSpa } from '../../../navigation/root_redirect_handler.js';
import { setDatasetUIVisibility } from '../../gt_2_column_crud/dataset_ui_visibility.js';
import { openDatasetRemovalDialog } from './table_removal_dialog.js';

export function drop_table(table_name) {
    return openDatasetRemovalDialog({
        datasetName: table_name,
        onConfirm: async ({ mode, confirmDatasetName }) => {
            if (mode === 'hide') {
                await setDatasetUIVisibility(table_name, true);
            } else {
                await endpoint_router('dropDataset', {
                    method: 'POST',
                    body_data: {
                        dataset_name: table_name,
                        confirm_dataset_name: confirmDatasetName,
                    },
                    suppressErrorToast: true,
                });
            }
        },
        onConfirmed: async mode => {
            hideModal();
            setRedirectNotice({
                datasetName: table_name,
                reason: mode === 'hide' ? 'hidden' : 'deleted',
                messageLangKey: mode === 'hide'
                    ? 'manage_table_hidden_success' : 'manage_table_deleted_success',
            });
            clearDatasetSelectionState();
            try {
                await redirectToRootInSpa();
            } catch (error) {
                console.warn('SPA root redirect after dataset removal failed:', error);
                window.location.replace('/');
            }
        },
    });
}
