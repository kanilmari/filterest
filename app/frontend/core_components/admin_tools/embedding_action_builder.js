// embedding_action_builder.js
// Starts an administrator embedding POST and renders its streamed progress.
// Connects the dataset toolbar to the CSRF/session-aware endpoint pipeline.
// A finite fetch stream avoids EventSource GET mutations and automatic retries.
import { endpoint_router } from '../endpoints/endpoint_router.js';
import { getTranslationForKey } from '../lang/component_language_dictionary.js';
import { applyTranslationVariable } from '../lang/translation_handler_helpers.js';

/** Reads complete SSE frames across network and UTF-8 boundaries, once only. */
export async function* readEmbeddingEvents(response) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
        while (true) {
            const { value, done } = await reader.read();
            buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
            const frames = buffer.split(/\r?\n\r?\n/);
            buffer = frames.pop();
            if (done && buffer) frames.push(buffer);
            for (const frame of frames) {
                let event = 'message';
                const data = [];
                for (const line of frame.split(/\r?\n/)) {
                    if (line.startsWith('event:')) event = line.slice(6).trim();
                    if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
                }
                if (!['progress', 'error', 'done'].includes(event)) continue;
                yield { event, data: data.join('\n') };
                if (event === 'done') return;
            }
            if (done) throw new Error('embedding stream ended without completion');
        }
    } finally {
        try { await reader.cancel(); } finally { reader.releaseLock(); }
    }
}

function translatedElement(tag, key, value = null) {
    const element = document.createElement(tag);
    element.dataset.langKey = value === null ? key : `${key}+${value}`;
    element.textContent = applyTranslationVariable(getTranslationForKey(key), value);
    return element;
}

/** Starts one approved mutation; a transport failure never resubmits the POST. */
export async function embedAllData(dataset) {
    const logId = `${dataset}_embed_log`;
    let log = document.getElementById(logId);
    if (!log) {
        log = document.createElement('div');
        log.id = logId;
        log.classList.add('fw-card', 'fw-text-sm');
        log.setAttribute('role', 'log');
        log.style.maxHeight = '200px';
        log.style.overflowY = 'auto';
        document.getElementById(`${dataset}_filterBar`)?.appendChild(log);
    }
    try {
        const response = await endpoint_router('openaiEmbedStream', {
            method: 'POST', stream: true,
            url_params: `?dataset=${encodeURIComponent(dataset)}`,
            headers: { Accept: 'text/event-stream' },
        });
        for await (const { event, data } of readEmbeddingEvents(response)) {
            log.appendChild(translatedElement('p', `embedding_stream_${event}`, data));
            log.scrollTop = log.scrollHeight;
        }
    } catch (error) {
        console.warn('Embedding stream failed:', error);
        log.appendChild(translatedElement('p', 'embedding_stream_interrupted'));
    }
}

/** Disables the trigger until its single streaming request finishes. */
export function createEmbedButton(dataset) {
    const button = translatedElement('button', 'embedding_create_action');
    button.type = 'button';
    button.classList.add('fw-btn');
    button.addEventListener('click', async () => {
        button.disabled = true;
        try { await embedAllData(dataset); } finally { button.disabled = false; }
    });
    return button;
}
