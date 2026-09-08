// table_state_store.test.js
// Verifies independent persisted presentation state and legacy article aliases.
// Bridges localStorage state reads and partial updates for card and article views.
// Prevents one presentation from overwriting the preferences of another.
import { describe, test, expect, beforeEach } from 'vitest';
import { getUnifiedTableState, setUnifiedTableState } from './table_state_store.js';

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

test.each(["article", "big_card", "row_article"])("preserves old %s bookmarks and their detail selection", (view) => {
    localStorage.clear();
    localStorage.setItem("demo_view", view);
    localStorage.setItem("demo_sorting_and_filtering_specs", JSON.stringify({ cardView: { expandedId: 42, collapsed: true } }));
    expect(getUnifiedTableState("demo").articleView).toEqual({ expandedId: 42, collapsed: true });
});
