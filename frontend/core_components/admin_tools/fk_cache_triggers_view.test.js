// fk_cache_triggers_view.test.js
// Verifies the FK cache maintenance view uses the stable endpoint wrappers for load and refresh.
// Bridges the rendered admin table, typed maintenance actions, and toast feedback under test control.
// Exists to keep the Phase B pilot migration wired to the stable API island instead of the generic router.

import { beforeEach, describe, expect, test, vi } from 'vitest';

const fetchFKCacheTriggersMock = vi.fn();
const refreshFKCacheTriggerMock = vi.fn();
const showToastMock = vi.fn();

function buildTrigger(overrides = {}) {
    return {
        id: 7,
        source_table: 'orders',
        source_column: 'customer_id',
        target_table: 'customers',
        target_column: 'id',
        join_column: 'customer_name',
        trigger_name: 'orders_customer_cache_trigger',
        function_name: 'refresh_orders_customer_cache',
        trigger_events: 'UPDATE',
        enabled: true,
        trigger_exists: true,
        notes: '',
        cached_count: 3,
        stale_count: 0,
        ...overrides,
    };
}

async function flushAsyncWork() {
    await Promise.resolve();
    await Promise.resolve();
}

async function loadModule() {
    vi.resetModules();
    vi.doMock('../endpoints/stable_endpoint_router.js', () => ({
        fetchFKCacheTriggers: fetchFKCacheTriggersMock,
        refreshFKCacheTrigger: refreshFKCacheTriggerMock,
    }));
    vi.doMock('../../reusable_components/notifications/toast_notification_printer.js', () => ({
        showToast: showToastMock,
    }));
    return import('./fk_cache_triggers_view.js');
}

describe('fk_cache_triggers_view', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        fetchFKCacheTriggersMock.mockReset();
        refreshFKCacheTriggerMock.mockReset();
        showToastMock.mockReset();
        vi.restoreAllMocks();
    });

    test('loads trigger data through the stable endpoint router wrapper', async () => {
        fetchFKCacheTriggersMock.mockResolvedValue({
            triggers: [buildTrigger()],
            total: 1,
        });
        const { generate_fk_cache_triggers_view } = await loadModule();
        const container = document.createElement('div');

        await generate_fk_cache_triggers_view(container);

        expect(fetchFKCacheTriggersMock).toHaveBeenCalledWith();
        expect(container.querySelector('.admin-tool-table')).not.toBeNull();
        expect(container.textContent).toContain('FK Cache Triggers');
        expect(container.textContent).toContain('Refresh All');
    });

    test('refreshes one trigger through the stable endpoint router wrapper', async () => {
        fetchFKCacheTriggersMock
            .mockResolvedValueOnce({ triggers: [buildTrigger()], total: 1 })
            .mockResolvedValueOnce({ triggers: [buildTrigger({ cached_count: 9 })], total: 1 });
        refreshFKCacheTriggerMock.mockResolvedValue({ updated: 7, errors: [] });
        const { generate_fk_cache_triggers_view } = await loadModule();
        const container = document.createElement('div');

        await generate_fk_cache_triggers_view(container);

        const refreshButton = /** @type {HTMLButtonElement | null} */ (container.querySelector('button'));
        expect(refreshButton).not.toBeNull();
        refreshButton.click();
        await flushAsyncWork();

        expect(refreshFKCacheTriggerMock).toHaveBeenCalledWith({ trigger_id: 7 });
        expect(showToastMock).toHaveBeenCalledWith({
            message: 'Refreshed 7 row(s)',
            level: 'success',
        });
        expect(fetchFKCacheTriggersMock).toHaveBeenCalledTimes(2);
    });
});
