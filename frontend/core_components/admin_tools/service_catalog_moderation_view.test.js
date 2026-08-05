// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from 'vitest';

const performNavigationMock = vi.fn();
const refreshTableUnifiedMock = vi.fn();
const updateURLMock = vi.fn();

async function loadModule() {
    vi.resetModules();
    vi.doMock('../navigation/nav_engine/navigation_handler.js', () => ({
        performNavigation: performNavigationMock,
    }));
    vi.doMock('../general_tables/gt_1_row_crud/gt_1_2_row_read/table_refresh_unified.js', () => ({
        refreshTableUnified: refreshTableUnifiedMock,
    }));
    vi.doMock('../navigation/nav_engine/query_params.js', () => ({
        updateURL: updateURLMock,
    }));
    return import('./service_catalog_moderation_view.js');
}

describe('service_catalog_moderation_view', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        performNavigationMock.mockReset();
        refreshTableUnifiedMock.mockReset();
        updateURLMock.mockReset();
        performNavigationMock.mockResolvedValue(undefined);
        refreshTableUnifiedMock.mockResolvedValue(undefined);
    });

    test('renders moderation presets and routes them through the normal dataset view', async () => {
        const { generate_service_catalog_moderation_view } = await loadModule();
        const container = document.createElement('div');

        await generate_service_catalog_moderation_view(container);

        expect(container.textContent).toContain('Service Catalog Moderation');
        expect(container.textContent).toContain('Needs review');
        expect(container.textContent).toContain('Unpublished entries');

        const reviewQueueButton = container.querySelector('[data-testid="service_catalog_moderation_review_queue"]');
        reviewQueueButton.dispatchEvent(new Event('click', { bubbles: true }));
        await Promise.resolve();

        expect(updateURLMock).toHaveBeenCalledWith('app_service_catalog', {
            admin_reviewed: 'false',
            sort_column: 'updated',
            sort_order: 'DESC',
        });
        expect(performNavigationMock).toHaveBeenCalledWith(
            'app_service_catalog',
            'app_service_catalog_container',
            expect.any(Function),
            null,
            false
        );
    });
});
