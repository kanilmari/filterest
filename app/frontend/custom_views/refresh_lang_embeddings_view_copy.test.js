// refresh_lang_embeddings_view_copy.test.js
// Verifies that the embedding refresh page shows its words through language keys, never fixed English.
// Bridges a mocked endpoint pipeline and the rendered refresh controls with their toasts.
// Exists because the pending count, loading text and toasts used to overwrite translations with English.
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const endpoint = vi.hoisted(() => vi.fn());
const toast = vi.hoisted(() => vi.fn());
vi.mock('../core_components/endpoints/endpoint_router.js', () => ({ endpoint_router: endpoint }));
vi.mock('../core_components/route_permission_checker.js', () => ({ applyPermission: vi.fn() }));
vi.mock('../reusable_components/notifications/toast_notification_printer.js', () => ({ showToast: toast }));

import { generate_refresh_lang_embeddings_view, showPendingRowCount } from './refresh_lang_embeddings_view.js';
import { EMBEDDING_STATUS_TRANSLATION_FALLBACKS } from './embedding_status_translation_fallbacks.js';

function answer(route, options = {}) {
    if (route === 'embeddingDatasets' && options.url_params?.includes('include_status')) {
        return { provider: { provider: 'google', model: 'gemini-embedding-001' }, datasets: [] };
    }
    if (route === 'embeddingDatasets') {
        return [{ dataset: 'app_catalog', general_embedding: true, multilingual_embedding: true }];
    }
    if (route === 'embeddingSourcePolicy') return { dataset: 'app_catalog', columns: [] };
    if (route === 'countLangEmbeddings') return { pending: 3 };
    return {};
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe('embedding refresh page copy', () => {
    beforeEach(() => {
        endpoint.mockReset();
        toast.mockReset();
        endpoint.mockImplementation(async (route, options) => answer(route, options));
        document.body.replaceChildren();
    });

    it('keeps the pending count inside its translated sentence', () => {
        const counter = document.createElement('div');
        showPendingRowCount(counter, 12);
        expect(counter.dataset.langKey).toBe('embedding_refresh_rows_to_process+12');
        expect(counter.textContent).toBe('Rows to process: 12');
    });

    it('renders the controls, empty field list and toast through language keys', async () => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        await generate_refresh_lang_embeddings_view(host);
        await flush();

        const keys = [...host.querySelectorAll('[data-lang-key]')].map(element => element.dataset.langKey);
        expect(keys).toEqual(expect.arrayContaining([
            'embedding_status_column_dataset',
            'embedding_refresh_start',
            'embedding_refresh_no_eligible_fields',
        ]));
        expect(host.querySelector('#refresh_embeddings_pending_counter').dataset.langKey)
            .toMatch(/^embedding_refresh_rows_to_process\+\d+$/);

        host.querySelector('input[data-lang="en"]').checked = true;
        host.querySelector('#refresh_embeddings_start_button').click();
        await flush(); await flush();
        expect(toast).toHaveBeenCalledWith({ langKey: 'embedding_refresh_done', level: 'success' });
    });

    it('says so, translated, when a field selection cannot be read', async () => {
        endpoint.mockImplementation(async (route, options) => {
            if (route === 'embeddingSourcePolicy') throw new Error('offline');
            return answer(route, options);
        });
        const host = document.createElement('div');
        await generate_refresh_lang_embeddings_view(host);
        await flush();
        expect(host.querySelector('[data-lang-key="embedding_refresh_field_policy_unavailable"]')).not.toBeNull();
        expect(host.textContent).not.toContain('Loading');
    });

    it('has fallback copy in all four interface languages for every key of the page', () => {
        for (const [key, copy] of Object.entries(EMBEDDING_STATUS_TRANSLATION_FALLBACKS)) {
            for (const language of ['fi', 'en', 'ch', 'yue']) {
                expect(copy[language], `${key}.${language}`).toMatch(/\S/);
            }
        }
    });
});
