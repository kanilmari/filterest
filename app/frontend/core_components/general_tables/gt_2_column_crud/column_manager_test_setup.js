// column_manager_test_setup.js
// Shared Vitest/JSDOM setup for the Manage table dialog's test files.
// Keeps the dependency mocks, the per-test reset and the answers every dataset
// setting expects in one place, so each suite stays focused and below the
// project's line limit.
import { vi } from 'vitest';

export const createModalMock = vi.fn(({ contentElements }) => {
    document.body.append(...contentElements);
});
export const showModalMock = vi.fn();
export const hideModalMock = vi.fn();
export const fetchColumnsMock = vi.fn();
export const endpointRouterMock = vi.fn();
export const showSuccessToastMock = vi.fn();
export const showWarningToastMock = vi.fn();
export const refreshTableUnifiedMock = vi.fn();
export const getTranslationForKeyMock = vi.fn(key => key);
export const reloadSpy = vi.fn();

/** Load the dialog afresh, with every dependency it reaches replaced by the mocks above. */
export async function loadModule() {
    vi.resetModules();
    vi.doMock('../../../reusable_components/modal/modal_builder.js', () => ({
        createModal: createModalMock,
        showModal: showModalMock,
        hideModal: hideModalMock,
    }));
    vi.doMock('../../endpoints/endpoint_column_fetcher.js', () => ({
        fetch_columns_for_table: fetchColumnsMock,
    }));
    vi.doMock('../../endpoints/endpoint_router.js', () => ({
        endpoint_router: endpointRouterMock,
    }));
    vi.doMock('../../../reusable_components/dom_container_builder.js', () => ({
        isValidIdentifier: () => true,
    }));
    vi.doMock('../../../reusable_components/notifications/toast_notification_printer.js', () => ({
        showSuccessToast: showSuccessToastMock,
        showWarningToast: showWarningToastMock,
    }));
    vi.doMock('../gt_3_table_crud/gt_3_2_table_delete/table_remover.js', () => ({
        drop_table: vi.fn(),
    }));
    vi.doMock('../../lang/translation_handler.js', () => ({
        getTranslationForKey: getTranslationForKeyMock,
    }));
    vi.doMock('../gt_1_row_crud/gt_1_2_row_read/table_refresh_unified.js', () => ({
        refreshTableUnified: refreshTableUnifiedMock,
    }));

    return import('./column_manager.js');
}

/** Reset the mocks, the page and the stored dataset state before each test. */
export function resetColumnManagerTest() {
    for (const [options] of createModalMock.mock.calls) options.cleanupCallback?.();
    vi.clearAllMocks();
    document.documentElement.lang = 'en';
    localStorage.clear();
    sessionStorage.clear();
    document.body.innerHTML = '';

    fetchColumnsMock.mockResolvedValue([
        { column_name: 'legacy_col', data_type: 'TEXT', character_maximum_length: null },
        { column_name: 'gone_col', data_type: 'TEXT', character_maximum_length: null },
    ]);
    endpointRouterMock.mockImplementation(async (route) => route === 'adminDatasetUiVisibility'
        ? { dataset_name: 'demo_table', ui_hidden: false } : { message: 'ok' });
    refreshTableUnifiedMock.mockResolvedValue(undefined);

    localStorage.setItem('demo_table_sorting_and_filtering_specs', JSON.stringify({
        sort: { column: 'legacy_col', direction: 'ASC' },
        filters: {
            legacy_col: 'abc',
            legacy_col_from: '2026-01-01',
            legacy_col_to: '2026-12-31',
            gone_col: 'remove-me',
            untouched: 'keep-me',
        },
        offset: 12,
        cardView: { collapsed: false, expandedId: null },
    }));
    localStorage.setItem('demo_table_hide_columns', JSON.stringify({
        legacy_col: true,
        gone_col: true,
        untouched: true,
    }));
    localStorage.setItem('demo_table_open_filters', JSON.stringify([
        'legacy_col',
        'gone_col',
        'modern_col',
    ]));

    Object.defineProperty(window, 'location', {
        value: {
            ...window.location,
            reload: reloadSpy,
        },
        writable: true,
        configurable: true,
    });
}

// The dimensions below used to exist only while a dataset was being created.
export const datasetNodes = [
    { id: 'f_4', name: 'database', parent_id: 'null', db_id: 4 },
    { id: 'f_7', name: 'other_tables', parent_id: 'f_4', db_id: 7 },
    { id: 't_demo_table', name: 'demo_table', parent_id: 'f_7', db_id: 91, table_uid: '3470' },
];

export function answerEveryDatasetDimension(overrides = {}) {
    endpointRouterMock.mockImplementation(async (route, options) => {
        if (overrides[route]) return overrides[route](options);
        if (route === 'adminDatasetUiVisibility') return { dataset_name: 'demo_table', ui_hidden: false };
        if (route === 'adminSymbols') {
            return { symbols: [], datasets: [{ dataset_name: 'demo_table', table_uid: 3470 }], fields: [] };
        }
        if (route === 'modifyColumns' && options?.method !== 'POST') {
            return { dataset_name: 'demo_table', prevent_deletion: false };
        }
        if (route === 'fetchTreeData') return { nodes: datasetNodes };
        if (route === 'imageAssetLinkingStatus') {
            return { asset_linkings: [{ parent_table: 'demo_table', enabled: false }] };
        }
        if (route === 'fetchForeignKeys') return { data: [] };
        if (route === 'datasetNames') return ['users'];
        return { message: 'ok' };
    });
}
