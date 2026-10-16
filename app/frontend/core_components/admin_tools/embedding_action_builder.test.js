// embedding_action_builder.test.js
// Verifies toolbar POST streaming, chunk decoding and truthful failure feedback.
// Connects the real action control and parser to mocked routed responses.
// Prevents GET regressions, duplicate mutations and loss of translated progress.
import { beforeEach, afterEach, expect, test, vi } from 'vitest';
import { TextEncoder, TextDecoder } from 'node:util';
import { createEmbedButton, readEmbeddingEvents } from './embedding_action_builder.js';
import { endpoint_router } from '../endpoints/endpoint_router.js';
import { MAINTENANCE_ACTION_TRANSLATION_FALLBACKS as copy } from './maintenance_action_copy.js';

vi.mock('../endpoints/endpoint_router.js', () => ({ endpoint_router: vi.fn() }));
const state = vi.hoisted(() => ({ language: 'en' }));
vi.mock('../lang/component_language_dictionary.js', async () => {
    const { MAINTENANCE_ACTION_TRANSLATION_FALLBACKS } = await import('./maintenance_action_copy.js');
    return { getTranslationForKey: key => MAINTENANCE_ACTION_TRANSLATION_FALLBACKS[key]?.[state.language] || key };
});

function streamed(chunks) {
    const reader = {
        read: vi.fn(async () => chunks.length ? { value: chunks.shift(), done: false } : { done: true }),
        cancel: vi.fn(async () => {}), releaseLock: vi.fn(),
    };
    return { body: { getReader: () => reader }, reader };
}
beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('TextDecoder', TextDecoder);
    document.body.innerHTML = '<div id="orders_filterBar"></div>';
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); document.documentElement.removeAttribute('data-theme'); });

test.each(['fi', 'en', 'ch', 'yue'].flatMap(language => [
    { language, theme: 'light', osDark: false },
    { language, theme: 'dark', osDark: true },
    { language, theme: 'light', osDark: true },
]))('toolbar POST progress in $language / $theme / OS dark=$osDark', async ({ language, theme, osDark }) => {
    state.language = language;
    document.documentElement.dataset.theme = theme;
    vi.stubGlobal('matchMedia', () => ({ matches: osDark }));
    const response = streamed([new TextEncoder().encode('event: progress\ndata: row 1\n\nevent: done\ndata: embedded=1\n\n')]);
    vi.mocked(endpoint_router).mockResolvedValueOnce(response);
    const button = createEmbedButton('orders');
    document.body.appendChild(button);
    expect(button.textContent).toBe(copy.embedding_create_action[language]);
    button.click(); button.click();
    expect(button.disabled).toBe(true);
    await vi.waitFor(() => expect(button.disabled).toBe(false));
    expect(endpoint_router).toHaveBeenCalledTimes(1);
    expect(endpoint_router).toHaveBeenCalledWith('openaiEmbedStream', {
        method: 'POST', stream: true, url_params: '?dataset=orders', headers: { Accept: 'text/event-stream' },
    });
    const log = document.getElementById('orders_embed_log');
    expect(log.textContent).toContain(copy.embedding_stream_progress[language].replace('$count', 'row 1'));
    expect(log.textContent).toContain(copy.embedding_stream_done[language].replace('$count', 'embedded=1'));
    expect(log.querySelector('[data-lang-key^="embedding_stream_done+"]')).not.toBeNull();
    expect(response.reader.cancel).toHaveBeenCalledTimes(1);
    expect(response.reader.releaseLock).toHaveBeenCalledTimes(1);
});

test('SSE parser preserves split UTF-8, CRLF, multiline data and server errors', async () => {
    const encoded = new TextEncoder().encode(': heartbeat\r\n\r\nevent: progress\r\ndata: ää\r\ndata: next\r\n\r\nevent: error\ndata: refused\n\nevent: done\ndata: complete\n\n');
    const response = streamed(Array.from(encoded, byte => new Uint8Array([byte])));
    const events = [];
    for await (const event of readEmbeddingEvents(response)) events.push(event);
    expect(events).toEqual([
        { event: 'progress', data: 'ää\nnext' }, { event: 'error', data: 'refused' }, { event: 'done', data: 'complete' },
    ]);
});

test.each(['refusal', 'truncated', 'transport'])('%s does not retry the writer or claim completion', async failure => {
    state.language = 'en';
    if (failure === 'refusal') vi.mocked(endpoint_router).mockRejectedValueOnce(new Error('403 approval required'));
    else {
        const response = streamed([new TextEncoder().encode('event: progress\ndata: started\n\n')]);
        if (failure === 'transport') response.reader.read.mockRejectedValueOnce(new Error('connection lost'));
        vi.mocked(endpoint_router).mockResolvedValueOnce(response);
    }
    const button = createEmbedButton('orders'); document.body.appendChild(button); button.click();
    await vi.waitFor(() => expect(button.disabled).toBe(false));
    expect(endpoint_router).toHaveBeenCalledTimes(1);
    const log = document.getElementById('orders_embed_log');
    expect(log.textContent).toContain(copy.embedding_stream_interrupted.en);
    expect(log.querySelector('[data-lang-key^="embedding_stream_done"]')).toBeNull();
});
