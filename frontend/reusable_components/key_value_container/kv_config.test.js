// kv_config.test.js
// Verifies the shared key-value container defaults exported by kv_config.js.
// Bridges the static config registry and test expectations for layout behavior.
// Exists to prevent silent drift in widely reused rendering defaults.

import { describe, test, expect } from 'vitest';
import { kvDefaultOptions } from './kv_config.js';

describe('kvDefaultOptions', () => {
  test('exports the expected default layout configuration', () => {
    expect(kvDefaultOptions).toEqual({
      maxColumns: 2,
      minPairWidth: 200,
      layoutMode: 'conditional',
      singleColumnBreakpoint: 650,
    });
  });

  test('uses a supported layout mode', () => {
    expect(['inline', 'stacked', 'conditional']).toContain(kvDefaultOptions.layoutMode);
  });
});
