// @vitest-environment jsdom
// missing_media_check_panel.test.js
// Verifies that the missing-media administration section reports, and never repairs.
// Bridges the mocked check endpoint and the rendered summary, notices and missing list.
// Exists so a budget that silently truncated a run, or a missing file that never
// reached the screen, fails here instead of in front of an administrator.

import { beforeEach, describe, expect, test, vi } from 'vitest';

const endpointRouterMock = vi.fn();
const registerEndpointRouteMock = vi.fn();

async function loadModule() {
    vi.resetModules();
    vi.doMock('../endpoints/endpoint_router.js', () => ({
        endpoint_router: endpointRouterMock,
    }));
    vi.doMock('../pipeline/api_pipeline.js', () => ({
        registerEndpointRoute: registerEndpointRouteMock,
    }));
    vi.doMock('../endpoints/backend_route_manifest_reader.js', () => ({
        getBackendRoutePathByHandler: () => '/api/admin/missing-media-check',
    }));
    return import('./missing_media_check_panel.js');
}

async function renderPanel() {
    const { generate_missing_media_check_panel } = await loadModule();
    const container = document.createElement('div');
    document.body.appendChild(container);
    await generate_missing_media_check_panel(container);
    return container;
}

const defaultSettings = {
    schema_version: 1,
    enabled: true,
    max_total_rows_checked: 10000,
    min_rows_per_dataset: 50,
    max_run_seconds: 120,
    run_on_startup: true,
    startup_delay_seconds: 30,
    report_unused_files: false,
    max_reported_missing: 200,
    max_reported_unused_files: 200,
};

function stateWith(overrides = {}) {
    return {
        settings: { ...defaultSettings, ...(overrides.settings || {}) },
        running: overrides.running === true,
        has_result: overrides.has_result === true,
        last_result: overrides.last_result ?? null,
    };
}

describe('missing_media_check_panel', () => {
    beforeEach(() => {
        document.body.replaceChildren();
        endpointRouterMock.mockReset();
        registerEndpointRouteMock.mockReset();
    });

    test('registers its route through the shared endpoint registry', async () => {
        endpointRouterMock.mockResolvedValue(stateWith());
        await renderPanel();
        expect(registerEndpointRouteMock).toHaveBeenCalledWith(
            'adminMissingMediaCheck',
            '/api/admin/missing-media-check',
        );
    });

    test('says so when the check has never run', async () => {
        endpointRouterMock.mockResolvedValue(stateWith());
        const container = await renderPanel();

        expect(container.textContent).toContain('The check has not run yet.');
        expect(endpointRouterMock).toHaveBeenCalledWith('adminMissingMediaCheck');
        expect(endpointRouterMock).toHaveBeenCalledTimes(1);
    });

    test('shows the stored settings without re-running the check', async () => {
        endpointRouterMock.mockResolvedValue(stateWith({
            settings: { max_total_rows_checked: 2500, max_run_seconds: 45, report_unused_files: true },
        }));
        const container = await renderPanel();

        expect(container.querySelector('[data-testid="missing-media-check-max-rows"]').value).toBe('2500');
        expect(container.querySelector('[data-testid="missing-media-check-max-seconds"]').value).toBe('45');
        expect(container.querySelector('[data-testid="missing-media-check-unused-files"]').checked).toBe(true);
        expect(container.querySelector('[data-testid="missing-media-check-enabled"]').checked).toBe(true);
    });

    test('lists the rows whose file is gone, including a retired filename form', async () => {
        endpointRouterMock.mockResolvedValue(stateWith({
            has_result: true,
            last_result: {
                schema_version: 1,
                trigger: 'startup',
                finished_at: '2026-09-23T06:00:00Z',
                datasets_total: 8,
                datasets_checked: 8,
                rows_total: 47,
                rows_checked: 47,
                missing_count: 2,
                missing_rows: [
                    {
                        dataset: 'system_about',
                        parent_row_id: 1,
                        stored_value: '117_1_4.webp',
                        expected_path: '117/1/original/117_1_4.webp',
                        reason: 'no_file_in_any_variant',
                        legacy_flat_filename: true,
                    },
                    {
                        dataset: 'dokumentaatio',
                        parent_row_id: 9,
                        stored_value: 'broken',
                        expected_path: '',
                        reason: 'unresolved_reference',
                        legacy_flat_filename: false,
                    },
                ],
            },
        }));
        const container = await renderPanel();

        const list = container.querySelector('[data-testid="missing-media-check-missing-list"]');
        expect(list.children).toHaveLength(2);
        expect(container.textContent).toContain('system_about #1');
        expect(container.textContent).toContain('117/1/original/117_1_4.webp');
        expect(container.textContent).toContain('retired filename form');
        expect(container.textContent).toContain('the reference cannot be placed on disk');
        expect(container.textContent).not.toContain('Every checked file was found on disk.');
    });

    test('says out loud that more datasets exist than the budget can reach', async () => {
        endpointRouterMock.mockResolvedValue(stateWith({
            has_result: true,
            last_result: {
                trigger: 'manual',
                finished_at: '2026-09-23T06:00:00Z',
                datasets_total: 40,
                datasets_checked: 10,
                rows_total: 900,
                rows_checked: 10,
                missing_count: 0,
                missing_rows: [],
                row_budget_reached: true,
                datasets_exceed_budget: true,
                unchecked_datasets: 30,
            },
        }));
        const container = await renderPanel();

        expect(container.textContent).toContain('some datasets were not checked at all');
        // The narrower "a sample was checked" notice must not hide the real problem.
        expect(container.textContent).not.toContain('a sample was checked instead of every row');
        expect(container.textContent).toContain('Every checked file was found on disk.');
    });

    test('reports a run that stopped on the time limit', async () => {
        endpointRouterMock.mockResolvedValue(stateWith({
            has_result: true,
            last_result: {
                trigger: 'startup',
                finished_at: '2026-09-23T06:00:00Z',
                datasets_total: 3,
                datasets_checked: 2,
                rows_total: 5000,
                rows_checked: 1200,
                missing_count: 0,
                missing_rows: [],
                time_budget_reached: true,
            },
        }));
        const container = await renderPanel();

        expect(container.textContent).toContain('the check stopped early');
        expect(container.textContent).toContain('1200 / 5000');
    });

    test('starts a run on demand and never calls a repair route', async () => {
        endpointRouterMock.mockImplementation(async (routeName, options = {}) => {
            if (routeName !== 'adminMissingMediaCheck') {
                throw new Error(`Unexpected route: ${routeName}`);
            }
            if (options.method === 'POST') {
                return { started: true, reason: '', running: true, settings: defaultSettings };
            }
            return stateWith();
        });
        const container = await renderPanel();
        const statusArea = container.querySelector('[data-testid="missing-media-check-status"]');

        container.querySelector('[data-testid="missing-media-check-run"]').click();

        await vi.waitFor(() => {
            expect(statusArea.textContent).toContain('The check is running');
        });
        expect(endpointRouterMock).toHaveBeenCalledWith('adminMissingMediaCheck', {
            method: 'POST',
            body_data: { action: 'run' },
        });
        expect(endpointRouterMock).not.toHaveBeenCalledWith('fixMediaSubfolders', expect.anything());
        expect(statusArea.getAttribute('aria-live')).toBe('polite');
    });

    test('stops saying "running" once the run has finished', async () => {
        vi.useFakeTimers();
        let running = true;
        endpointRouterMock.mockImplementation(async (routeName, options = {}) => {
            if (options.method === 'POST') {
                return { started: true, reason: '', running: true, settings: defaultSettings };
            }
            const state = stateWith({
                running,
                has_result: !running,
                last_result: running ? null : {
                    trigger: 'manual',
                    finished_at: '2026-09-23T06:00:00Z',
                    datasets_total: 1,
                    datasets_checked: 1,
                    rows_total: 2,
                    rows_checked: 2,
                    missing_count: 0,
                    missing_rows: [],
                },
            });
            running = false;
            return state;
        });
        try {
            const { generate_missing_media_check_panel } = await loadModule();
            const container = document.createElement('div');
            document.body.appendChild(container);
            await generate_missing_media_check_panel(container);
            const statusArea = container.querySelector('[data-testid="missing-media-check-status"]');

            container.querySelector('[data-testid="missing-media-check-run"]').click();
            await vi.advanceTimersByTimeAsync(0);
            expect(statusArea.textContent).toContain('The check is running');

            await vi.advanceTimersByTimeAsync(2500);
            expect(statusArea.textContent).toBe('');
            expect(statusArea.getAttribute('aria-busy')).toBe('false');
            expect(container.querySelector('[data-testid="missing-media-check-run"]').disabled).toBe(false);
        } finally {
            vi.useRealTimers();
        }
    });

    test('explains a switched-off check instead of pretending it started', async () => {
        endpointRouterMock.mockImplementation(async (routeName, options = {}) => {
            if (options.method === 'POST') {
                return { started: false, reason: 'disabled', running: false, settings: { ...defaultSettings, enabled: false } };
            }
            return stateWith({ settings: { enabled: false } });
        });
        const container = await renderPanel();
        const statusArea = container.querySelector('[data-testid="missing-media-check-status"]');

        expect(container.querySelector('[data-testid="missing-media-check-enabled"]').checked).toBe(false);
        container.querySelector('[data-testid="missing-media-check-run"]').click();

        await vi.waitFor(() => {
            expect(statusArea.textContent).toContain('switched off');
        });
        expect(container.querySelector('[data-testid="missing-media-check-run"]').disabled).toBe(false);
    });

    test('saves the visible limits while keeping the settings it does not show', async () => {
        const saved = [];
        endpointRouterMock.mockImplementation(async (routeName, options = {}) => {
            if (options.method === 'POST') {
                saved.push(options.body_data);
                return stateWith({ settings: options.body_data.settings });
            }
            return stateWith();
        });
        const container = await renderPanel();

        container.querySelector('[data-testid="missing-media-check-max-rows"]').value = '2500';
        container.querySelector('[data-testid="missing-media-check-unused-files"]').checked = true;
        container.querySelector('[data-testid="missing-media-check-save"]').click();

        await vi.waitFor(() => {
            expect(saved).toHaveLength(1);
        });
        expect(saved[0].action).toBe('save_settings');
        expect(saved[0].settings.max_total_rows_checked).toBe(2500);
        expect(saved[0].settings.report_unused_files).toBe(true);
        // Values the screen does not show must survive a save from this screen.
        expect(saved[0].settings.min_rows_per_dataset).toBe(50);
        expect(saved[0].settings.startup_delay_seconds).toBe(30);
        expect(container.textContent).toContain('Settings saved.');
    });

    test('shows the unused-file count only when that direction was requested', async () => {
        endpointRouterMock.mockResolvedValue(stateWith({
            has_result: true,
            last_result: {
                trigger: 'manual',
                finished_at: '2026-09-23T06:00:00Z',
                datasets_total: 1,
                datasets_checked: 1,
                rows_total: 4,
                rows_checked: 4,
                missing_count: 0,
                missing_rows: [],
                unused_files_requested: true,
                unused_files_count: 3,
            },
        }));
        const container = await renderPanel();

        expect(container.textContent).toContain('Unused files');
        expect(container.textContent).toContain('3');
    });

    test('reports an unreachable endpoint instead of rendering an empty section', async () => {
        endpointRouterMock.mockRejectedValue(new Error('network down'));
        const container = await renderPanel();

        expect(container.textContent).toContain('network down');
    });
});
