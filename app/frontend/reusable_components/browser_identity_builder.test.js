// browser_identity_builder.test.js
// Verifies browser fingerprint collection and hashing for auth/session binding.
// Bridges navigator-derived identity data and SHA-256 hashing in a jsdom-safe way.
// Exists to keep the client-side fingerprint input and digest format stable.

import { describe, test, expect, beforeEach } from 'vitest';
import {
  gather_browser_fingerprint_data,
  gather_browser_fingerprint_hash,
  withoutVersionNumbers,
} from './browser_identity_builder.js';

function useUserAgent(userAgent) {
  Object.defineProperty(window.navigator, 'userAgent', {
    value: userAgent,
    configurable: true,
  });
}

describe('browser_identity_builder', () => {
  beforeEach(() => {
    useUserAgent('VitestAgent/1.0');
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
      user_agent: 'VitestAgent/',
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

  // A browser update changes only version numbers; it must not end the sign-in.
  test('keeps the same identity when only the browser version changes', async () => {
    useUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0');
    const beforeUpdate = await gather_browser_fingerprint_hash();
    useUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0');
    const afterUpdate = await gather_browser_fingerprint_hash();

    expect(afterUpdate).toBe(beforeUpdate);
  });

  test('still tells different browsers apart', async () => {
    useUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0');
    const firefox = await gather_browser_fingerprint_hash();
    useUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36');
    const chrome = await gather_browser_fingerprint_hash();

    expect(chrome).not.toBe(firefox);
  });

  test('removes every version number and keeps the names', () => {
    expect(withoutVersionNumbers('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Version/17.4.1 Safari/605.1.15'))
      .toBe('Mozilla/ (Macintosh; Intel Mac OS X ) Version/ Safari/');
    expect(withoutVersionNumbers(undefined)).toBe('');
  });
});
