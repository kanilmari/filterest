// @vitest-environment jsdom
// Verifies the active-dataset hero action stays admin-only and uses shared modal chrome.
// Bridges cached UI permissions, modal lifecycle, and the reusable header editor under test.
// Exists so dataset media controls cannot leak to user or guest roles.

import { beforeEach, describe, expect, test, vi } from 'vitest';

const { generateDatasetHeaderConfigViewMock } = vi.hoisted(() => ({
    generateDatasetHeaderConfigViewMock: vi.fn(),
}));

vi.mock('./dataset_header_config_view.js', () => ({
    generate_dataset_header_config_view: generateDatasetHeaderConfigViewMock,
}));

vi.mock('../navigation/main_tabs/tab_icon_library.js', () => ({
    getTabIconPath: vi.fn(() => 'M0 0h24v24H0Z'),
}));

vi.mock('../../icons/icon_loader.js', () => ({
    setElementSvgContent: vi.fn(async () => {}),
}));

async function flushAsyncWork() {
    await Promise.resolve();
    await Promise.resolve();
}

function setRolePermissions(role) {
    const permissions = role === 'admin'
        ? ['/ui/admin/dataset_header_config']
        : [];
    sessionStorage.setItem('user_permissions', JSON.stringify(permissions));
}

describe('dataset header config hero modal', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        document.body.innerHTML = '';
        sessionStorage.clear();
        history.replaceState({}, '', '/app_travel_info');
        generateDatasetHeaderConfigViewMock.mockImplementation(async (container) => {
            const marker = document.createElement('div');
            marker.dataset.testid = 'shared-dataset-header-editor';
            container.appendChild(marker);
        });
    });

    test('creates the hero settings button for an admin', async () => {
        setRolePermissions('admin');
        const { createDatasetHeaderConfigHeroButton } = await import(
            './dataset_header_config_modal.js'
        );

        const button = createDatasetHeaderConfigHeroButton('app_travel_info');

        expect(button?.dataset.testid).toBe('dataset-header-config-hero-button');
        expect(button?.dataset.titleLangKey).toBe('dataset_header_config');
        expect(button?.dataset.ariaLabelLangKey).toBe('dataset_header_config');
        expect(button?.getAttribute('aria-label')).toBe('Dataset header configuration');
        expect(button?.querySelector('svg')).toBeTruthy();
    });

    test.each(['user', 'guest'])(
        'does not create the hero settings button for the %s role',
        async (role) => {
            setRolePermissions(role);
            const { createDatasetHeaderConfigHeroButton } = await import(
                './dataset_header_config_modal.js'
            );

            expect(createDatasetHeaderConfigHeroButton('app_travel_info')).toBeNull();
        }
    );

    test('opens the shared editor for the active dataset and closes without changing route', async () => {
        setRolePermissions('admin');
        const { createDatasetHeaderConfigHeroButton } = await import(
            './dataset_header_config_modal.js'
        );
        const routeBeforeOpen = window.location.pathname;
        const button = createDatasetHeaderConfigHeroButton('app_travel_info');
        document.body.appendChild(button);

        button.click();
        await flushAsyncWork();

        expect(window.location.pathname).toBe(routeBeforeOpen);
        await vi.waitFor(() => {
            expect(generateDatasetHeaderConfigViewMock).toHaveBeenCalledWith(
                expect.any(HTMLElement),
                { initialDatasetName: 'app_travel_info' }
            );
        });
        expect(document.querySelector('[data-testid="dataset-header-config-modal"]')).toBeTruthy();
        expect(document.querySelector('[data-testid="shared-dataset-header-editor"]')).toBeTruthy();
        expect(document.getElementById('custom_modal_overlay')?.style.display).toBe('flex');

        document.querySelector('[data-testid="modal-close-button"]')?.click();

        expect(window.location.pathname).toBe(routeBeforeOpen);
        expect(document.getElementById('custom_modal_overlay')?.style.display).toBe('none');
    });
});
