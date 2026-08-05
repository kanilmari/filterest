// function_counter.test.js
// Verifies localStorage-backed frontend execution counters and sorted reads.
// Bridges the lightweight profiling helpers and deterministic storage fixtures.
// Exists to prevent regressions in count persistence, ordering, and parse fallback behavior.

import { describe, test, expect, beforeEach, vi } from 'vitest';
import { count_this_function, get_sorted_function_counts } from './function_counter.js';

describe('function_counter', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  test('increments counters and persists them sorted by count descending', () => {
    count_this_function('renderTable');
    count_this_function('renderTable');
    count_this_function('showToast');

    expect(JSON.parse(localStorage.getItem('function_counts'))).toEqual({
      renderTable: 2,
      showToast: 1,
    });
  });

  test('returns sorted function counts from storage', () => {
    localStorage.setItem(
      'function_counts',
      JSON.stringify({ renderTable: 3, showToast: 1, loadView: 2 })
    );

    expect(get_sorted_function_counts()).toEqual([
      { functionName: 'renderTable', count: 3 },
      { functionName: 'showToast', count: 1 },
      { functionName: 'loadView', count: 2 },
    ]);
  });

  test('returns an empty array when storage is missing or invalid', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(get_sorted_function_counts()).toEqual([]);

    localStorage.setItem('function_counts', '{broken');
    expect(get_sorted_function_counts()).toEqual([]);
    expect(warnSpy).toHaveBeenCalled();
  });
});
