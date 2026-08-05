// openai_key_setup_printer.test.js
// Verifies the inline OpenAI key prompt remains multilingual and secret-safe in the browser.
// Bridges DOM form interactions with a mocked admin configuration endpoint.
// Exists to prevent raw-key display and regressions to an error-only chat experience.
// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from 'vitest';

const { endpointRouterMock } = vi.hoisted(() => ({
    endpointRouterMock: vi.fn(),
}));

vi.mock('../../endpoints/endpoint_router.js', () => ({
    endpoint_router: endpointRouterMock,
}));

import { renderOpenAIKeySetupPrompt } from './openai_key_setup_printer.js';

describe('renderOpenAIKeySetupPrompt', () => {
    beforeEach(() => {
        endpointRouterMock.mockReset();
        endpointRouterMock.mockResolvedValue({ saved: true });
        localStorage.clear();
        document.body.innerHTML = '<div class="chat-bubble"><div class="chat-text"></div></div>';
    });

    test.each([
        ['en', 'Connect OpenAI'],
        ['fi', 'Yhdistä OpenAI'],
        ['zh', '连接 OpenAI'],
        ['ch', '连接 OpenAI'],
        ['yue', '連接 OpenAI'],
    ])('renders localized setup copy for %s', (language, expectedTitle) => {
        document.documentElement.lang = language;
        renderOpenAIKeySetupPrompt(document.querySelector('.chat-bubble'));

        expect(document.querySelector('.chat-openai-key-setup__title')?.textContent).toBe(expectedTitle);
        expect(document.querySelector('input')?.type).toBe('password');
        expect(document.querySelector('input')?.autocomplete).toBe('new-password');
        expect(document.querySelector('a[href="https://platform.openai.com/api-keys"]')).not.toBeNull();
        expect(document.querySelector('a[href^="mailto:support@filterest.fi"]')).not.toBeNull();
    });

    test('submits the secret once, clears it, and invokes retry', async () => {
        document.documentElement.lang = 'en';
        const onSaved = vi.fn();
        renderOpenAIKeySetupPrompt(document.querySelector('.chat-bubble'), { onSaved });

        const input = document.querySelector('input');
        input.value = 'test-browser-secret';
        document.querySelector('form').dispatchEvent(new Event('submit', {
            bubbles: true,
            cancelable: true,
        }));

        await vi.waitFor(() => {
            expect(endpointRouterMock).toHaveBeenCalledWith('saveOpenAIAPIKey', {
                method: 'POST',
                body_data: { api_key: 'test-browser-secret' },
            });
            expect(onSaved).toHaveBeenCalledOnce();
        });
        expect(input.value).toBe('');
        expect(document.body.textContent).not.toContain('test-browser-secret');
    });
});
