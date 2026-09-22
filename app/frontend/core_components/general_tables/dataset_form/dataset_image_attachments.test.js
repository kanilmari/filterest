// @vitest-environment jsdom
// dataset_image_attachments.test.js
// Verifies the dataset form's picture switch in both modes, and its routes.
// Bridges the asset-linking status with the enable and disable requests.
// Exists so pictures are turned on or off for the named dataset only, and a
// setting that cannot be read is never shown as off.
import { beforeEach, describe, expect, test, vi } from 'vitest';

const endpointRouterMock = vi.fn();
vi.mock('../../endpoints/endpoint_router.js', () => ({
    endpoint_router: (...args) => endpointRouterMock(...args),
}));
vi.mock('../../lang/translation_handler.js', () => ({
    getTranslationForKey: (key, { fallback } = {}) => fallback,
}));

const { createDatasetImageAttachmentControl, readImageAttachmentState, setImageAttachments } =
    await import('./dataset_image_attachments.js');

function mount(settings) {
    const control = createDatasetImageAttachmentControl(settings);
    document.body.appendChild(control.element);
    return control;
}
const status = (control) => control.element.querySelector('.dataset-image-attachments-status');

beforeEach(() => {
    document.body.innerHTML = '';
    document.documentElement.lang = 'en';
    endpointRouterMock.mockReset();
    endpointRouterMock.mockResolvedValue({
        asset_linkings: [
            { parent_table: 'other_dataset', enabled: true },
            { parent_table: 'subscriptions', enabled: false },
        ],
    });
});

describe('dataset picture switch', () => {
    test('the answer is read for the named dataset, never a neighbour', async () => {
        expect(await readImageAttachmentState('subscriptions')).toBe(false);
        expect(await readImageAttachmentState('other_dataset')).toBe(true);
        expect(await readImageAttachmentState('unknown_dataset')).toBe(false);
        expect(endpointRouterMock).toHaveBeenCalledWith('imageAssetLinkingStatus', {
            url_params: '?table=subscriptions',
            suppressErrorToast: true,
        });
    });

    test('a new dataset offers pictures unless the person turns them off', async () => {
        const control = mount();
        await control.ready;
        expect(control.input.disabled).toBe(false);
        expect(control.value()).toBe(true);
        control.input.checked = false;
        expect(control.value()).toBe(false);
    });

    test('an existing dataset shows what it offers and reports only a change', async () => {
        const control = mount({ stored: readImageAttachmentState('subscriptions') });
        expect(control.input.disabled).toBe(true);
        await control.ready;
        expect(control.input.checked).toBe(false);
        expect(control.changed()).toBe(false);
        control.input.checked = true;
        expect(control.changed()).toBe(true);
        control.accept();
        expect(control.changed()).toBe(false);
    });

    test('an unreadable setting is shown as unknown rather than as off', async () => {
        const control = mount({ stored: Promise.reject(new Error('network')) });
        await control.ready;
        expect(control.input.disabled).toBe(true);
        expect(control.changed()).toBe(false);
        expect(status(control).textContent).toBe('The picture setting could not be read.');
    });

    test('a refused save is reported beside the switch', async () => {
        const control = mount({ stored: Promise.resolve(false) });
        await control.ready;
        control.reportFailure();
        expect(status(control).hidden).toBe(false);
        expect(status(control).textContent).toBe('The picture setting could not be saved.');
    });

    test('turning pictures on and off asks the matching route for the named dataset', async () => {
        endpointRouterMock.mockResolvedValue({ message: 'ok' });
        await setImageAttachments('subscriptions', true);
        expect(endpointRouterMock).toHaveBeenLastCalledWith('enableImageAssetLinking', {
            method: 'POST', body_data: { parent_table: 'subscriptions' }, suppressErrorToast: true,
        });
        await setImageAttachments('other_dataset', false);
        expect(endpointRouterMock).toHaveBeenLastCalledWith('disableImageAssetLinking', expect.objectContaining({
            body_data: { parent_table: 'other_dataset' },
        }));
    });
});
