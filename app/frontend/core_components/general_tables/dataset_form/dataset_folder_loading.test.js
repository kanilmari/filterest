// @vitest-environment jsdom
// dataset_folder_loading.test.js
// Exercises delayed/refused folder requests through the real creation adapter.
// Connects the routed tree request to the shared form's translated status.
// Proves a pending, failed or timed-out read never looks like an empty choice.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const endpointRouterMock = vi.fn();
vi.mock('../../endpoints/endpoint_router.js', () => ({ endpoint_router: (...args) => endpointRouterMock(...args) }));
vi.mock('../../lang/translation_handler.js', () => ({ getTranslationForKey: (key, { fallback } = {}) => fallback }));

const { createDatasetFolderPicker } = await import('./dataset_folder_picker.js');
const { readNewDatasetFolderChoices } = await import('./dataset_create_source.js');
const nodes = [{ id: 'f_9', db_id: 9, name: 'Project', is_current_project: true }];

function mount() {
    const picker = createDatasetFolderPicker({ allowNewFolder: true, choices: readNewDatasetFolderChoices() });
    document.body.appendChild(picker.element);
    return { picker, status: picker.element.querySelector('.dataset-folder-status') };
}

beforeEach(() => {
    endpointRouterMock.mockReset();
    document.body.replaceChildren();
    document.documentElement.lang = 'fi';
    localStorage.clear();
});
afterEach(() => vi.useRealTimers());

describe('creation folder requests', () => {
    test('a slow answer shows translated loading and exposes choices only when settled', async () => {
        let resolve;
        endpointRouterMock.mockReturnValue(new Promise((done) => { resolve = done; }));
        const { picker, status } = mount();
        expect(status.hidden).toBe(false);
        expect(status.dataset.langKey).toBe('dataset_folder_loading');
        expect(status.textContent).toBe('Luetaan kansioita…');
        expect(picker.select.hidden).toBe(true);
        expect(picker.select.disabled).toBe(true);
        expect(picker.element.querySelector('[data-testid="dataset-new-folder-toggle"]').disabled).toBe(true);
        resolve({ nodes });
        await picker.ready;
        expect(status.hidden).toBe(true);
        expect(picker.select.hidden).toBe(false);
        expect(picker.select.disabled).toBe(false);
        expect(picker.select.value).toBe('9');
    });

    test.each(['network', '503 policy busy', 'malformed', 'empty'])('%s shows a translated failure beside the disabled choice', async (mode) => {
        localStorage.setItem('full_tree_data', JSON.stringify({ nodes }));
        if (mode === 'malformed') endpointRouterMock.mockResolvedValue({});
        else if (mode === 'empty') endpointRouterMock.mockResolvedValue({ nodes: [] });
        else endpointRouterMock.mockRejectedValue(Object.assign(new Error(mode), { status: mode.startsWith('503') ? 503 : 0 }));
        const { picker, status } = mount();
        await picker.ready;
        expect(status.hidden).toBe(false);
        expect(status.dataset.langKey).toBe('dataset_folder_unavailable');
        expect(status.textContent).toBe('Kansioita ei voitu lukea.');
        expect(picker.select.disabled).toBe(true);
        expect(picker.element.querySelector('[data-testid="dataset-new-folder-toggle"]').disabled).toBe(true);
    });

    test('a stalled request is cancelled after ten seconds and shows the translated failure', async () => {
        vi.useFakeTimers();
        let requestSignal;
        endpointRouterMock.mockImplementation((_route, { signal }) => new Promise((_resolve, reject) => {
            requestSignal = signal;
            signal.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')));
        }));
        const { picker, status } = mount();
        await vi.advanceTimersByTimeAsync(9999);
        expect(status.dataset.langKey).toBe('dataset_folder_loading');
        expect(requestSignal.aborted).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        await picker.ready;
        expect(requestSignal.aborted).toBe(true);
        expect(status.hidden).toBe(false);
        expect(status.textContent).toBe('Kansioita ei voitu lukea.');
    });
});
