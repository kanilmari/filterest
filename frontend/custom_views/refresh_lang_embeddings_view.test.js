// refresh_lang_embeddings_view.test.js
// Verifies stable column-UID normalization and deterministic consent payloads in the admin view.
// Bridges untrusted API payloads and the fail-closed external embedding field selector.
// Exists to prevent malformed or duplicate selections from widening the outbound privacy boundary.
import { describe, expect, it } from 'vitest';

import {
    normalizeEmbeddingDatasetList,
    normalizeEmbeddingPolicyResponse,
    selectedEmbeddingColumnUIDs,
    selectedEmbeddingLanguages,
} from './refresh_lang_embeddings_view.js';

describe('embedding source policy helpers', () => {
    it('normalizes capability-aware datasets and keeps legacy responses compatible', () => {
        expect(normalizeEmbeddingDatasetList([
            {
                dataset: 'app_catalog',
                general_embedding: true,
                multilingual_embedding: false,
            },
            'app_multilingual',
            { dataset: '', general_embedding: true },
        ])).toEqual([
            {
                dataset: 'app_catalog',
                general_embedding: true,
                multilingual_embedding: false,
            },
            {
                dataset: 'app_multilingual',
                general_embedding: false,
                multilingual_embedding: true,
            },
        ]);
    });

    it('keeps a current-project policy candidate even before vector storage is ready', () => {
        expect(normalizeEmbeddingDatasetList([{
            dataset: 'new_public_dataset',
            general_embedding: false,
            multilingual_embedding: false,
        }])).toEqual([{
            dataset: 'new_public_dataset',
            general_embedding: false,
            multilingual_embedding: false,
        }]);
    });

    it('normalizes stable column UIDs and explicit allowed booleans only', () => {
        expect(normalizeEmbeddingPolicyResponse({
            dataset: 'app_catalog',
            table_uid: 12,
            provider: 'openai',
            columns: [
                { column_uid: 8, column_name: 'description', allowed: true },
                { column_uid: '9', column_name: 'private_note', allowed: 'true' },
                { column_uid: 'invalid', column_name: 'ignored', allowed: true },
            ],
        })).toEqual({
            dataset: 'app_catalog',
            table_uid: 12,
            provider: 'openai',
            enabled: false,
            configured: false,
            columns: [
                { column_uid: 8, column_name: 'description', allowed: true },
                { column_uid: 9, column_name: 'private_note', allowed: false },
            ],
        });
    });

    it('keeps table enablement explicit while accepting configured policy metadata', () => {
        expect(normalizeEmbeddingPolicyResponse({
            dataset: 'app_catalog',
            enabled: true,
            configured: true,
            columns: [],
        })).toMatchObject({ enabled: true, configured: true });

        expect(normalizeEmbeddingPolicyResponse({
            dataset: 'app_catalog',
            enabled: 'true',
            configured: 1,
            columns: [],
        })).toMatchObject({ enabled: false, configured: false });
    });

    it('returns a sorted duplicate-free checked UID set', () => {
        const container = document.createElement('div');
        container.innerHTML = `
            <input type="checkbox" data-column-uid="9" checked>
            <input type="checkbox" data-column-uid="4" checked>
            <input type="checkbox" data-column-uid="9" checked>
            <input type="checkbox" data-column-uid="2">
        `;
        expect(selectedEmbeddingColumnUIDs(container)).toEqual([4, 9]);
    });

    it('keeps field consent checkboxes out of manual language refreshes', () => {
        const row = document.createElement('div');
        row.innerHTML = `
            <input type="checkbox" data-column-uid="9" checked>
            <input type="checkbox" data-lang="en" checked>
            <input type="checkbox" data-lang="fi">
        `;
        expect(selectedEmbeddingLanguages(row)).toEqual(['en']);
    });
});
