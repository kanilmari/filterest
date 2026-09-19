// @vitest-environment jsdom
// dataset_image_attachments.test.js
// Verifies the picture-attachment control the dataset forms share.
// Bridges the asset-linking status with the enable and disable requests.
// Exists so pictures are turned on or off for the named dataset only.
import { beforeEach, describe, expect, test, vi } from 'vitest';

const endpointRouterMock = vi.fn();
vi.mock('../../endpoints/endpoint_router.js', () => ({
    endpoint_router: (...args) => endpointRouterMock(...args),
}));
vi.mock('../../lang/translation_handler.js', () => ({
    getTranslationForKey: (key, { fallback } = {}) => fallback,
}));

const { createDatasetImageAttachmentControl, datasetImageAttachmentCopy, readImageAttachmentState } =
    await import('./dataset_image_attachments.js');

beforeEach(() => {
    document.body.innerHTML = '';
    endpointRouterMock.mockReset();
    endpointRouterMock.mockResolvedValue({
        asset_linkings: [
            { parent_table: 'other_dataset', enabled: true },
            { parent_table: 'subscriptions', enabled: false },
        ],
    });
});

describe('dataset picture attachments', () => {
    test('the answer is read for the named dataset, never a neighbour', async () => {
        expect(await readImageAttachmentState('subscriptions')).toBe(false);
        expect(await readImageAttachmentState('other_dataset')).toBe(true);
        expect(await readImageAttachmentState('unknown_dataset')).toBe(false);
        expect(endpointRouterMock).toHaveBeenCalledWith('imageAssetLinkingStatus', {
            url_params: '?table=subscriptions',
            suppressErrorToast: true,
        });
    });

    test('turning pictures on asks the enabling route once', async () => {
        const control = createDatasetImageAttachmentControl({ datasetName: 'subscriptions' });
        document.body.appendChild(control.element);
        await control.ready;

        expect(control.input.checked).toBe(false);
        expect(control.changed()).toBe(false);
        expect(await control.save()).toBe('unchanged');

        control.input.checked = true;
        expect(control.changed()).toBe(true);
        expect(await control.save()).toBe('saved');
        expect(endpointRouterMock).toHaveBeenLastCalledWith('enableImageAssetLinking', {
            method: 'POST',
            body_data: { parent_table: 'subscriptions' },
            suppressErrorToast: true,
        });
        expect(await control.save()).toBe('unchanged');
    });

    test('turning pictures off asks the disabling route, not the enabling one', async () => {
        const control = createDatasetImageAttachmentControl({ datasetName: 'other_dataset' });
        document.body.appendChild(control.element);
        await control.ready;

        expect(control.input.checked).toBe(true);
        control.input.checked = false;
        expect(await control.save()).toBe('saved');
        expect(endpointRouterMock).toHaveBeenLastCalledWith('disableImageAssetLinking', expect.objectContaining({
            body_data: { parent_table: 'other_dataset' },
        }));
    });

    test('an unreadable setting is shown as unknown rather than as off', async () => {
        endpointRouterMock.mockRejectedValue(new Error('network'));
        const control = createDatasetImageAttachmentControl({ datasetName: 'subscriptions' });
        document.body.appendChild(control.element);
        await control.ready;

        expect(control.input.disabled).toBe(true);
        expect(control.element.querySelector('.dataset-image-attachments-status').textContent)
            .toBe(datasetImageAttachmentCopy().unavailable);
        expect(await control.save()).toBe('unchanged');
    });

    test('a refused save reports beside the control', async () => {
        const control = createDatasetImageAttachmentControl({ datasetName: 'subscriptions' });
        document.body.appendChild(control.element);
        await control.ready;

        control.input.checked = true;
        endpointRouterMock.mockRejectedValueOnce(new Error('denied'));
        expect(await control.save()).toBe('failed');
        expect(control.element.querySelector('.dataset-image-attachments-status').textContent)
            .toBe(datasetImageAttachmentCopy().saveFailed);
    });
});
