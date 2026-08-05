import { describe, test, expect } from 'vitest';
// query_params.js has import-time side effects (window.location, localStorage, popstate).
// Only the pure parse/build helpers are safe to unit test.
// We import the module dynamically after ensuring jsdom globals are ready.

let parseTableQueryString, buildTableQueryString, normalizePath, updateURL;

// Dynamic import to let jsdom setup complete before side effects fire
const mod = await import('./query_params.js');
parseTableQueryString = mod.parseTableQueryString;
buildTableQueryString = mod.buildTableQueryString;
normalizePath = mod.normalizePath;
updateURL = mod.updateURL;

describe('parseTableQueryString', () => {
  test('parses sort, offset, and filters', () => {
    const result = parseTableQueryString('?sort_column=name&sort_order=asc&offset=20&status=active');
    expect(result.sort.column).toBe('name');
    expect(result.sort.direction).toBe('ASC');
    expect(result.offset).toBe(20);
    expect(result.filters).toEqual({ status: 'active' });
  });

  test('returns defaults for empty string', () => {
    const result = parseTableQueryString('');
    expect(result.sort).toEqual({ column: null, direction: null });
    expect(result.offset).toBe(0);
    expect(result.filters).toEqual({});
  });

  test('ignores reserved keys in filters while preserving search and view metadata', () => {
    const result = parseTableQueryString('?table=users&search=hello&view=card&name=test');
    expect(result.filters).toEqual({ name: 'test' });
    expect(result.filters.table).toBeUndefined();
    expect(result.filters.search).toBeUndefined();
    expect(result.filters.view).toBeUndefined();
    expect(result.search).toBe('hello');
    expect(result.view).toBe('card');
  });

  test('handles non-numeric offset gracefully', () => {
    const result = parseTableQueryString('?offset=abc');
    expect(result.offset).toBe(0);
  });
});

describe('buildTableQueryString', () => {
  test('builds query string from structured params', () => {
    const qs = buildTableQueryString({
      sort: { column: 'name', direction: 'ASC' },
      offset: 20,
      filters: { status: 'active' },
    });
    expect(qs).toContain('sort_column=name');
    expect(qs).toContain('sort_order=ASC');
    expect(qs).toContain('offset=20');
    expect(qs).toContain('status=active');
    expect(qs.startsWith('?')).toBe(true);
  });

  test('returns empty string for empty/default params', () => {
    expect(buildTableQueryString({})).toBe('');
    expect(buildTableQueryString()).toBe('');
  });

  test('omits null/empty filter values', () => {
    const qs = buildTableQueryString({ filters: { a: 'x', b: null, c: '' } });
    expect(qs).toContain('a=x');
    expect(qs).not.toContain('b=');
    expect(qs).not.toContain('c=');
  });

  test('only allows ASC/DESC for sort direction', () => {
    const qs = buildTableQueryString({ sort: { column: 'name', direction: 'INVALID' } });
    expect(qs).not.toContain('sort_order');
    expect(qs).toContain('sort_column=name');
  });

  test('omits offset when 0', () => {
    const qs = buildTableQueryString({ offset: 0, filters: { a: '1' } });
    expect(qs).not.toContain('offset');
  });
});

describe('normalizePath', () => {
  test('strips trailing slash', () => {
    expect(normalizePath('/users/')).toBe('/users');
  });

  test('preserves root slash', () => {
    expect(normalizePath('/')).toBe('/');
  });

  test('returns falsy values as-is', () => {
    expect(normalizePath('')).toBe('');
    expect(normalizePath(null)).toBe(null);
  });
});

describe('updateURL', () => {
  test('writes alias URLs while keeping stored state keyed by the raw dataset name', () => {
    localStorage.clear();
    window.history.replaceState({}, '', '/');

    updateURL('app_service_catalog', { status: 'active' });

    expect(window.location.pathname).toBe('/service_catalog');
    expect(window.location.search).toBe('?status=active');

    const stored = JSON.parse(localStorage.getItem('dataset_query_params'));
    expect(stored).toMatchObject({
      app_service_catalog: { status: 'active' },
    });
  });

  test('can preserve a row path while updating query params and history state', () => {
    localStorage.clear();
    const state = { bigCard: true, dataset: 'dev_agent_tasks', rowId: '853' };
    window.history.replaceState(state, '', '/dev_agent_tasks/853-existing-title?view=article');

    updateURL(
      'dev_agent_tasks',
      { search: '853', view: 'article' },
      undefined,
      {
        pathOverride: window.location.pathname,
        state,
        replace: true,
      },
    );

    expect(window.location.pathname).toBe('/dev_agent_tasks/853-existing-title');
    expect(window.location.search).toBe('?search=853&view=article');
    expect(window.history.state).toEqual(state);
  });
});

describe('parseTableQueryString ↔ buildTableQueryString roundtrip', () => {
  test('parse then build reproduces equivalent query', () => {
    const original = '?sort_column=age&sort_order=DESC&offset=50&city=Helsinki';
    const parsed = parseTableQueryString(original);
    const rebuilt = buildTableQueryString(parsed);
    const reparsed = parseTableQueryString(rebuilt);
    expect(reparsed).toEqual(parsed);
  });
});
