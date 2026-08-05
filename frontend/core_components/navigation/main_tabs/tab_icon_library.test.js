// tab_icon_library.test.js
// Verifies the curated tab icon registry and its public lookup helpers.
// Bridges icon-key callers and SVG path consumers with regression-safe expectations.
// Exists to lock down fallback and discovery behavior for tab icons.

import { describe, test, expect } from 'vitest';
import ICON_PATHS, { getTabIconPath, getAvailableIconKeys } from './tab_icon_library.js';

describe('tab_icon_library', () => {
  test('returns the icon path for a known key', () => {
    expect(getTabIconPath('building')).toBe(ICON_PATHS.building);
    expect(getTabIconPath('group_filled')).toBe(ICON_PATHS.group_filled);
  });

  test('falls back to the table icon for missing keys', () => {
    expect(getTabIconPath()).toBe(ICON_PATHS.table);
    expect(getTabIconPath(null)).toBe(ICON_PATHS.table);
    expect(getTabIconPath('missing-key')).toBe(ICON_PATHS.table);
  });

  test('returns all available icon keys in sorted order', () => {
    const keys = getAvailableIconKeys();
    expect(keys).toEqual([...keys].sort());
    expect(keys).toContain('building');
    expect(keys).toContain('table');
    expect(keys).toContain('warning');
    expect(keys).toContain('group_filled');
  });
});
