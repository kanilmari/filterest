// @vitest-environment jsdom
// missing_media_check_panel.test.js
// Verifies that the missing-media administration section reports, never repairs, and offers every setting.
// Bridges the mocked check endpoint and the rendered settings, actions, notices and missing list.
// Exists so a budget that silently truncated a run, a setting the screen cannot reach, or a
// missing file that never reached the screen fails here instead of in front of an administrator.

import { beforeEach, describe, expect, test, vi } from 'vitest';
import { MISSING_MEDIA_CHECK_TRANSLATION_FALLBACKS as COPY } from './missing_media_check_translation_fallbacks.js';

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
    schema_version: 2,
    enabled: true,
    max_total_rows_checked: 10000,
    min_rows_per_dataset: 50,
    sampling: 'even',
    max_run_seconds: 120,
    run_on_startup: false,
    run_after_update: true,
    startup_delay_seconds: 30,
    exact_count_max_rows: 100000,
    report_unused_files: false,
    max_reported_missing: 200,
    max_reported_unused_files: 200,
};

// The ranges the server's own table answers with.
const limits = {
    max_total_rows_checked: { min: 1, max: 5000000 },
    min_rows_per_dataset: { min: 1, max: 100000 },
    max_run_seconds: { min: 1, max: 3600 },
    startup_delay_seconds: { min: 0, max: 3600 },
    exact_count_max_rows: { min: 1000, max: 10000000 },
    max_reported_missing: { min: 1, max: 5000 },
    max_reported_unused_files: { min: 1, max: 5000 },
};

function stateWith(overrides = {}) {
    return {
        settings: { ...defaultSettings, ...(overrides.settings || {}) },
        limits,
        sampling_methods: ['even', 'random'],
        settings_problem: overrides.settings_problem,
        running: overrides.running === true,
        has_result: overrides.has_result === true,
        last_result: overrides.last_result ?? null,
    };
}

const byTestId = (container, testId) => container.querySelector(`[data-testid="${testId}"]`);

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

    test('shows every setting, each number within the range the server allows', async () => {
        endpointRouterMock.mockResolvedValue(stateWith({
            settings: { max_total_rows_checked: 2500, max_run_seconds: 45, report_unused_files: true, sampling: 'random', run_on_startup: true },
        }));
        const container = await renderPanel();

        expect(byTestId(container, 'missing-media-check-max-rows').value).toBe('2500');
        expect(byTestId(container, 'missing-media-check-max-seconds').value).toBe('45');
        expect(byTestId(container, 'missing-media-check-unused-files').checked).toBe(true);
        expect(byTestId(container, 'missing-media-check-enabled').checked).toBe(true);
        expect(byTestId(container, 'missing-media-check-run-on-startup').checked).toBe(true);
        expect(byTestId(container, 'missing-media-check-run-after-update').checked).toBe(true);
        expect(byTestId(container, 'missing-media-check-min-rows').value).toBe('50');
        expect(byTestId(container, 'missing-media-check-startup-delay').value).toBe('30');
        expect(byTestId(container, 'missing-media-check-exact-count').value).toBe('100000');
        expect(byTestId(container, 'missing-media-check-max-reported-missing').value).toBe('200');
        expect(byTestId(container, 'missing-media-check-max-reported-unused').value).toBe('200');

        const exactCount = byTestId(container, 'missing-media-check-exact-count');
        expect([exactCount.min, exactCount.max]).toEqual(['1000', '10000000']);
        expect(byTestId(container, 'missing-media-check-exact-count-range').textContent).toBe('1000–10000000');
        expect(byTestId(container, 'missing-media-check-startup-delay').min).toBe('0');

        const sampling = byTestId(container, 'missing-media-check-sampling');
        expect([...sampling.options].map((option) => option.value)).toEqual(['even', 'random']);
        expect([...sampling.options].map((option) => option.dataset.langKey)).toEqual([
            'missing_media_check_sampling_even',
            'missing_media_check_sampling_random',
        ]);
        expect(sampling.value).toBe('random');
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

        const list = byTestId(container, 'missing-media-check-missing-list');
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
                minimum_per_dataset_met: false,
                unchecked_datasets: 30,
            },
        }));
        const container = await renderPanel();

        expect(container.textContent).toContain('some datasets were not checked at all');
        // The narrower notices must not hide the real problem.
        expect(container.textContent).not.toContain('a sample was checked instead of every row');
        expect(container.textContent).not.toContain('too small to check the minimum');
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
        const statusArea = byTestId(container, 'missing-media-check-status');

        byTestId(container, 'missing-media-check-run').click();

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
            const statusArea = byTestId(container, 'missing-media-check-status');

            byTestId(container, 'missing-media-check-run').click();
            await vi.advanceTimersByTimeAsync(0);
            expect(statusArea.textContent).toContain('The check is running');

            await vi.advanceTimersByTimeAsync(2500);
            expect(statusArea.textContent).toBe('');
            expect(statusArea.getAttribute('aria-busy')).toBe('false');
            expect(byTestId(container, 'missing-media-check-run').disabled).toBe(false);
        } finally {
            vi.useRealTimers();
        }
    });

    test('keeps a setting being typed while a running check is polled', async () => {
        vi.useFakeTimers();
        let reads = 0;
        endpointRouterMock.mockImplementation(async (routeName, options = {}) => {
            if (options.method === 'POST') {
                return { started: true, reason: '', running: true, settings: defaultSettings };
            }
            reads += 1;
            return stateWith({ running: reads >= 2 && reads <= 3 });
        });
        try {
            const { generate_missing_media_check_panel } = await loadModule();
            const container = document.createElement('div');
            document.body.appendChild(container);
            await generate_missing_media_check_panel(container);

            byTestId(container, 'missing-media-check-run').click();
            await vi.advanceTimersByTimeAsync(0);
            byTestId(container, 'missing-media-check-max-rows').value = '777';
            await vi.advanceTimersByTimeAsync(6500);

            expect(reads).toBe(4);
            expect(byTestId(container, 'missing-media-check-max-rows').value).toBe('777');
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
        const statusArea = byTestId(container, 'missing-media-check-status');

        expect(byTestId(container, 'missing-media-check-enabled').checked).toBe(false);
        byTestId(container, 'missing-media-check-run').click();

        await vi.waitFor(() => {
            expect(statusArea.textContent).toContain('switched off');
        });
        expect(byTestId(container, 'missing-media-check-run').disabled).toBe(false);
    });

    test('explains stored settings it cannot read, and a run refused because of them', async () => {
        const problem = 'the stored missing media check settings cannot be read: the stored value is not a JSON object';
        endpointRouterMock.mockImplementation(async (routeName, options = {}) => {
            if (options.method === 'POST') {
                return { started: false, reason: 'settings_problem', running: false, settings: defaultSettings, settings_problem: problem };
            }
            return stateWith({ settings_problem: problem });
        });
        const container = await renderPanel();
        const problemArea = byTestId(container, 'missing-media-check-settings-problem');

        expect(problemArea.textContent).toContain('The stored settings could not be read');
        expect(problemArea.textContent).toContain('not a JSON object');

        byTestId(container, 'missing-media-check-run').click();
        await vi.waitFor(() => {
            expect(byTestId(container, 'missing-media-check-status').textContent).toContain('the check does not run');
        });
        expect(byTestId(container, 'missing-media-check-run').disabled).toBe(false);
    });

    test('saves every setting while keeping the values the screen does not show', async () => {
        const saved = [];
        endpointRouterMock.mockImplementation(async (routeName, options = {}) => {
            if (options.method === 'POST') {
                saved.push(options.body_data);
                return stateWith({ settings: options.body_data.settings });
            }
            return stateWith();
        });
        const container = await renderPanel();

        byTestId(container, 'missing-media-check-max-rows').value = '2500';
        byTestId(container, 'missing-media-check-unused-files').checked = true;
        byTestId(container, 'missing-media-check-run-on-startup').checked = true;
        byTestId(container, 'missing-media-check-sampling').value = 'random';
        byTestId(container, 'missing-media-check-exact-count').value = '5000';
        byTestId(container, 'missing-media-check-save').click();

        await vi.waitFor(() => {
            expect(saved).toHaveLength(1);
        });
        expect(saved[0].action).toBe('save_settings');
        expect(saved[0].settings).toEqual({
            ...defaultSettings,
            max_total_rows_checked: 2500,
            report_unused_files: true,
            run_on_startup: true,
            sampling: 'random',
            exact_count_max_rows: 5000,
        });
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

        expect(container.textContent).toContain('Files no recognised reference uses');
        expect(container.textContent).toContain('3');
    });

    test('reports an unreachable endpoint instead of rendering an empty section', async () => {
        endpointRouterMock.mockRejectedValue(new Error('network down'));
        const container = await renderPanel();

        expect(container.textContent).toContain('network down');
    });

    test('every text of the section has copy in all four languages', async () => {
        endpointRouterMock.mockResolvedValue(stateWith({
            settings_problem: 'unreadable',
            has_result: true,
            last_result: {
                schema_version: 2,
                trigger: 'update',
                finished_at: '2026-09-29T10:00:00Z',
                app_version: '9.3.19',
                db_version: '9.9.2',
                rows_checked: 3,
                rows_total: 3,
                missing_rows: [],
                failed: true,
                time_budget_reached: true,
                errors: ['stopped'],
                datasets: [{ dataset: 'system_about', row_count: 3, planned_rows: 3, checked_rows: 3, complete: true }],
            },
        }));
        const container = await renderPanel();

        for (const [key, copy] of Object.entries(COPY)) {
            for (const language of ['fi', 'en', 'ch', 'yue']) {
                expect(String(copy[language] || '').trim(), `${key}.${language}`).not.toBe('');
            }
        }
        const rendered = [...container.querySelectorAll('[data-lang-key]')]
            .map((element) => element.dataset.langKey.split('+')[0]);
        expect(rendered.length).toBeGreaterThan(20);
        for (const key of rendered) {
            expect(COPY[key], key).toBeDefined();
        }
    });
});
