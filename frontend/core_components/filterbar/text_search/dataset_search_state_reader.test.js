// dataset_search_state_reader.test.js
// Tests pure dataset-search state helpers with mocked URL and table-state readers.
// Operates between Vitest's jsdom environment and dataset_search_state_reader.js imports.
// Exists to lock down helper behavior without running real import-time window side effects.
import { beforeEach, describe, expect, test, vi } from 'vitest';

const { mockGetParams, mockGetUnifiedTableState } = vi.hoisted(() => ({
  mockGetParams: vi.fn(),
  mockGetUnifiedTableState: vi.fn(),
}));

vi.mock('../../navigation/nav_engine/query_params.js', () => ({
  getParams: mockGetParams,
}));

vi.mock('../../general_tables/gt_1_row_crud/gt_1_2_row_read/table_refresh_unified.js', () => ({
  getUnifiedTableState: mockGetUnifiedTableState,
}));

const {
  DatasetSearchStateManager,
  RESERVED_PARAM_KEYS,
  datasetSearchIdCounters,
  generateDatasetSearchIdPrefix,
  getActiveFiltersSnapshot,
  normalizeVariantName,
} = await import('./dataset_search_state_reader.js');

beforeEach(() => {
  mockGetParams.mockReset();
  mockGetUnifiedTableState.mockReset();
  datasetSearchIdCounters.clear();
});

describe('normalizeVariantName', () => {
  test('lowercases text and replaces non-alphanumeric separators with hyphens', () => {
    expect(normalizeVariantName('Quick Search / Mobile')).toBe('quick-search-mobile');
  });

  test('returns default when normalization strips everything away', () => {
    expect(normalizeVariantName('!!!')).toBe('default');
  });
});

describe('generateDatasetSearchIdPrefix', () => {
  test('returns a caller-provided prefix without touching counters', () => {
    expect(generateDatasetSearchIdPrefix('users', 'Quick Search', 'custom_prefix')).toBe('custom_prefix');
    expect(datasetSearchIdCounters.size).toBe(0);
  });

  test('increments counters per table and normalized variant', () => {
    expect(generateDatasetSearchIdPrefix('users', 'Quick Search')).toBe('users_quick-search_dataset_search_1');
    expect(generateDatasetSearchIdPrefix('users', 'Quick Search')).toBe('users_quick-search_dataset_search_2');
  });

  test('keeps separate counters for different table and variant combinations', () => {
    expect(generateDatasetSearchIdPrefix('users', 'Quick Search')).toBe('users_quick-search_dataset_search_1');
    expect(generateDatasetSearchIdPrefix('users', 'Advanced Search')).toBe('users_advanced-search_dataset_search_1');
    expect(generateDatasetSearchIdPrefix('orders', 'Quick Search')).toBe('orders_quick-search_dataset_search_1');
  });
});

describe('RESERVED_PARAM_KEYS', () => {
  test('contains the expected reserved query parameter keys', () => {
    expect(RESERVED_PARAM_KEYS).toEqual(new Set([
      'sort_column',
      'sort_order',
      'offset',
      'search',
      'table',
      'lang',
      'view',
    ]));
  });
});

describe('DatasetSearchStateManager', () => {
  test('ensureEntry creates the default entry shape on first access', () => {
    const manager = new DatasetSearchStateManager();

    const entry = manager.ensureEntry('users');

    expect(entry).toEqual({
      value: '',
      initialized: false,
      subscribers: expect.any(Set),
    });
    expect(manager.entries.size).toBe(1);
    expect(manager.entries.get('users')).toBe(entry);
  });

  test('ensureEntry reuses the same entry for the same table and adds new tables separately', () => {
    const manager = new DatasetSearchStateManager();

    const usersEntry = manager.ensureEntry('users');
    const sameUsersEntry = manager.ensureEntry('users');
    const ordersEntry = manager.ensureEntry('orders');

    expect(sameUsersEntry).toBe(usersEntry);
    expect(ordersEntry).not.toBe(usersEntry);
    expect(manager.entries.size).toBe(2);
    expect(Array.from(manager.entries.keys())).toEqual(['users', 'orders']);
  });
});

describe('getActiveFiltersSnapshot', () => {
  test('merges unified state filters with URL params while excluding reserved and empty params', () => {
    mockGetUnifiedTableState.mockReturnValue({
      filters: {
        status: 'draft',
        owner: 'alice',
        shared: 'state',
      },
    });
    mockGetParams.mockReturnValue({
      sort_column: 'name',
      search: 'term',
      view: 'table',
      LANG: 'fi',
      empty: '',
      missing: null,
      shared: 'param',
      city: 'Helsinki',
    });

    const snapshot = getActiveFiltersSnapshot('users');

    expect(snapshot).toEqual({
      status: 'draft',
      owner: 'alice',
      shared: 'param',
      city: 'Helsinki',
    });
    expect(mockGetUnifiedTableState).toHaveBeenCalledWith('users');
    expect(mockGetParams).toHaveBeenCalledWith('users');
  });

  test('returns an empty object when neither source provides filters', () => {
    mockGetUnifiedTableState.mockReturnValue(undefined);
    mockGetParams.mockReturnValue(undefined);

    expect(getActiveFiltersSnapshot('users')).toEqual({});
  });
});
