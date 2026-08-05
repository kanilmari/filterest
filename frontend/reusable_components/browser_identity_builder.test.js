// browser_identity_builder.test.js
// Verifies browser fingerprint collection and hashing for auth/session binding.
// Bridges navigator-derived identity data and SHA-256 hashing in a jsdom-safe way.
// Exists to keep the client-side fingerprint input and digest format stable.

import { describe, test, expect, beforeEach } from 'vitest';
import {
  gather_browser_fingerprint_data,
  gather_browser_fingerprint_hash,
} from './browser_identity_builder.js';

describe('browser_identity_builder', () => {
  beforeEach(() => {
    Object.defineProperty(window.navigator, 'userAgent', {
      value: 'VitestAgent/1.0',
      configurable: true,
    });
    Object.defineProperty(window.navigator, 'platform', {
      value: 'TestOS',
      configurable: true,
    });
    Object.defineProperty(window.navigator, 'cookieEnabled', {
      value: true,
      configurable: true,
    });
  });

  test('collects the expected browser fingerprint fields', () => {
    expect(gather_browser_fingerprint_data()).toEqual({
      user_agent: 'VitestAgent/1.0',
      platform: 'TestOS',
      cookie_enabled: true,
    });
  });

  test('returns a stable SHA-256 hex digest for the gathered data', async () => {
    const first = await gather_browser_fingerprint_hash();
    const second = await gather_browser_fingerprint_hash();

    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(second).toBe(first);
  });
});
