// L12_phone_form_edges.spec.ts
// Measures login and profile form edges across their responsive widths.
// Connects the shared authenticated session and empty guest session to rendered forms.
// Browser proof needs real boxes and title/menu positions, which CSS text cannot establish.
// Blocks settings/data writes and fails if the page attempts one; never submits a form.
import { expect, test as base, type Locator } from '@playwright/test';
import { waitForAppReady } from '../helpers/navigation';

const test = base.extend<{ readOnlyGuard: void }>({
  readOnlyGuard: [async ({ context }, use) => {
    const writes: string[] = [];
    await context.route('**/api/**', async route => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      if (request.method() !== 'GET'
        && /^\/api\/(admin\/|update-profile|dataset-appearance|site-presentation|row|add-row|update-|delete|user-visual-preference)/.test(pathname)) {
        writes.push(`${request.method()} ${pathname}`);
        return route.abort('blockedbyclient');
      }
      // Keep the explicit application theme independent of this account's saved preference.
      if (request.method() === 'GET' && pathname === '/api/user-visual-preference') {
        return route.fulfill({ json: { configured: true, theme_mode: 'light', revision: 1 } });
      }
      return route.continue();
    });
    try { await use(); }
    finally { expect(writes, 'No settings or data write may be attempted').toEqual([]); }
  }, { auto: true }],
});

test.use({ serviceWorkers: 'block' });
test.beforeEach(async ({ page }) => {
  // b334's geometry rules are theme-independent; exercise light overriding a dark OS.
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.addInitScript(() => {
    localStorage.setItem('chosen_language', 'fi');
    localStorage.setItem('theme', 'light');
    localStorage.setItem('navVisibleNarrow', 'false');
    localStorage.setItem('navVisibleWide', 'false');
    // Admin bootstrap's OID refresh fires when this marker is over 10 minutes old; keep the guard unchanged.
    localStorage.setItem('easelect_oid_refresh_started_at', String(Date.now()));
  });
});

async function edges(locator: Locator) {
  await expect(locator).toBeVisible();
  return locator.evaluate(element => {
    const box = element.getBoundingClientRect();
    return { left: box.left, right: innerWidth - box.right };
  });
}

async function expectEdges(locator: Locator, inset: number) {
  await expect.poll(() => edges(locator)).toEqual({ left: inset, right: inset });
}

test.describe('logged out / Finnish / light', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('login edges at 390, 700 and 768px', async ({ page }) => {
    for (const width of [390, 700, 768]) {
      await test.step(`login at ${width}px`, async () => {
        await page.setViewportSize({ width, height: 1000 });
        await page.goto('/login', { waitUntil: 'domcontentloaded' });
        const form = page.getByTestId('login-form');
        await expect(form).toBeVisible();
        await expect(page.locator('body')).toHaveClass(/light-mode/);
        await page.evaluate(() => document.fonts.ready);
        const sideBorders = await form.evaluate(element => {
          const style = getComputedStyle(element);
          return [parseFloat(style.borderLeftWidth), parseFloat(style.borderRightWidth)];
        });
        if (width === 768) {
          expect(sideBorders.every(border => border > 0), 'Tablet keeps both login side borders').toBe(true);
          const inset = await edges(form);
          expect(inset.left).toBeGreaterThan(0); expect(inset.right).toBeGreaterThan(0);
        } else if (width === 700) {
          const padding = await page.locator('.auth-page-content-card').evaluate(element => {
            const style = getComputedStyle(element);
            return [parseFloat(style.paddingLeft), parseFloat(style.paddingRight)];
          });
          expect(padding).toEqual([16, 16]);
          await expect.poll(() => page.evaluate(() =>
            Math.max(document.documentElement.scrollWidth, document.body.scrollWidth))).toBeLessThanOrEqual(width);
        } else {
          await expectEdges(form, 0);
          await expectEdges(page.getByTestId('login-username'), 16);
          await expectEdges(form.locator('label[for="username"]'), 16);
          expect(sideBorders).toEqual([0, 0]);
          await expect.poll(async () => (await edges(page.locator('.auth-page-tablist'))).left).toBe(16);
          await expectEdges(page.locator('.auth-page-header-row'), 16);
        }
      });
    }
  });
});

test('signed in / Finnish / light: profile edges at 390 and 768px', async ({ page }) => {
  for (const width of [390, 768]) {
    await test.step(`profile at ${width}px`, async () => {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await waitForAppReady(page);
      const profile = await page.request.get('/api/user-profile');
      expect(profile.ok(), 'Requires the global setup authenticated session; no login POST fallback').toBe(true);
      expect((await profile.json()).user_id).toBeGreaterThan(1);
      const account = page.locator('[data-testid="navbar-auth-user"], [data-testid="tab-user"]').first();
      await account.waitFor({ state: 'attached' });
      await account.evaluate((node: HTMLElement) => node.click());
      const form = page.locator('#user_profile_form');
      await expect(page.locator('#edit_username')).toBeVisible();
      await expect(page.locator('body')).toHaveClass(/light-mode/);
      await page.evaluate(() => document.fonts.ready);
      if (width === 768) {
        const inset = await edges(form);
        expect(inset.left).toBeGreaterThan(0); expect(inset.right).toBeGreaterThan(0);
      } else {
        await expectEdges(form, 0);
        await expectEdges(page.locator('#edit_username'), 16);
        const heading = form.locator('..').locator(':scope > :is(h1, h2, h3, h4, h5, h6):first-child');
        const menu = page.locator('#showMenuButton');
        await expect(heading).toBeVisible(); await expect(menu).toBeVisible();
        const titleBox = (await heading.boundingBox())!; const menuBox = (await menu.boundingBox())!;
        const intersects = titleBox.x < menuBox.x + menuBox.width && titleBox.x + titleBox.width > menuBox.x
          && titleBox.y < menuBox.y + menuBox.height && titleBox.y + titleBox.height > menuBox.y;
        expect(intersects, 'The page title clears the floating menu').toBe(false);
        expect(titleBox.x).toBeGreaterThanOrEqual(64);
        expect(titleBox.y + titleBox.height / 2).toBeCloseTo(menuBox.y + menuBox.height / 2, 0);
        expect(await form.locator('..').evaluate(element =>
          getComputedStyle(element).getPropertyValue('--management-forms-padding').trim())).toBe('16px');
      }
    });
  }
});
