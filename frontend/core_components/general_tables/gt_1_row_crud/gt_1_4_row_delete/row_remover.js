// row_remover.js
// Deletes one or more selected rows from the current dataset after user confirmation.
// Bridges selected-item reading, confirmation modal, endpoint routing, and success/warning toasts into one delete flow.
// Exists to encapsulate row-deletion logic and guard against accidental mass deletes via a confirm step.
import { get_selected_items } from '../../../table_views/table_view/selected_items_reader.js';
import { refreshTableUnified } from '../gt_1_2_row_read/table_refresh_unified.js';
import { endpoint_router } from '../../../endpoints/endpoint_router.js';
import { showSuccessToast, showWarningToast } from '../../../../reusable_components/notifications/toast_notification_printer.js';
import { showConfirmModal } from '../../../../reusable_components/modal/confirm_modal_builder.js';
import { findHeaderColumn, buildConfirmationMessage, buildDeletePayload } from './row_remover_helpers.js';
import { getLanguageWithBrowserFallback } from '../../../state_stores/lang_preference_reader.js';

function getHeaderColumnName(table_name) {
    const dataTypes = JSON.parse(localStorage.getItem(`${table_name}_dataTypes`) || '{}');
    return findHeaderColumn(dataTypes);
}

function getItemNamesFromTable(table_name, headerCol) {
    const table = document.querySelector(`#${table_name}_container table`);
    if (!table || !headerCol) return null;
    const columns = JSON.parse(table.dataset.columns || '[]');
    const headerColIndex = columns.indexOf(headerCol);
    if (headerColIndex === -1) return null;
    const cellIndex = headerColIndex + 2; // +2 for row-number + checkbox cells
    const selectedRows = document.querySelectorAll(`#${table_name}_table_body tr.selected`);
    const names = [];
    selectedRows.forEach(row => {
        const cells = row.querySelectorAll('td');
        const text = cells[cellIndex]?.textContent?.trim();
        if (text) names.push(text);
    });
    return names.length > 0 ? names : null;
}

function getItemNamesFromCards(table_name) {
    const selectedCards = document.querySelectorAll(`#${table_name}_container .card.selected`);
    const names = [];
    selectedCards.forEach(card => {
        const text = card.querySelector('.card_header .header_value')?.textContent?.trim();
        if (text) names.push(text);
    });
    return names.length > 0 ? names : null;
}

export async function delete_selected_items(table_name) {
    const { ids: selected_ids, rows: selected_rows } = get_selected_items(table_name);
    if (selected_ids.length === 0 && selected_rows.length === 0) {
        showWarningToast('Valitse poistettavat kohteet.');
        return;
    }

    const count = selected_ids.length || selected_rows.length;
    const current_view = localStorage.getItem(`${table_name}_view`) || 'table';
    const headerCol = getHeaderColumnName(table_name);

    let itemNames = null;
    if (current_view === 'table') {
        itemNames = getItemNamesFromTable(table_name, headerCol);
    } else if (current_view === 'card') {
        itemNames = getItemNamesFromCards(table_name);
    }

    const hasNames = itemNames && itemNames.length > 0;
    const { messageLangKey, messagePlainText } = buildConfirmationMessage(count, hasNames, {
        tableName: table_name,
        selectedRows: selected_rows,
        language: getLanguageWithBrowserFallback(),
    });

    const ok = await showConfirmModal({
        titleLangKey: 'delete_confirm_title',
        titlePlainText: 'Vahvista poisto',
        messageLangKey: hasNames ? messageLangKey : '',
        messagePlainText,
        confirmLangKey: 'delete',
        confirmText: 'Poista',
        cancelLangKey: 'dont_delete',
        cancelText: 'Älä poista',
        isDanger: true,
        itemNames,
    });
    if (!ok) return;

    try {
        const payload = buildDeletePayload(selected_ids, selected_rows);
        await endpoint_router('deleteRows', {
            method: 'POST',
            url_params: `?dataset=${table_name}`,
            body_data: payload,
        });

        showSuccessToast('Valitut kohteet poistettu onnistuneesti! ☺');

        // Päivitetään näkymä refreshTableUnified-funktion avulla
        await refreshTableUnified(table_name, { skipUrlParams: true });
    } catch (error) {
        console.warn('Virhe poistossa:', error);
    }
}
