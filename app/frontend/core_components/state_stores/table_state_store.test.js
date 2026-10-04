// table_state_store.test.js
// Verifies the unified table state: shared sorting, filters and paging, and the per-tab open row.
// Bridges localStorage (every tab) and sessionStorage (one tab) through partial state updates.
// Prevents one presentation, or one browser tab, from overwriting the state of another.
import { describe, test, expect, beforeEach, vi } from 'vitest';
import { forgetOpenRow, getUnifiedTableState, isSameOpenRow, setUnifiedTableState } from './table_state_store.js';
import { forgetTabSessionFallback } from './tab_session_storage.js';
import { setChosenDatasetView } from './dataset_view_choice_saver.js';

const SHARED_KEY = 'users_sorting_and_filtering_specs';
const OPEN_ROW_KEY = 'users_open_row';

function readStored(storage, key) {
  const raw = storage.getItem(key);
  return raw === null ? null : JSON.parse(raw);
}

/** A second tab of the same site: its own empty sessionStorage, the same localStorage. */
function openSecondTab() {
  sessionStorage.clear();
}

describe('table_state_store', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    forgetTabSessionFallback();
  });

  const DEFAULT_STATE = {
    sort: { column: null, direction: null },
    filters: {},
    offset: 0,
    cardView: { collapsed: false, expandedId: null },
    articleView: { collapsed: false, expandedId: null },
  };

  describe('getUnifiedTableState', () => {
    test('returns defaults when no stored state', () => {
      expect(getUnifiedTableState('users')).toEqual(DEFAULT_STATE);
    });

    test('returns stored state merged with defaults', () => {
      localStorage.setItem(
        SHARED_KEY,
        JSON.stringify({ sort: { column: 'name', direction: 'ASC' }, offset: 10 })
      );
      const state = getUnifiedTableState('users');
      expect(state.sort.column).toBe('name');
      expect(state.sort.direction).toBe('ASC');
      expect(state.offset).toBe(10);
      expect(state.filters).toEqual({});
      expect(state.cardView).toEqual({ collapsed: false, expandedId: null });
    });

    test('returns defaults on corrupted JSON', () => {
      localStorage.setItem(SHARED_KEY, '{broken');
      sessionStorage.setItem(OPEN_ROW_KEY, '{broken');
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        expect(getUnifiedTableState('users')).toEqual(DEFAULT_STATE);
      } finally {
        warn.mockRestore();
      }
    });

    test("lays this tab's open row over the shared sorting", () => {
      localStorage.setItem(SHARED_KEY, JSON.stringify({ sort: { column: 'name', direction: 'ASC' } }));
      sessionStorage.setItem(OPEN_ROW_KEY, JSON.stringify({
        articleView: { collapsed: true, expandedId: 7, returnView: 'card' },
      }));
      const state = getUnifiedTableState('users');
      expect(state.sort).toEqual({ column: 'name', direction: 'ASC' });
      expect(state.articleView).toEqual({ collapsed: true, expandedId: 7, returnView: 'card' });
      expect(state.cardView).toEqual({ collapsed: false, expandedId: null });
    });

    // (e) An object written by an earlier version, when every tab shared the
    // open row, must not reopen that article in any tab -- not even under an
    // old article alias, which once migrated the card's open row.
    test.each(['article_view', 'article', 'big_card', 'row_article'])(
      'ignores an open row an earlier version shared, also under the old %s view',
      (view) => {
        setChosenDatasetView('users', view);
        localStorage.setItem(SHARED_KEY, JSON.stringify({
          sort: { column: 'name', direction: 'DESC' },
          articleView: { collapsed: true, expandedId: 42, returnView: 'card' },
          cardView: { collapsed: true, expandedId: 42 },
        }));
        const state = getUnifiedTableState('users');
        expect(state.sort).toEqual({ column: 'name', direction: 'DESC' });
        expect(state.articleView).toEqual({ collapsed: false, expandedId: null });
        expect(state.cardView).toEqual({ collapsed: false, expandedId: null });
      },
    );
  });

  describe('setUnifiedTableState', () => {
    test('stores partial state merged with defaults', () => {
      const result = setUnifiedTableState('users', { offset: 20 });
      expect(result.offset).toBe(20);
      expect(result.sort).toEqual({ column: null, direction: null });

      // Verify persisted
      expect(readStored(localStorage, SHARED_KEY).offset).toBe(20);
    });

    test('deep-merges cardView', () => {
      setUnifiedTableState('users', { cardView: { collapsed: true } });
      const state = getUnifiedTableState('users');
      expect(state.cardView.collapsed).toBe(true);
      expect(state.cardView.expandedId).toBe(null);
    });

    test('updates existing state', () => {
      setUnifiedTableState('users', { offset: 10 });
      setUnifiedTableState('users', { offset: 20, filters: { name: 'test' } });
      const state = getUnifiedTableState('users');
      expect(state.offset).toBe(20);
      expect(state.filters).toEqual({ name: 'test' });
    });

    // (c) Each part goes to its own store.
    test('writes the open row only to this tab and the sorting only to the shared store', () => {
      setUnifiedTableState('users', {
        sort: { column: 'name', direction: 'ASC' },
        offset: 40,
        articleView: { collapsed: true, expandedId: 5, returnView: 'card' },
      });

      const shared = readStored(localStorage, SHARED_KEY);
      expect(shared.sort).toEqual({ column: 'name', direction: 'ASC' });
      expect(shared.offset).toBe(40);
      expect(shared).not.toHaveProperty('articleView');
      expect(shared).not.toHaveProperty('cardView');

      const openRow = readStored(sessionStorage, OPEN_ROW_KEY);
      expect(openRow.articleView).toEqual({ collapsed: true, expandedId: 5, returnView: 'card' });
      expect(openRow).not.toHaveProperty('sort');
      expect(openRow).not.toHaveProperty('offset');
    });

    test('an empty change writes nothing to either store and returns the current state', () => {
      setUnifiedTableState('users', { sort: { column: 'name', direction: 'ASC' }, articleView: { collapsed: true, expandedId: 5 } });
      const writes = vi.spyOn(Storage.prototype, 'setItem');
      const removals = vi.spyOn(Storage.prototype, 'removeItem');
      let result;
      try {
        result = setUnifiedTableState('users', {});
        expect(writes).not.toHaveBeenCalled();
        expect(removals).not.toHaveBeenCalled();
      } finally {
        writes.mockRestore();
        removals.mockRestore();
      }
      expect(result).toEqual(getUnifiedTableState('users'));
    });

    test('a change to the open row alone leaves the shared store untouched, and the other way round', () => {
      setUnifiedTableState('users', { articleView: { collapsed: true, expandedId: 5 } });
      expect(localStorage.getItem(SHARED_KEY)).toBeNull();

      setUnifiedTableState('users', { offset: 20 });
      expect(readStored(sessionStorage, OPEN_ROW_KEY).articleView).toEqual({ collapsed: true, expandedId: 5 });
      expect(readStored(localStorage, SHARED_KEY).offset).toBe(20);
    });

    test('the next shared write leaves out an open row an earlier version shared', () => {
      localStorage.setItem(SHARED_KEY, JSON.stringify({
        sort: { column: 'name', direction: 'ASC' },
        articleView: { collapsed: true, expandedId: 42 },
        cardView: { collapsed: true, expandedId: 42 },
      }));

      setUnifiedTableState('users', { offset: 20 });

      expect(readStored(localStorage, SHARED_KEY)).toEqual({
        sort: { column: 'name', direction: 'ASC' },
        filters: {},
        offset: 20,
      });
      expect(sessionStorage.getItem(OPEN_ROW_KEY)).toBeNull();
    });

    // A full storage still reads, so the older stored row must not win over
    // the row this page just opened.
    test("a refused per-tab write is kept in this page's memory and read back", () => {
      setUnifiedTableState('users', { articleView: { collapsed: true, expandedId: 5 } });
      const stored = sessionStorage.getItem(OPEN_ROW_KEY);
      const refuse = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('QuotaExceededError');
      });
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        setUnifiedTableState('users', { articleView: { expandedId: 6 } });
      } finally {
        refuse.mockRestore();
        warn.mockRestore();
      }
      expect(getUnifiedTableState('users').articleView).toEqual({ collapsed: true, expandedId: 6 });
      expect(sessionStorage.getItem(OPEN_ROW_KEY)).toBe(stored);
    });

    test('a browser that refuses session storage keeps the open row in page memory', () => {
      const refuse = () => { throw new DOMException('The operation is insecure.', 'SecurityError'); };
      vi.stubGlobal('sessionStorage', { getItem: refuse, setItem: refuse, removeItem: refuse, clear: refuse, key: refuse, length: 0 });
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        setUnifiedTableState('users', { articleView: { collapsed: true, expandedId: 5, scrollTop: 120 } });
        expect(getUnifiedTableState('users').articleView).toEqual({ collapsed: true, expandedId: 5, scrollTop: 120 });
        forgetOpenRow('users', 5);
        expect(getUnifiedTableState('users').articleView).toEqual({ collapsed: false, expandedId: null, scrollTop: 120 });
        forgetOpenRow('users');
        expect(getUnifiedTableState('users').articleView).toEqual({ collapsed: false, expandedId: null });
      } finally {
        warn.mockRestore();
        vi.unstubAllGlobals();
      }
    });
  });

  // (d) A second tab shares the sorting but not the first tab's open row.
  test("a second tab sees the shared sorting but not the first tab's open row", () => {
    setUnifiedTableState('users', {
      sort: { column: 'name', direction: 'DESC' },
      articleView: { collapsed: true, expandedId: 5, returnView: 'card' },
      cardView: { collapsed: true, expandedId: 5 },
    });

    openSecondTab();

    const secondTab = getUnifiedTableState('users');
    expect(secondTab.sort).toEqual({ column: 'name', direction: 'DESC' });
    expect(secondTab.articleView).toEqual({ collapsed: false, expandedId: null });
    expect(secondTab.cardView).toEqual({ collapsed: false, expandedId: null });
  });
});


test.each([
  [5, '5', true],
  ['5', '5', true],
  ['5', '6', false],
  [null, null, false],
  [undefined, '5', false],
  [0, '0', true],
])('isSameOpenRow(%j, %j) is %s', (left, right, expected) => {
  expect(isSameOpenRow(left, right)).toBe(expected);
});

test("article settings never modify the card state", () => {
    localStorage.clear();
    sessionStorage.clear();
    forgetTabSessionFallback();
    setUnifiedTableState("demo", { cardView: { expandedId: 1, returnView: "table" } });
    setUnifiedTableState("demo", { articleView: { expandedId: 2, returnView: "calendar" } });
    setUnifiedTableState("demo", { articleView: { collapsed: true } });
    expect(getUnifiedTableState("demo").cardView).toEqual({ collapsed: false, expandedId: 1, returnView: "table" });
    expect(getUnifiedTableState("demo").articleView).toEqual({ collapsed: true, expandedId: 2, returnView: "calendar" });
});

// A row left open on an earlier visit must not reopen its article on the next
// one; the person's sorting, filters and paging are theirs and stay. Only this
// tab's open row is forgotten: another tab keeps the article it has open.
describe('forgetOpenRow', () => {
  const SHARED = 'travel_deals_sorting_and_filtering_specs';
  const OPEN_ROW = 'travel_deals_open_row';

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    forgetTabSessionFallback();
  });

  test('forgets the open article and card row and keeps sorting, filters and paging', () => {
    localStorage.setItem(SHARED, JSON.stringify({
      sort: { column: 'name', direction: 'ASC' },
      filters: { country: 'FI' },
      offset: 40,
    }));
    sessionStorage.setItem(OPEN_ROW, JSON.stringify({
      articleView: { collapsed: true, expandedId: '5', returnView: 'card' },
      cardView: { collapsed: true, expandedId: '5', returnView: 'table' },
    }));

    forgetOpenRow('travel_deals');

    const state = getUnifiedTableState('travel_deals');
    expect(state.sort).toEqual({ column: 'name', direction: 'ASC' });
    expect(state.filters).toEqual({ country: 'FI' });
    expect(state.offset).toBe(40);
    expect(state.articleView).toEqual({ collapsed: false, expandedId: null });
    expect(state.cardView).toEqual({ collapsed: false, expandedId: null, returnView: 'table' });
  });

  test('never touches the shared sorting, filters and paging', () => {
    const shared = JSON.stringify({ sort: { column: 'name', direction: 'ASC' }, offset: 40 });
    localStorage.setItem(SHARED, shared);
    sessionStorage.setItem(OPEN_ROW, JSON.stringify({ articleView: { collapsed: true, expandedId: '5' } }));
    const writes = vi.spyOn(Storage.prototype, 'setItem');
    const removals = vi.spyOn(Storage.prototype, 'removeItem');
    try {
      forgetOpenRow('travel_deals');
      expect(writes.mock.contexts).toContain(sessionStorage);
      expect(writes.mock.contexts).not.toContain(localStorage);
      expect(removals.mock.contexts).not.toContain(localStorage);
    } finally {
      writes.mockRestore();
      removals.mockRestore();
    }
    expect(localStorage.getItem(SHARED)).toBe(shared);
  });

  test('writes nothing for a dataset with no stored open row', () => {
    forgetOpenRow('travel_deals');
    expect(sessionStorage.getItem(OPEN_ROW)).toBeNull();
    expect(localStorage.getItem(SHARED)).toBeNull();
  });

  test('forgets the open row in page memory when the storage refuses the write', () => {
    const stored = JSON.stringify({ articleView: { collapsed: true, expandedId: '5' } });
    sessionStorage.setItem(OPEN_ROW, stored);
    const refuse = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      forgetOpenRow('travel_deals');
    } finally {
      refuse.mockRestore();
      warn.mockRestore();
    }
    expect(getUnifiedTableState('travel_deals').articleView).toEqual({ collapsed: false, expandedId: null });
    expect(sessionStorage.getItem(OPEN_ROW)).toBe(stored);
  });

  test('drops an unreadable open row, which already reads as none', () => {
    sessionStorage.setItem(OPEN_ROW, '{broken');
    forgetOpenRow('travel_deals');
    expect(sessionStorage.getItem(OPEN_ROW)).toBeNull();
  });

  // A reload of the open article's own address keeps its reading position --
  // related tab, related rows, scroll -- and forgets everything else about it.
  describe('when the loaded address names a row', () => {
    const OPEN_ARTICLE = {
      collapsed: true,
      expandedId: '5',
      returnView: 'card',
      relatedTabKey: 'travel_deal_notes__deal_id__',
      relatedRowsOpen: true,
      scrollTop: 360,
      pendingAutoOpenFirstRenderedResult: true,
    };

    beforeEach(() => {
      sessionStorage.setItem(OPEN_ROW, JSON.stringify({ articleView: OPEN_ARTICLE }));
    });

    test.each([['the same row id', '5'], ['the same row as a number', 5]])(
      'keeps only the reading position for %s',
      (_label, addressRowId) => {
        forgetOpenRow('travel_deals', addressRowId);
        expect(getUnifiedTableState('travel_deals').articleView).toEqual({
          collapsed: false,
          expandedId: null,
          relatedTabKey: 'travel_deal_notes__deal_id__',
          relatedRowsOpen: true,
          scrollTop: 360,
        });
      },
    );

    test.each([['another row', '6'], ['no row', null]])('forgets the reading position for %s', (_label, addressRowId) => {
      forgetOpenRow('travel_deals', addressRowId);
      expect(getUnifiedTableState('travel_deals').articleView).toEqual({ collapsed: false, expandedId: null });
    });
  });
});
