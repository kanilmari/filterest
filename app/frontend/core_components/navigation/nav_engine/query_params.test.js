// query_params.test.js
// Verifies dataset query-parameter parsing, address writing and the cached parameters' storage.
// Bridges the URLSearchParams helpers, the dataset address writer and localStorage under jsdom.
// Exists to keep the shared search, filter and sort parameters apart from this page's own view.
import { describe, test, expect, vi } from 'vitest';
import { setChosenDatasetView } from '../../state_stores/dataset_view_choice_saver.js';
// query_params.js has import-time side effects (window.location, localStorage, popstate).
// We import the module dynamically after ensuring jsdom globals are ready.

let parseDatasetParamsFromSearch, parseTableQueryString, buildTableQueryString, normalizePath, updateURL;

// Dynamic import to let jsdom setup complete before side effects fire
const mod = await import('./query_params.js');
parseTableQueryString = mod.parseTableQueryString;
parseDatasetParamsFromSearch = mod.parseDatasetParamsFromSearch;
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

  test('keeps auth-shell navigation markers out of dataset filters while preserving explicit search', () => {
    const result = parseTableQueryString(
      '?login-entry=1&register-entry=1&redirect=%2Freports&search=ferry&status=active',
    );

    expect(result.search).toBe('ferry');
    expect(result.filters).toEqual({ status: 'active' });
  });

  test('handles non-numeric offset gracefully', () => {
    const result = parseTableQueryString('?offset=abc');
    expect(result.offset).toBe(0);
  });
});

describe('parseDatasetParamsFromSearch', () => {
  test('does not persist transient auth-shell parameters in dataset URL state', () => {
    expect(parseDatasetParamsFromSearch(
      '?login-entry=1&redirect=%2Ftravel_info&search=harbour&status=active',
    )).toEqual({
      search: 'harbour',
      status: 'active',
    });
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
    expect(window.history.state).toMatchObject(state);
    expect(window.history.state.__filterestEntryId).toEqual(expect.any(String));
  });
});

// Owner decision K143 (3.10.2026): the view in a dataset's cached address
// parameters is this page's own. It never enters the storage every tab shares,
// a view another tab or an earlier version left there is not this page's, and
// the shared search, filter and sort parameters still reach every tab.
describe('the cached view parameter belongs to this page', () => {
  test('keeps the view in this page and shares only the other parameters', () => {
    localStorage.clear();
    mod.setParams('travel_deals', { search: 'ferry', view: 'article_view' });

    expect(mod.getParams('travel_deals')).toEqual({ search: 'ferry', view: 'article_view' });
    expect(JSON.parse(localStorage.getItem('dataset_query_params')).travel_deals).toEqual({ search: 'ferry' });
  });

  test("another tab's search reaches this page, its view does not", () => {
    localStorage.clear();
    mod.setParams('travel_deals', { view: 'card' });
    // Another tab writes its parameters for the same datasets, with a view
    // among them as earlier versions wrote it.
    localStorage.setItem('dataset_query_params', JSON.stringify({
      travel_deals: { search: 'harbour', view: 'article_view' },
      travel_info: { view: 'table', sort_column: 'name' },
    }));

    mod.useStorageParams();

    expect(mod.getParams('travel_deals')).toEqual({ search: 'harbour', view: 'card' });
    expect(mod.getParams('travel_info')).toEqual({ sort_column: 'name' });
  });

  // A navigation reloads the shared parameters and writes the address again
  // (navigation_handler.js, navigation_pipeline.js). The page's own order must
  // survive that reload, or the same address comes back as a different string
  // and Back first returns to the very same page.
  test.each([
    ['the view first', '/demo?view=card&search=ferry'],
    ['the view in the middle', '/demo?search=ferry&view=card&status=open'],
  ])('with %s, a navigation writes the same address and adds no history entry', (_label, address) => {
    localStorage.clear();
    history.replaceState({}, '', address);
    mod.useUrlParams(); // the page reads its own address, as on load
    mod.useStorageParams(); // a navigation reads the shared parameters again
    const historyLength = history.length;
    const push = vi.spyOn(history, 'pushState');
    try {
      mod.updateURL('demo', mod.getParams('demo'));
      expect(push).not.toHaveBeenCalled();
    } finally {
      push.mockRestore();
    }
    expect(history.length).toBe(historyLength);
    expect(window.location.pathname + window.location.search).toBe(address);
  });

  test("keeps the page's order when another tab changes a shared value, and adds new ones after it", () => {
    localStorage.clear();
    history.replaceState({}, '', '/demo?search=ferry&view=card&status=open');
    mod.useUrlParams();
    localStorage.setItem('dataset_query_params', JSON.stringify({
      demo: { status: 'closed', search: 'harbour', sort_column: 'name' },
    }));

    mod.useStorageParams();

    const params = mod.getParams('demo');
    expect(Object.keys(params)).toEqual(['search', 'view', 'status', 'sort_column']);
    expect(params).toEqual({ search: 'harbour', view: 'card', status: 'closed', sort_column: 'name' });
  });

  test('the next write leaves out a view an earlier version shared', () => {
    localStorage.clear();
    localStorage.setItem('dataset_query_params', JSON.stringify({ travel_info: { view: 'table', search: 'harbour' } }));

    mod.setParams('demo', { search: 'x' });

    const stored = JSON.parse(localStorage.getItem('dataset_query_params'));
    expect(stored.travel_info).toEqual({ search: 'harbour' });
    expect(stored.demo).toEqual({ search: 'x' });
    expect(Object.values(stored).some((params) => Object.hasOwn(params, 'view'))).toBe(false);
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


test.each(["card", "table"])("records the actual no-view %s origin before a selector changes URL", view => {
  localStorage.clear();
  sessionStorage.clear();
  history.replaceState({ __filterestEntryId: "origin", otherOwner: 4 }, "", "/service_catalog?sort_column=__newest");
  document.body.innerHTML = `<div id="app_service_catalog_container"><div class="tab_parts_container" data-view="${view}"><div class="scrollable_content" style="display:block"><p>Rows</p></div></div></div>`;
  // The selector already changed the preference; only the rendered origin is reliable.
  setChosenDatasetView("app_service_catalog", "calendar");
  let origin;
  const originalPush = history.pushState.bind(history);
  const push = vi.spyOn(history, "pushState").mockImplementation((...args) => { origin = structuredClone(history.state); originalPush(...args); });
  try {
    updateURL("app_service_catalog", { sort_column: "__newest", view: "calendar" });
    expect(origin).toMatchObject({ __filterestEntryId: "origin", otherOwner: 4, __filterestDatasetView: { dataset: "app_service_catalog", path: "/service_catalog", view } });
    expect(history.state.__filterestDatasetView).toBeUndefined();
  } finally { push.mockRestore(); document.body.innerHTML = ""; }
});
