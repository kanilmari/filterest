// table_state_store.test.js
// Verifies independent persisted presentation state and legacy article aliases.
// Bridges localStorage state reads and partial updates for card and article views.
// Prevents one presentation from overwriting the preferences of another.
import { describe, test, expect, beforeEach, vi } from 'vitest';
import { forgetOpenRow, getUnifiedTableState, setUnifiedTableState } from './table_state_store.js';

describe('table_state_store', () => {
  beforeEach(() => {
    localStorage.clear();
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
        'users_sorting_and_filtering_specs',
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
      localStorage.setItem('users_sorting_and_filtering_specs', '{broken');
      expect(getUnifiedTableState('users')).toEqual(DEFAULT_STATE);
    });
  });

  describe('setUnifiedTableState', () => {
    test('stores partial state merged with defaults', () => {
      const result = setUnifiedTableState('users', { offset: 20 });
      expect(result.offset).toBe(20);
      expect(result.sort).toEqual({ column: null, direction: null });

      // Verify persisted
      const stored = JSON.parse(localStorage.getItem('users_sorting_and_filtering_specs'));
      expect(stored.offset).toBe(20);
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
  });
});


test("article settings never modify the card state", () => {
    localStorage.clear();
    setUnifiedTableState("demo", { cardView: { expandedId: 1, returnView: "table" } });
    setUnifiedTableState("demo", { articleView: { expandedId: 2, returnView: "calendar" } });
    setUnifiedTableState("demo", { articleView: { collapsed: true } });
    expect(getUnifiedTableState("demo").cardView).toEqual({ collapsed: false, expandedId: 1, returnView: "table" });
    expect(getUnifiedTableState("demo").articleView).toEqual({ collapsed: true, expandedId: 2, returnView: "calendar" });
});

// A row left open on an earlier visit must not reopen its article on the next
// one; the person's sorting, filters and paging are theirs and stay.
describe('forgetOpenRow', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test('forgets the open article and card row and keeps sorting, filters and paging', () => {
    localStorage.setItem('travel_deals_sorting_and_filtering_specs', JSON.stringify({
      sort: { column: 'name', direction: 'ASC' },
      filters: { country: 'FI' },
      offset: 40,
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

  test('writes nothing for a dataset with no stored state', () => {
    forgetOpenRow('travel_deals');
    expect(localStorage.getItem('travel_deals_sorting_and_filtering_specs')).toBeNull();
  });

  test('keeps the stored preferences when the storage refuses the write', () => {
    const stored = JSON.stringify({
      sort: { column: 'name', direction: 'ASC' },
      articleView: { collapsed: true, expandedId: '5' },
    });
    localStorage.setItem('travel_deals_sorting_and_filtering_specs', stored);
    const refuse = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    try {
      forgetOpenRow('travel_deals');
    } finally {
      refuse.mockRestore();
    }
    expect(localStorage.getItem('travel_deals_sorting_and_filtering_specs')).toBe(stored);
  });

  test('drops an unreadable state, which already reads as the defaults', () => {
    localStorage.setItem('travel_deals_sorting_and_filtering_specs', '{broken');
    forgetOpenRow('travel_deals');
    expect(localStorage.getItem('travel_deals_sorting_and_filtering_specs')).toBeNull();
  });
});

test.each(["article", "big_card", "row_article"])("preserves old %s bookmarks and their detail selection", (view) => {
    localStorage.clear();
    localStorage.setItem("demo_view", view);
    localStorage.setItem("demo_sorting_and_filtering_specs", JSON.stringify({ cardView: { expandedId: 42, collapsed: true } }));
    expect(getUnifiedTableState("demo").articleView).toEqual({ expandedId: 42, collapsed: true });
});
