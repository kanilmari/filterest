// row_remover_helpers.js
// Pure helper functions extracted from row_remover.js for testability.
// Zero DOM access — all functions are pure input→output.

/**
 * Find the header column name from a dataTypes metadata object.
 * The header column is the one whose card_element contains 'header'.
 *
 * @param {Object<string, {card_element?: string}>} dataTypes - Column metadata (from localStorage)
 * @returns {string|null} The header column name, or null if not found
 */
export function findHeaderColumn(dataTypes) {
    if (!dataTypes || typeof dataTypes !== 'object') return null;
    return Object.keys(dataTypes).find(col =>
        (dataTypes[col]?.card_element || '').split('+').includes('header')
    ) || null;
}

function isEpicTaskRow(row) {
    return String(row?.issue_type || '').trim().toLowerCase() === 'epic';
}

function normalizeUiLanguage(language) {
    const normalized = String(language || '').trim().toLowerCase();
    return normalized.startsWith('fi') ? 'fi' : 'en';
}

function buildDetachWarningTargetLabel(count, hasNames, language, isEpicSelection) {
    const uiLanguage = normalizeUiLanguage(language);

    if (uiLanguage === 'fi') {
        if (count === 1) {
            if (isEpicSelection) {
                return hasNames ? 'tämä epic' : 'valittu epic';
            }
            return hasNames ? 'tämä ticket' : 'valittu ticket';
        }
        return `${count} valittua ticketiä`;
    }

    if (count === 1) {
        if (isEpicSelection) {
            return hasNames ? 'this epic' : 'the selected epic';
        }
        return hasNames ? 'this ticket' : 'the selected ticket';
    }

    return `${count} selected tickets`;
}

function buildDetachWarningMessage(count, hasNames, linkedChildCount, language = 'fi', isEpicSelection = false) {
    const uiLanguage = normalizeUiLanguage(language);
    const targetLabel = buildDetachWarningTargetLabel(count, hasNames, uiLanguage, isEpicSelection);

    if (uiLanguage === 'fi') {
        const detachSentence = linkedChildCount > 0
            ? `${linkedChildCount} child ticket${linkedChildCount === 1 ? '' : 'iä'} jää paikalleen, mutta niiden parent_id tyhjennetään automaattisesti.`
            : 'Mahdolliset child ticketit jäävät paikalleen, mutta niiden parent_id tyhjennetään automaattisesti.';

        return `Poistetaanko ${targetLabel}? ${detachSentence}`;
    }

    const detachSentence = linkedChildCount > 0
        ? `${linkedChildCount} child ticket${linkedChildCount === 1 ? '' : 's'} will stay in place, but their parent_id will be cleared automatically.`
        : 'Any child tickets will stay in place, but their parent_id will be cleared automatically.';

    return `Delete ${targetLabel}? ${detachSentence}`;
}

/**
 * Build the confirmation message properties for a delete operation.
 *
 * @param {number} count - Number of items to delete
 * @param {boolean} hasNames - Whether item names are available for display
 * @param {{ tableName?: string, selectedRows?: Array<object>, linkedChildCount?: number }} options
 * @returns {{ messageLangKey: string, messagePlainText: string }}
 */
export function buildConfirmationMessage(count, hasNames, options = {}) {
    const {
        tableName = '',
        selectedRows = [],
        linkedChildCount = 0,
        language = 'fi',
    } = options;
    const isEpicSelection = selectedRows.some(isEpicTaskRow);

    const shouldWarnAboutEpicDetach = tableName === 'dev_agent_tasks'
        && (linkedChildCount > 0 || isEpicSelection);

    if (shouldWarnAboutEpicDetach) {
        return {
            messageLangKey: '',
            messagePlainText: buildDetachWarningMessage(
                count,
                hasNames,
                linkedChildCount,
                language,
                isEpicSelection
            ),
        };
    }

    const messageLangKey = count === 1 ? 'delete_confirm_single' : 'delete_confirm_multiple';
    const messagePlainText = count === 1
        ? (hasNames ? 'Haluatko poistaa kohteen:' : 'Haluatko poistaa valitun kohteen?')
        : (hasNames ? `Haluatko poistaa ${count} kohdetta:` : `Haluatko poistaa ${count} valittua kohdetta?`);
    return { messageLangKey, messagePlainText };
}

/**
 * Build the delete endpoint payload from selected IDs or rows.
 * Prefers IDs when available.
 *
 * @param {Array} selectedIds - Array of selected row IDs
 * @param {Array} selectedRows - Array of selected row data objects
 * @returns {{ ids?: Array, rows?: Array }}
 */
export function buildDeletePayload(selectedIds, selectedRows) {
    return selectedIds.length ? { ids: selectedIds } : { rows: selectedRows };
}
