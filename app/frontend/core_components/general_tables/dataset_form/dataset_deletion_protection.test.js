// @vitest-environment jsdom
// dataset_deletion_protection.test.js
// Verifies the deletion-protection control the dataset forms share.
// Bridges the dataset-settings read with the switch the editing form shows.
// Exists so the protection is never guessed from an answer about another dataset.
import { beforeEach, describe, expect, test, vi } from 'vitest';

const endpointRouterMock = vi.fn();
vi.mock('../../endpoints/endpoint_router.js', () => ({
    endpoint_router: (...args) => endpointRouterMock(...args),
}));
vi.mock('../../lang/translation_handler.js', () => ({
    getTranslationForKey: (key, { fallback } = {}) => fallback,
}));

const {
    createDatasetDeletionProtectionControl,
    datasetDeletionProtectionCopy,
    readDeletionProtection,
} = await import('./dataset_deletion_protection.js');

beforeEach(() => {
    document.body.innerHTML = '';
    endpointRouterMock.mockReset();
    endpointRouterMock.mockResolvedValue({ dataset_name: 'subscriptions', prevent_deletion: true });
});

describe('dataset deletion protection', () => {
    test('the setting is read for the named dataset only', async () => {
        expect(await readDeletionProtection('subscriptions')).toBe(true);
        expect(endpointRouterMock).toHaveBeenCalledWith('modifyColumns', {
            url_params: '?dataset_name=subscriptions',
            suppressErrorToast: true,
        });
    });

    test('an answer about another dataset is refused instead of being shown', async () => {
        endpointRouterMock.mockResolvedValue({ dataset_name: 'other_dataset', prevent_deletion: true });
        await expect(readDeletionProtection('subscriptions')).rejects.toThrow();

        endpointRouterMock.mockResolvedValue({ dataset_name: 'subscriptions' });
        await expect(readDeletionProtection('subscriptions')).rejects.toThrow();
    });

    test('the switch shows the current protection and reports what the person changed', async () => {
        const control = createDatasetDeletionProtectionControl({ datasetName: 'subscriptions' });
        document.body.appendChild(control.element);
        await control.ready;

        expect(control.input.checked).toBe(true);
        expect(control.changed()).toBe(false);

        control.input.checked = false;
        expect(control.changed()).toBe(true);
        expect(control.value()).toBe(false);

        // A saved choice is remembered, so a second Save sends nothing new.
        control.accept();
        expect(control.changed()).toBe(false);
    });

    test('an unreadable setting is shown as unknown rather than as unprotected', async () => {
        endpointRouterMock.mockRejectedValue(new Error('network'));
        const control = createDatasetDeletionProtectionControl({ datasetName: 'subscriptions' });
        document.body.appendChild(control.element);
        await control.ready;

        expect(control.input.disabled).toBe(true);
        expect(control.changed()).toBe(false);
        expect(control.element.querySelector('.dataset-deletion-protection-status').textContent)
            .toBe(datasetDeletionProtectionCopy().unavailable);
    });
});
