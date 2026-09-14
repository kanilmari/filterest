// table_remover.test.js
// Verifies reversible defaults, exact-name deletion and stateful localized dialogs.
// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, test, vi } from 'vitest';

const endpoint = vi.fn();
const hideParent = vi.fn();
const toast = vi.fn();
const redirect = vi.fn();
const clearSelection = vi.fn();
const notice = vi.fn();
const replaceLocation = vi.fn();
const cleanups = [];
const nextFrame = async () => { await new Promise(resolve => setTimeout(resolve, 0)); };

async function load() {
    vi.resetModules();
    vi.doMock('../../../endpoints/endpoint_router.js', () => ({ endpoint_router: endpoint }));
    vi.doMock('../../../../reusable_components/notifications/toast_notification_printer.js', () => ({ showSuccessToast: toast }));
    vi.doMock('../../../state_stores/dataset_selection_saver.js', () => ({ clearDatasetSelectionState: clearSelection, setRedirectNotice: notice }));
    vi.doMock('../../../navigation/root_redirect_handler.js', () => ({ redirectToRootInSpa: redirect }));
    vi.doMock('../../../lang/translation_handler.js', () => ({ getTranslationForKey: key => key }));
    vi.doMock('../../../../reusable_components/modal/modal_builder.js', () => ({
        hideModal: hideParent,
        createStackedModal: ({ contentElements, cleanupCallback }) => {
            const modal = document.createElement('section');
            modal.append(document.createElement('h2'), ...contentElements);
            document.body.appendChild(modal);
            cleanups.push(cleanupCallback);
            return {
                modal,
                show: vi.fn(),
                hide: () => { modal.remove(); cleanupCallback(); },
            };
        },
    }));
    return import('./table_remover.js');
}

describe('dataset removal', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        document.body.innerHTML = '';
        document.documentElement.lang = 'en';
        Object.defineProperty(window, 'location', {
            value: { ...window.location, replace: replaceLocation }, configurable: true,
        });
        localStorage.clear();
        redirect.mockResolvedValue(undefined);
        endpoint.mockImplementation(async (route, options) => {
            if (route === 'adminDatasetUiVisibility') {
                return { dataset_name: 'real_table', ui_hidden: true };
            }
            return { message: 'ok' };
        });
    });
    afterEach(() => { cleanups.splice(0).forEach(cleanup => cleanup()); });
    const byId = id => document.querySelector('[data-testid="' + id + '"]');
    const submit = () => byId('dataset-removal-dialog').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    test('defaults to UI removal, verifies readback and never drops data', async () => {
        const { drop_table } = await load();
        drop_table('real_table');
        expect(byId('dataset-removal-mode-hide').checked).toBe(true);
        expect(byId('dataset-removal-confirm-name').disabled).toBe(true);
        expect(byId('dataset-removal-confirm').textContent).toBe('Delete from UI');
        submit();
        await nextFrame();
        expect(endpoint).toHaveBeenCalledWith('adminDatasetUiVisibility', expect.objectContaining({
            method: 'POST', body_data: { dataset_name: 'real_table', ui_hidden: true },
        }));
        expect(endpoint).toHaveBeenCalledWith('adminDatasetUiVisibility', expect.objectContaining({
            url_params: '?dataset_name=real_table',
        }));
        expect(endpoint.mock.calls.some(([route]) => route === 'dropDataset')).toBe(false);
        expect(redirect).toHaveBeenCalledTimes(1);
        expect(notice).toHaveBeenCalledWith({ datasetName: 'real_table', reason: 'hidden', messageLangKey: 'manage_table_hidden_success' });
    });

    test('permanent deletion needs the exact real name and sends its separate confirmation', async () => {
        const { drop_table } = await load();
        drop_table('real_table');
        byId('dataset-removal-mode-permanent').click();
        const input = byId('dataset-removal-confirm-name');
        expect(byId('dataset-removal-irreversible-warning').hidden).toBe(false);
        for (const value of ['', 'display name', 'REAL_TABLE', ' real_table ', 'real_table\n']) {
            input.value = value;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            // Text inputs normalize newlines; the other wrong values remain mismatches.
            if (input.value === 'real_table') continue;
            expect(byId('dataset-removal-confirm').disabled).toBe(true);
            submit();
            expect(endpoint).not.toHaveBeenCalled();
        }
        input.value = 'real_table';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        expect(byId('dataset-removal-confirm').disabled).toBe(false);
        submit();
        await nextFrame();
        expect(endpoint).toHaveBeenCalledExactlyOnceWith('dropDataset', expect.objectContaining({
            method: 'POST',
            body_data: { dataset_name: 'real_table', confirm_dataset_name: 'real_table' },
        }));
        expect(notice).toHaveBeenCalledWith({ datasetName: 'real_table', reason: 'deleted', messageLangKey: 'manage_table_deleted_success' });
    });

    test('language changes preserve confirmation draft, mode, focus and caret without writes', async () => {
        const { drop_table } = await load();
        drop_table('real_table');
        byId('dataset-removal-mode-permanent').click();
        const input = byId('dataset-removal-confirm-name');
        input.value = 'real_';
        input.focus();
        input.setSelectionRange(2, 4);
        for (const [lang, cancel, confirm] of [
            ['fi', 'Peruuta', 'Poista pysyvästi'],
            ['en', 'Cancel', 'Delete permanently'],
            ['ch', '取消', '永久删除'],
            ['yue', '取消', '永久刪除'],
            ['fi', 'Peruuta', 'Poista pysyvästi'],
        ]) {
            document.documentElement.lang = lang;
            await nextFrame();
            expect(byId('dataset-removal-cancel').textContent).toBe(cancel);
            expect(byId('dataset-removal-confirm').textContent).toBe(confirm);
            expect(input.value).toBe('real_');
            expect(document.activeElement).toBe(input);
            expect([input.selectionStart, input.selectionEnd]).toEqual([2, 4]);
            expect(byId('dataset-removal-mode-permanent').checked).toBe(true);
        }
        expect(endpoint).not.toHaveBeenCalled();
    });

    test('cancel retains the underlying editor draft and disconnects localization', async () => {
        const draft = document.createElement('input');
        draft.value = 'unsaved column';
        document.body.appendChild(draft);
        const { drop_table } = await load();
        drop_table('real_table');
        const button = byId('dataset-removal-confirm');
        byId('dataset-removal-cancel').click();
        document.documentElement.lang = 'fi';
        await nextFrame();
        expect(draft.isConnected).toBe(true);
        expect(draft.value).toBe('unsaved column');
        expect(button.textContent).toBe('Delete from UI');
        expect(endpoint).not.toHaveBeenCalled();
        expect(hideParent).not.toHaveBeenCalled();
    });

    test('failed/mismatched visibility readback keeps the dialog and does not report success', async () => {
        endpoint.mockResolvedValue({ dataset_name: 'some_other_table', ui_hidden: true });
        const { drop_table } = await load();
        drop_table('real_table');
        submit();
        await nextFrame();
        expect(byId('dataset-removal-dialog')).not.toBeNull();
        expect(document.querySelector('[role="alert"]').hidden).toBe(false);
        expect(byId('dataset-removal-confirm').disabled).toBe(false);
        expect(redirect).not.toHaveBeenCalled();
        expect(toast).not.toHaveBeenCalled();
    });

    test('in-flight confirmation cannot send duplicate mutations', async () => {
        let resolve;
        endpoint.mockReturnValue(new Promise(r => { resolve = r; }));
        const { drop_table } = await load();
        drop_table('real_table');
        submit();
        submit();
        expect(endpoint).toHaveBeenCalledTimes(1);
        expect(byId('dataset-removal-confirm').disabled).toBe(true);
        resolve({ dataset_name: 'wrong', ui_hidden: true });
        await nextFrame();
    });

    test('queues a localized result before falling back to a full root reload', async () => {
        redirect.mockRejectedValue(new Error('bootstrap unavailable'));
        const { drop_table } = await load();
        drop_table('real_table');
        submit();
        await nextFrame();
        expect(notice).toHaveBeenCalledWith({
            datasetName: 'real_table', reason: 'hidden', messageLangKey: 'manage_table_hidden_success',
        });
        expect(replaceLocation).toHaveBeenCalledWith('/');
        expect(notice.mock.invocationCallOrder[0]).toBeLessThan(replaceLocation.mock.invocationCallOrder[0]);
    });

});
