// embedding_status_panel.test.js
// Verifies the read-only embedding status table: safe normalization, dataset states and translated cells.
// Bridges a mocked status answer and the rendered DOM the translator localizes.
// Exists so the page keeps telling which datasets are embedded, how fully and why rows are not re-embedded.
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const endpoint = vi.hoisted(() => vi.fn());
vi.mock('../core_components/endpoints/endpoint_router.js', () => ({ endpoint_router: endpoint }));

import {
    describeEmbeddingState,
    normalizeEmbeddingStatusReport,
    renderEmbeddingStatusPanel,
} from './embedding_status_panel.js';
import { EMBEDDING_STATUS_TRANSLATION_FALLBACKS } from './embedding_status_translation_fallbacks.js';

const STATUS_ANSWER = {
    provider: { provider: 'google', model: 'gemini-embedding-001', dimensions: 1536, key_configured: true },
    datasets: [
        {
            dataset: 'app_service_catalog',
            general_embedding: true,
            multilingual_embedding: true,
            automatic_refresh: false,
            automatic_refresh_blocker: 'provider_sending_disabled',
            total_rows: 13,
            embedded_rows: 7,
            changed_since_embedding: 7,
            languages: [{ language: 'en', rows: 7 }, { language: 'fi', rows: 7 }],
            other_model_embeddings: 14,
            last_refreshed: '2025-11-23T18:16:22+02:00',
            pending_refreshes: 0,
            failing_refreshes: 0,
            orphan_language_embeddings: 88,
        },
        {
            dataset: 'dev_todo',
            general_embedding: true,
            automatic_refresh: true,
            total_rows: 90,
            embedded_rows: 90,
            changed_since_embedding: null,
            last_refreshed: null,
            pending_refreshes: 2,
            failing_refreshes: 1,
        },
        { dataset: 'plain', automatic_refresh_blocker: 'no_embedding_storage', total_rows: null },
        { dataset: '', total_rows: 1 },
    ],
};

describe('embedding status normalization', () => {
    it('keeps only named datasets and replaces unknown values with safe defaults', () => {
        const report = normalizeEmbeddingStatusReport({
            provider: { provider: 'openai', dimensions: 'many' },
            datasets: [
                { dataset: 'x', total_rows: -3, embedded_rows: 'x', automatic_refresh_blocker: '<script>' },
                { dataset: '  ' },
                null,
            ],
        });
        expect(report.provider).toEqual({ provider: 'openai', model: '', dimensions: 0, key_configured: false });
        expect(report.datasets).toHaveLength(1);
        expect(report.datasets[0]).toMatchObject({
            dataset: 'x', total_rows: 0, embedded_rows: 0, automatic_refresh_blocker: '', changed_since_embedding: null,
        });
        expect(normalizeEmbeddingStatusReport(null)).toEqual({
            provider: { provider: '', model: '', dimensions: 0, key_configured: false },
            datasets: [],
        });
    });

    it('tells embedded, partly embedded, not embedded and unavailable apart', () => {
        expect(describeEmbeddingState({ total_rows: 5, embedded_rows: 5 })).toBe('embedded');
        expect(describeEmbeddingState({ total_rows: 5, embedded_rows: 2 })).toBe('partial');
        expect(describeEmbeddingState({ total_rows: 5, embedded_rows: 0 })).toBe('none');
        expect(describeEmbeddingState({ total_rows: null, embedded_rows: 0 })).toBe('none');
        expect(describeEmbeddingState({ unavailable: true, total_rows: 5, embedded_rows: 5 })).toBe('unavailable');
    });
});

describe('embedding status panel', () => {
    beforeEach(() => {
        endpoint.mockReset();
        document.body.replaceChildren();
    });

    it('reads the status once, read-only, and shows one row per dataset', async () => {
        endpoint.mockResolvedValueOnce(STATUS_ANSWER);
        const host = document.createElement('section');
        document.body.appendChild(host);

        await renderEmbeddingStatusPanel(host);

        expect(endpoint).toHaveBeenCalledOnce();
        expect(endpoint).toHaveBeenCalledWith('embeddingDatasets', { method: 'GET', url_params: '?include_status=true' });
        const rows = [...host.querySelectorAll('tbody tr')];
        expect(rows.map(row => [row.dataset.dataset, row.dataset.embeddingState])).toEqual([
            ['app_service_catalog', 'partial'],
            ['dev_todo', 'embedded'],
            ['plain', 'none'],
        ]);
        expect(host.querySelector('.embedding-status-provider').textContent)
            .toContain('Google');
        expect(host.querySelector('.embedding-status-provider').textContent)
            .toContain('gemini-embedding-001');
    });

    it('names what needs attention with translatable copy', async () => {
        endpoint.mockResolvedValueOnce(STATUS_ANSWER);
        const host = document.createElement('section');
        await renderEmbeddingStatusPanel(host);

        const catalog = host.querySelector('tr[data-dataset="app_service_catalog"]');
        const keys = [...catalog.querySelectorAll('[data-lang-key]')].map(element => element.dataset.langKey);
        expect(keys).toEqual(expect.arrayContaining([
            'embedding_status_state_partial',
            'embedding_status_rows_without+6',
            'embedding_status_general_embedding',
            'embedding_status_orphans+88',
            'embedding_status_other_model+14',
            'embedding_status_blocker_provider_sending_disabled',
        ]));
        expect(catalog.textContent).toContain('7 / 13');
        expect(catalog.textContent).toContain('en 7 · fi 7');
        expect(catalog.textContent).toContain('6 without an embedding');

        const todo = host.querySelector('tr[data-dataset="dev_todo"]');
        const todoKeys = [...todo.querySelectorAll('[data-lang-key]')].map(element => element.dataset.langKey);
        expect(todoKeys).toEqual(expect.arrayContaining([
            'embedding_status_not_tracked',
            'embedding_status_automatic_on',
            'embedding_status_pending+2',
            'embedding_status_failing+1',
        ]));
        expect(todo.querySelector('[data-title-lang-key="embedding_status_not_tracked_hint"]')).not.toBeNull();
    });

    it('says so when the status cannot be read', async () => {
        endpoint.mockRejectedValueOnce(new Error('offline'));
        const host = document.createElement('section');
        await renderEmbeddingStatusPanel(host);
        expect(host.querySelector('[data-lang-key="embedding_status_unavailable"]')).not.toBeNull();
        expect(host.querySelector('table')).toBeNull();
    });

    it('has fallback copy in all four interface languages for every key it uses', async () => {
        endpoint.mockResolvedValueOnce(STATUS_ANSWER);
        const host = document.createElement('section');
        await renderEmbeddingStatusPanel(host);
        const usedKeys = new Set([
            ...[...host.querySelectorAll('[data-lang-key]')].map(element => element.dataset.langKey.split('+')[0]),
            ...[...host.querySelectorAll('[data-title-lang-key]')].map(element => element.dataset.titleLangKey),
        ]);
        for (const key of usedKeys) {
            const copy = EMBEDDING_STATUS_TRANSLATION_FALLBACKS[key];
            expect(copy, key).toBeDefined();
            for (const language of ['fi', 'en', 'ch', 'yue']) {
                expect(copy[language], `${key}.${language}`).toMatch(/\S/);
            }
        }
    });
});
