// card_edit_reconciler.js
// Rebases successfully persisted article fields while a partial draft remains open.
// Bridges sequential field-save results with the live editor's cancel/retry baseline.
// Exists so maintenance cannot make the browser conceal an already committed value.

import { disableEditing } from './card_field_formatter.js';

function buildReadOnlyDraftSnapshot(container) {
    const snapshot = container.cloneNode(true);
    const liveControls = container.querySelectorAll('input, textarea, select');
    const snapshotControls = snapshot.querySelectorAll('input, textarea, select');

    liveControls.forEach((liveControl, index) => {
        const snapshotControl = snapshotControls[index];
        if (!snapshotControl) return;
        snapshotControl.value = liveControl.value;
        if ('checked' in liveControl) snapshotControl.checked = liveControl.checked;
        if ('selectedIndex' in liveControl) snapshotControl.selectedIndex = liveControl.selectedIndex;
    });
    disableEditing(snapshot);
    return snapshot;
}

/**
 * Accept already saved fields as the live editor's new baseline without
 * replacing its controls or discarding fields that still need a retry.
 */
export function rebaseSavedCardDraftFields(container, successfulFields = []) {
    const savedColumns = new Set(successfulFields.filter((column) => (
        typeof column === 'string' && column !== ''
    )));
    if (!container || savedColumns.size === 0) return 0;

    const snapshot = buildReadOnlyDraftSnapshot(container);
    const liveFields = container.querySelectorAll('[data-column]');
    const snapshotFields = snapshot.querySelectorAll('[data-column]');
    let rebasedCount = 0;

    liveFields.forEach((liveField, index) => {
        const column = liveField.getAttribute('data-column') || '';
        const snapshotField = snapshotFields[index];
        if (!savedColumns.has(column) || !snapshotField || !liveField.querySelector('input, textarea, select')) {
            return;
        }

        const savedRawValue = snapshotField.getAttribute('data-raw-value') ?? snapshotField.textContent ?? '';
        const savedDisplayValue = snapshotField.textContent?.trim() ?? '';
        const isMultilingual = liveField.hasAttribute('data-multilang-json');
        const isTemporal = liveField.hasAttribute('data-edit-data-type');
        const liveControl = liveField.querySelector('input, textarea, select');
        const savedEditorDisplay = isMultilingual ? (liveControl?.value ?? '') : savedDisplayValue;
        liveField.setAttribute('data-raw-value', savedRawValue);
        liveField.setAttribute('data-original-text', isMultilingual || isTemporal ? savedEditorDisplay : savedRawValue);

        if (isMultilingual) {
            liveField.setAttribute('data-multilang-json', savedRawValue);
        }
        if (isTemporal) {
            liveField.setAttribute('data-original-input-value', liveControl?.value ?? '');
        }
        rebasedCount += 1;
    });
    return rebasedCount;
}
