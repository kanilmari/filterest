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
