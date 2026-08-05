# Golden Sample: Playwright E2E Test

This file serves as a reference implementation for End-to-End tests using Playwright.
It is stored as a `.md` file to prevent execution, but the code block below is valid TypeScript.

**Full guide:** See [E2E_Testing_Guide.md](../instructions_and_documentation/E2E_Testing_Guide.md) for critical patterns (fixed sidebar, tree expansion, checkbox events, avoiding page reload).

```typescript
/**
 * golden_sample_test.spec.ts
 *
 * Reference E2E test showing common Easelect patterns.
 * For a real working example, see: testing/e2e/T_admin/T7_card_visibility.spec.ts
 */

import { test, expect } from '@playwright/test';
import { login, loadCredentials, type TestCredentials } from '../helpers/auth';

test.describe('Golden Sample Feature', () => {
  // Force a specific viewport if the feature needs width (e.g. admin matrix views)
  test.use({ viewport: { width: 1440, height: 900 } });

  let credentials: TestCredentials;

  test.beforeAll(() => {
    credentials = loadCredentials();
  });

  test.beforeEach(async ({ page }) => {
    // Log browser errors for debugging
    page.on('console', (msg) => {
      if (msg.type() === 'error') console.log(`BROWSER ERROR: ${msg.text()}`);
    });
    // Login (uses storageState, falls back to manual login if expired)
    await login(page, credentials);
    // Wait for app shell to be ready
    await page.waitForSelector('.navtablinks', { timeout: 15000 });
  });

  test('should navigate to an admin view via the sidebar', async ({ page }) => {
    // IMPORTANT: The sidebar (#navbar) is position:fixed.
    // Playwright's click() fails with "outside of the viewport".
    // Always use page.evaluate() for sidebar interactions.

    // 1. Open admin_tools collapsible
    await page.evaluate(() => {
      const btn = document.querySelector(
        'button.collapsible[data-group="admin_tools"]'
      ) as HTMLElement;
      if (btn) {
        btn.scrollIntoView({ block: 'center' });
        if (btn.getAttribute('aria-expanded') !== 'true') btn.click();
      }
    });
    await page.waitForTimeout(500);

    // 2. Expand a folder if needed (folders beyond initial_open_level are collapsed)
    await page.evaluate(() => {
      const node = document.getElementById('tree_node_maintenance_admin');
      if (!node) return;
      const children = node.querySelector(':scope > .children') as HTMLElement;
      if (children && children.style.display === 'none') {
        const label = node.querySelector(
          '.node-row span[data-lang-key="maintenance"]'
        ) as HTMLElement;
        if (label) label.click();
      }
    });
    await page.waitForTimeout(300);

    // 3. Click the target view button
    // Admin tree buttons have class 'general_button_admin' and data-lang-key="{viewName}"
    await page.evaluate(() => {
      const btn = document.querySelector(
        '#admin_tools_tree button.general_button_admin[data-lang-key="my_view"]'
      ) as HTMLElement;
      if (btn) { btn.scrollIntoView({ block: 'center' }); btn.click(); }
    });

    // 4. Verify the view container appeared
    await expect(page.locator('#my_view_container')).toBeVisible({ timeout: 10000 });
  });

  test('should interact with a checkbox tree', async ({ page }) => {
    // When interacting with vanilla_tree checkboxes:
    // 1. Expand all folders (they may be collapsed)
    // 2. Set cb.checked and DISPATCH change event (required for event chain)

    const clicked = await page.evaluate(() => {
      const tree = document.getElementById('my_tree_id');
      if (!tree) return false;

      // Expand all collapsed folders
      tree.querySelectorAll('.node[data-is-folder="true"]').forEach((folder) => {
        const ch = folder.querySelector(':scope > .children') as HTMLElement;
        if (ch && ch.style.display === 'none') {
          ch.style.cssText = 'display:block;overflow:hidden;';
        }
      });

      // Click first visible leaf checkbox
      const leaves = tree.querySelectorAll('.node[data-is-folder="false"]');
      for (const leaf of leaves) {
        const cb = leaf.querySelector('input[type="checkbox"]') as HTMLInputElement;
        if (cb && cb.offsetWidth > 0) {
          cb.checked = true;
          cb.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        }
      }
      return false;
    });
    expect(clicked).toBe(true);
  });

  test('should verify persistence without page reload', async ({ page }) => {
    // AVOID page.reload() — it causes "Failed to fetch" errors in the SPA.
    // Instead, deselect and reselect to trigger a fresh API call.

    // ... make changes and save ...

    // Deselect all
    await page.evaluate(() => {
      const tree = document.getElementById('my_tree_id');
      if (!tree) return;
      tree.querySelectorAll('input[type="checkbox"]:checked').forEach((cb) => {
        (cb as HTMLInputElement).checked = false;
        cb.dispatchEvent(new Event('change', { bubbles: true }));
      });
    });
    await page.waitForTimeout(500);

    // Reselect → triggers fresh GET from server
    // ... select again and verify values ...
  });
});
```
