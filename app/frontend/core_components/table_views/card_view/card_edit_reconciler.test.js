// @vitest-environment jsdom
// card_edit_reconciler.test.js
// Verifies partial article saves become the editor baseline without losing drafts.
// Bridges maintenance interruptions with safe retry and cancel behavior.
// Exists to prevent the UI from concealing values already committed to the database.

import { beforeEach, describe, expect, test } from 'vitest';

import {
    cancelEditing,
    collectCardUpdates,
} from './card_field_formatter.js';
import { rebaseSavedCardDraftFields } from './card_edit_reconciler.js';

function appendEditableField(container, column, originalValue, draftValue) {
    const field = document.createElement('div');
    field.dataset.column = column;
    field.dataset.originalText = originalValue;
    field.dataset.rawValue = originalValue;
    const input = document.createElement('input');
    input.value = draftValue;
    field.appendChild(input);
    container.appendChild(field);
    return { field, input };
}

describe('rebaseSavedCardDraftFields', () => {
    beforeEach(() => {
        document.body.replaceChildren();
    });

    test('retries only unsaved fields and cancel keeps an already saved value visible', () => {
        const container = document.createElement('section');
        container.dataset.cardEditTable = 'demo_dataset';
        const title = appendEditableField(container, 'title', 'Old title', 'Saved title');
        const summary = appendEditableField(container, 'summary', 'Old summary', 'Unsaved summary');
        document.body.appendChild(container);

        expect(rebaseSavedCardDraftFields(container, ['title'])).toBe(1);
        expect(title.field.querySelector('input')).toBe(title.input);
        expect(summary.field.querySelector('input')).toBe(summary.input);
        expect(collectCardUpdates(container)).toEqual({ summary: 'Unsaved summary' });

        cancelEditing(container);
        expect(title.field.textContent).toBe('Saved title');
        expect(summary.field.textContent).toBe('Old summary');
    });

    test('rebases the full multilingual value while retaining the selected-language input', () => {
        const container = document.createElement('section');
        container.dataset.cardEditTable = 'demo_dataset';
        const { field, input } = appendEditableField(container, 'title', 'Hei', 'Uusi');
        field.dataset.rawValue = JSON.stringify({ en: 'Hello', fi: 'Hei' });
        field.dataset.multilangJson = JSON.stringify({ en: 'Hello', fi: 'Hei' });
        field.dataset.multilangEditLang = 'fi';
        document.body.appendChild(container);

        rebaseSavedCardDraftFields(container, ['title']);

        expect(field.querySelector('input')).toBe(input);
        expect(JSON.parse(field.dataset.multilangJson)).toEqual({ en: 'Hello', fi: 'Uusi' });
        expect(collectCardUpdates(container)).toEqual({});
        cancelEditing(container);
        expect(field.textContent).toBe('Uusi');
    });
});
