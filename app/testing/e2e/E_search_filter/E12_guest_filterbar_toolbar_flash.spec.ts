/**
 * E12_guest_filterbar_toolbar_flash.spec.ts
 *
 * Verifies unsigned-in Service catalog visitors never paint unauthorized
 * filterbar toolkit headings, even for a frame, before rights resolve.
 * Exists so guests cannot see Add & manage content or View content as…
 * flash on first paint (LNCD #892).
 */

import { test, expect } from '@playwright/test';
import { openActiveFilterbarIfCollapsed } from '../helpers/filterbar';
import { navigateToDefaultDataset } from '../helpers/navigation';

const FORBIDDEN_FILTERBAR_LANG_KEYS = [
  'filterbar_add_manage_content',
  'filterbar_view_content_as',
] as const;

const FORBIDDEN_FILTERBAR_LABELS = [
  'Add & manage content',
  'View content as…',
] as const;

test.describe('E12 — Guest filterbar toolkit first paint', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('never paints unauthorized toolkit labels for a guest', async ({ page, request }, testInfo) => {
    test.skip(
      testInfo.project.metadata?.screenWidth !== 'desktop',
      'Guest first-paint proof only needs one viewport project.',
    );

    const authModesResponse = await request.get('/api/auth-modes', {
      headers: {
        'X-Bypass-Ratelimit': 'test-mode',
      },
    });
    const authModes = await authModesResponse.json();
    test.skip(
      Boolean(authModes?.login_required_for_browse),
      'Guest Service catalog toolbar is only reachable when browsing without login is allowed.',
    );

    await page.addInitScript(
      ({ langKeys }) => {
        const seen = new Set();
        const recordElement = (node) => {
          if (!(node instanceof Element)) {
            return;
          }
          const candidates = [
            node,
            ...Array.from(node.querySelectorAll('[data-lang-key]')),
          ];
          for (const candidate of candidates) {
            const key = candidate.getAttribute('data-lang-key');
            if (key && langKeys.includes(key)) {
              seen.add(key);
            }
          }
        };
        const observer = new MutationObserver((mutations) => {
          for (const mutation of mutations) {
            mutation.addedNodes.forEach(recordElement);
          }
        });
        observer.observe(document.documentElement, {
          childList: true,
          subtree: true,
        });
        Object.defineProperty(window, '__forbiddenFilterbarLangKeysSeen', {
          configurable: true,
          get: () => Array.from(seen),
        });
      },
      { langKeys: [...FORBIDDEN_FILTERBAR_LANG_KEYS] },
    );

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await navigateToDefaultDataset(page);
    await openActiveFilterbarIfCollapsed(page);

    const permittedHeading = page.locator(
      '.tab_parts_container:visible [data-lang-key="filterbar_filter_results"]',
    ).first();
    await expect(permittedHeading).toBeAttached({ timeout: 15000 });

    const seenKeys = await page.evaluate(
      () => (window as Window & { __forbiddenFilterbarLangKeysSeen?: string[] })
        .__forbiddenFilterbarLangKeysSeen || [],
    );
    expect(seenKeys).toEqual([]);

    for (const langKey of FORBIDDEN_FILTERBAR_LANG_KEYS) {
      await expect(
        page.locator(`.tab_parts_container [data-lang-key="${langKey}"]`),
      ).toHaveCount(0);
    }
    for (const label of FORBIDDEN_FILTERBAR_LABELS) {
      await expect(page.getByText(label, { exact: true })).toHaveCount(0);
    }
  });
});
