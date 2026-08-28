// @vitest-environment jsdom
// Verifies that the media maintenance admin view can inspect every dataset without changing files.
// Bridges the bulk controls and mocked API routes, including protected POST requests for repairs.
// Exists to prevent a read-only bulk check from accidentally invoking the repair operation.

import { beforeEach, describe, expect, test, vi } from 'vitest';

const endpointRouterMock = vi.fn();

async function loadModule() {
    vi.resetModules();
    vi.doMock('../endpoints/endpoint_router.js', () => ({
        endpoint_router: endpointRouterMock,
    }));
    return import('./fix_media_subfolders_view.js');
}

async function renderView() {
    const { generate_fix_media_subfolders_view } = await loadModule();
    const container = document.createElement('div');
    document.body.appendChild(container);
    await generate_fix_media_subfolders_view(container);
    return container;
}

describe('fix_media_subfolders_view', () => {
    beforeEach(() => {
        document.body.replaceChildren();
        endpointRouterMock.mockReset();
    });

    test('checks every dataset without calling the repair route', async () => {
        endpointRouterMock.mockImplementation(async (routeName, options = {}) => {
            if (routeName === 'datasetNames') {
                return ['drone_images', 'articles'];
            }
            if (routeName === 'checkMediaSubfolders') {
                return options.url_params.includes('drone_images')
                    ? { rows: [{ id: 7, missing: ['300', '1000'] }] }
                    : { rows: [] };
            }
            throw new Error(`Unexpected route: ${routeName}`);
        });
        const container = await renderView();
        const results = container.querySelector('[role="status"]');

        container.querySelector('[data-testid="check-all-media-subfolders"]').click();
        expect(results.getAttribute('aria-live')).toBe('polite');
        expect(results.getAttribute('aria-busy')).toBe('true');

        await vi.waitFor(() => {
            expect(container.textContent).toContain('No files were changed.');
            expect(results.getAttribute('aria-busy')).toBe('false');
        });
        expect(container.textContent).toContain('drone_images: 1 row(s) need attention');
        expect(container.textContent).toContain('articles: OK ✓');
        expect(endpointRouterMock).toHaveBeenCalledWith('checkMediaSubfolders', {
            url_params: '?dataset=drone_images',
        });
        expect(endpointRouterMock).toHaveBeenCalledWith('checkMediaSubfolders', {
            url_params: '?dataset=articles',
        });
        expect(endpointRouterMock).not.toHaveBeenCalledWith(
            'fixMediaSubfolders',
            expect.anything(),
        );
    });

    test('uses protected POST requests for single and bulk repairs', async () => {
        endpointRouterMock.mockImplementation(async (routeName) => {
            if (routeName === 'datasetNames') {
                return ['drone_images'];
            }
            if (routeName === 'fixMediaSubfolders') {
                return { rows: [] };
            }
            throw new Error(`Unexpected route: ${routeName}`);
        });
        const container = await renderView();
        const select = container.querySelector('select');
        select.value = 'drone_images';

        const buttons = Array.from(container.querySelectorAll('button'));
        buttons.find((button) => button.textContent === 'Fix').click();
        await vi.waitFor(() => {
            expect(endpointRouterMock).toHaveBeenCalledWith('fixMediaSubfolders', {
                method: 'POST',
                url_params: '?dataset=drone_images',
            });
        });

        container.querySelector('[data-testid="fix-all-media-subfolders"]').click();
        await vi.waitFor(() => {
            const repairCalls = endpointRouterMock.mock.calls.filter(([routeName]) => (
                routeName === 'fixMediaSubfolders'
            ));
            expect(repairCalls).toHaveLength(2);
        });
        expect(endpointRouterMock).toHaveBeenLastCalledWith('fixMediaSubfolders', {
            method: 'POST',
            url_params: '?dataset=drone_images',
        });
    });

    test('reports both discovered problems and datasets that could not be checked', async () => {
        endpointRouterMock.mockImplementation(async (routeName, options = {}) => {
            if (routeName === 'datasetNames') {
                return ['drone_images', 'unavailable'];
            }
            if (routeName === 'checkMediaSubfolders' && options.url_params.includes('drone_images')) {
                return { rows: [{ id: 3, missing: ['original'] }] };
            }
            if (routeName === 'checkMediaSubfolders') {
                throw new Error('service unavailable');
            }
            throw new Error(`Unexpected route: ${routeName}`);
        });
        const container = await renderView();

        container.querySelector('[data-testid="check-all-media-subfolders"]').click();

        await vi.waitFor(() => {
            expect(container.textContent).toContain(
                'Found 1 row(s) needing attention across 1 dataset(s), with 1 error(s). No files were changed.',
            );
        });
        expect(container.textContent).toContain('unavailable: error — service unavailable');
        expect(container.querySelector('[role="status"]').getAttribute('aria-busy')).toBe('false');
    });
});
