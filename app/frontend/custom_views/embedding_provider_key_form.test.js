// embedding_provider_key_form.test.js
// Verifies the embeddings admin page's two key states and the honest outcomes of a save.
// Bridges a mocked admin endpoint and the rendered status panel with its key form.
// Exists because a page that offers a key field must never claim a success the server refused.
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const endpoint = vi.hoisted(() => vi.fn());
vi.mock('../core_components/endpoints/endpoint_router.js', () => ({ endpoint_router: endpoint }));

import { renderEmbeddingStatusPanel } from './embedding_status_panel.js';
import {
    describeKeySaveFailure,
    renderEmbeddingProviderKeyForm,
} from './embedding_provider_key_form.js';
import { EMBEDDING_STATUS_TRANSLATION_FALLBACKS } from './embedding_status_translation_fallbacks.js';

const FAKE_KEY = 'test-fake-provider-key-not-a-real-credential';

function statusAnswer(keyConfigured) {
    return {
        provider: {
            provider: 'google',
            model: 'gemini-embedding-001',
            dimensions: 1536,
            key_configured: keyConfigured,
        },
        datasets: [{ dataset: 'app_catalog', general_embedding: true, total_rows: 4, embedded_rows: 4 }],
    };
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

function langKeysOf(host) {
    return [...host.querySelectorAll('[data-lang-key]')].map(element => element.dataset.langKey);
}

describe('embedding admin page key states', () => {
    beforeEach(() => {
        endpoint.mockReset();
        document.body.replaceChildren();
    });

    it('offers no key field while the provider already has a key', async () => {
        endpoint.mockResolvedValue(statusAnswer(true));
        const host = document.createElement('div');
        document.body.appendChild(host);

        await renderEmbeddingStatusPanel(host);

        expect(langKeysOf(host)).toContain('embedding_status_key_configured');
        expect(host.querySelector('.embedding-key-setup')).toBeNull();
        expect(host.querySelector('input[type="password"]')).toBeNull();
    });

    it('offers the field, the explanation and the provider link while the key is missing', async () => {
        endpoint.mockResolvedValue(statusAnswer(false));
        const host = document.createElement('div');
        document.body.appendChild(host);

        await renderEmbeddingStatusPanel(host);

        expect(langKeysOf(host)).toEqual(expect.arrayContaining([
            'embedding_status_key_missing',
            'embedding_key_setup_title',
            'embedding_key_setup_explanation',
            'embedding_key_setup_privacy',
            'embedding_key_setup_field_label',
            'embedding_key_setup_where',
            'embedding_key_setup_save',
            'embedding_key_setup_never_shown',
        ]));
        const form = host.querySelector('.embedding-key-setup');
        expect(form.dataset.provider).toBe('google');
        expect(form.querySelector('input[type="password"]').name).toBe('provider_api_key');
        const link = form.querySelector('a');
        expect(link.href).toBe('https://aistudio.google.com/app/apikey');
        expect(link.rel).toBe('noopener noreferrer');
    });

    it('sends the pasted key once, then reports the provider as configured', async () => {
        endpoint
            .mockResolvedValueOnce(statusAnswer(false))
            .mockResolvedValueOnce({ saved: true, provider: 'google' })
            .mockResolvedValueOnce(statusAnswer(true));
        const host = document.createElement('div');
        document.body.appendChild(host);
        await renderEmbeddingStatusPanel(host);

        const input = host.querySelector('input[type="password"]');
        input.value = FAKE_KEY;
        host.querySelector('.embedding-key-setup').requestSubmit();
        await flush(); await flush();

        expect(endpoint).toHaveBeenNthCalledWith(2, 'saveProviderAPIKey', {
            method: 'POST',
            body_data: { provider: 'google', api_key: FAKE_KEY },
            suppressErrorToast: true,
        });
        expect(langKeysOf(host)).toContain('embedding_status_key_configured');
        expect(host.querySelector('.embedding-key-setup')).toBeNull();
        expect(host.textContent).not.toContain(FAKE_KEY);
    });

    it('says plainly when the installation keeps its settings outside the application', async () => {
        const refusal = new Error('save refused');
        refusal.status = 409;
        endpoint
            .mockResolvedValueOnce(statusAnswer(false))
            .mockRejectedValueOnce(refusal);
        const host = document.createElement('div');
        document.body.appendChild(host);
        await renderEmbeddingStatusPanel(host);

        host.querySelector('input[type="password"]').value = FAKE_KEY;
        host.querySelector('.embedding-key-setup').requestSubmit();
        await flush(); await flush();

        expect(langKeysOf(host)).toContain('embedding_key_setup_not_writable');
        expect(langKeysOf(host)).not.toContain('embedding_key_setup_saved');
        expect(langKeysOf(host)).toContain('embedding_status_key_missing');
        expect(host.querySelector('input[type="password"]').disabled).toBe(false);
        expect(host.textContent).not.toContain(FAKE_KEY);
    });
});

describe('embedding provider key form behaviour', () => {
    beforeEach(() => {
        endpoint.mockReset();
        document.body.replaceChildren();
    });

    it('asks for a value instead of sending an empty one', async () => {
        const form = renderEmbeddingProviderKeyForm({ provider: 'google' });
        document.body.appendChild(form);

        form.querySelector('input').value = '   ';
        form.requestSubmit();
        await flush();

        expect(endpoint).not.toHaveBeenCalled();
        expect(form.querySelector('.embedding-key-setup__status').dataset.langKey)
            .toBe('embedding_key_setup_required');
    });

    it('leaves out the link for a provider it has no address for', () => {
        const form = renderEmbeddingProviderKeyForm({ provider: 'unlisted' });
        expect(form.querySelector('a')).toBeNull();
        expect(form.querySelector('input[type="password"]')).not.toBeNull();
    });

    it('names each failure the administrator has to act on differently', () => {
        expect(describeKeySaveFailure({ status: 409 })).toBe('embedding_key_setup_not_writable');
        expect(describeKeySaveFailure({ status: 400 })).toBe('embedding_key_setup_rejected');
        expect(describeKeySaveFailure({ status: 500 })).toBe('embedding_key_setup_failed');
        expect(describeKeySaveFailure(new Error('offline'))).toBe('embedding_key_setup_failed');
    });

    it('has fallback copy in all four interface languages for every key of the form', () => {
        const formKeys = Object.keys(EMBEDDING_STATUS_TRANSLATION_FALLBACKS)
            .filter(key => key.startsWith('embedding_key_setup_'));
        expect(formKeys.length).toBeGreaterThan(0);
        for (const key of formKeys) {
            for (const language of ['fi', 'en', 'ch', 'yue']) {
                expect(EMBEDDING_STATUS_TRANSLATION_FALLBACKS[key][language], `${key}.${language}`)
                    .toMatch(/\S/);
            }
        }
    });
});
