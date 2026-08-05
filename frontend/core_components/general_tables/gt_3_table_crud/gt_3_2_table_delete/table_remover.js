// table_remover.js
// Handles dropping (deleting) an entire dataset/table via a confirmed API call.
// Bridges the confirm modal, endpoint router, and dataset selection state into one table-deletion action.
// Exists to isolate table-drop logic from column management and toolbar UI.

import { endpoint_router } from '../../../endpoints/endpoint_router.js';
import { showSuccessToast } from '../../../../reusable_components/notifications/toast_notification_printer.js';
import { setRedirectNotice, clearDatasetSelectionState } from '../../../state_stores/dataset_selection_saver.js';
import { showConfirmModal } from '../../../../reusable_components/modal/confirm_modal_builder.js';
import { hideModal } from '../../../../reusable_components/modal/modal_builder.js';
import { getTranslationForKey } from '../../../lang/translation_handler.js';
import { redirectToRootInSpa } from '../../../navigation/root_redirect_handler.js';

/**
 * Prompts for confirmation and drops the named table via the dropDataset endpoint.
 * On success, hides the modal, queues a redirect notice, clears dataset state, and returns to root.
 * @param {string} table_name - The dataset/table name to drop.
 */
export async function drop_table(table_name) {
    const ok = await showConfirmModal({
        messagePlainText: `Haluatko varmasti poistaa taulun ${table_name} kokonaan? Tätä toimintoa ei voi perua!`,
        messageLangKey: 'confirm_drop_table',
        isDanger: true,
    });
    if (!ok) return;

    try {
        await endpoint_router('dropDataset', {
            method: 'POST',
            body_data: { dataset_name: table_name }
        });

        showSuccessToast(getTranslationForKey('table_deleted_successfully') || `Taulu ${table_name} poistettu onnistuneesti.`);
        hideModal();
        setRedirectNotice({ datasetName: table_name, reason: 'deleted' });
        clearDatasetSelectionState();
        try {
            await redirectToRootInSpa();
        } catch (redirectError) {
            console.warn('SPA root redirect after dataset deletion failed, falling back to full navigation:', redirectError);
            window.location.replace('/');
        }
    } catch (err) {
        console.warn('Virhe poistettaessa taulua:', err);
    }
}
