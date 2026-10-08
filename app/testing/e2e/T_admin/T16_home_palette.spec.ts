// T16_home_palette.spec.ts
// Proves Home's desktop/phone geometry, themes, live palette and durable save/reload.
// Connects the real Home API and administrator session; cleanup restores original settings.
// Run serially on the supervisor's native test instance, never a production instance.
import { expect, test, type Page } from '@playwright/test';
import { fetchCsrfTokenForRequest } from '../helpers/temp-dataset';

test.describe.configure({ mode: 'serial' });

async function forceTheme(page: Page, theme: 'light' | 'dark') {
  await page.emulateMedia({ colorScheme: theme === 'light' ? 'dark' : 'light' });
  await page.evaluate(selected => {
    document.body.classList.remove('light-mode', 'dark-mode');
    document.body.classList.add(`${selected}-mode`);
  }, theme);
}

async function changeRange(page: Page, id: string, value: number) {
  await page.getByTestId(id).evaluate((element: HTMLInputElement, next) => {
    element.value = String(next);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}

test('Home preview, saved reset and reload at 1280 and 375 pixels in both explicit themes', async ({ page }) => {
  const admin = await page.request.get('/api/admin/front-page');
  expect(admin.ok()).toBe(true);
  const original = await admin.json();
  const csrf = await fetchCsrfTokenForRequest(page.request);
  const headers = { 'X-CSRF-Token': csrf };
  const description = 'First line\nSecond line\n\nAnother paragraph. ' + 'Long translated text wraps safely. '.repeat(25);
  let completed = false;
  try {
    expect((await page.request.post('/api/admin/front-page', { headers, data: { settings: {
      separate_front_page: true, front_page_button_shows_site_name: original.settings.front_page_button_shows_site_name,
      front_page_show_blocks: false,
    } } })).ok()).toBe(true);
    // A hero write also stores both usage explanations, so the saved ones pass through unchanged.
    expect((await page.request.post('/api/admin/front-page', { headers, data: { hero: {
      title: { fi: 'Etusivun otsikko', en: 'Home title', usage_explanation: original.hero.title.usage_explanation },
      slogan: { fi: description, en: description, usage_explanation: original.hero.slogan.usage_explanation },
    } } })).ok()).toBe(true);
    for (const width of [1280, 375]) for (const theme of ['light', 'dark'] as const) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await expect(page.locator('.front-page-hero')).toBeVisible();
      await forceTheme(page, theme);
      const trigger = page.getByTestId('home-palette-button');
      await expect(trigger).toBeVisible();
      // As on dataset pages, the palette button has the gear's shape and paints its icon in the text colour; the
      // pointer leaves the button and the theme's colour transition settles before colours are compared.
      await page.mouse.move(0, 0);
      await expect.poll(() => trigger.evaluate(el => {
        const icon = getComputedStyle(el.querySelector('span')!);
        return icon.backgroundColor === icon.color && icon.color !== getComputedStyle(el).backgroundColor;
      })).toBe(true);
      const gear = page.getByTestId('front-page-settings-hero-button');
      const triggerBox = (await trigger.boundingBox())!, gearBox = (await gear.boundingBox())!;
      expect([triggerBox.width, triggerBox.height]).toEqual([gearBox.width, gearBox.height]);
      await expect(trigger).toHaveCSS('border-radius', await gear.evaluate(el => getComputedStyle(el).borderRadius));
      await trigger.click();
      const panel = page.getByTestId('home-palette');
      await expect(panel).toBeVisible();
      await panel.getByTestId('home-palette-anchor').selectOption('top-left');
      await panel.getByTestId('home-palette-paragraph-layout').selectOption('normal');
      await changeRange(page, 'home-palette-margin', 40);
      await changeRange(page, 'home-palette-max-width', 1120);
      const stage = page.locator('.front-page-text-stage');
      const hero = page.locator('.front-page-hero');
      await expect(hero).toHaveCSS('text-align', 'left');
      await expect(hero.locator('.front-page-description p')).toHaveCount(2);
      const heroBox = (await hero.boundingBox())!, stageBox = (await stage.boundingBox())!;
      expect(heroBox.x - stageBox.x).toBeCloseTo(width === 375 ? 16 : 40, 0);
      expect(heroBox.width).toBeCloseTo(width === 375 ? stageBox.width - 32 : Math.min(1120, stageBox.width - 80), 0);
      await panel.getByTestId('home-palette-anchor').selectOption('bottom-right');
      await panel.getByTestId('home-palette-paragraph-layout').selectOption('artistic');
      await expect(hero).toHaveCSS('text-align', 'center');
      const bottom = (await hero.boundingBox())!, bottomStage = (await stage.boundingBox())!;
      if (width === 375) {
        expect(bottom.y - bottomStage.y).toBeCloseTo(16, 0);
        expect(bottom.x - bottomStage.x).toBeCloseTo(16, 0);
      } else {
        expect(bottomStage.x + bottomStage.width - bottom.x - bottom.width).toBeCloseTo(40, 0);
        expect(bottomStage.y + bottomStage.height - bottom.y - bottom.height).toBeCloseTo(40, 0);
      }
      await page.keyboard.press('Escape');
      await expect(panel).toBeHidden(); await expect(trigger).toBeFocused();
      await expect(stage).toHaveAttribute('data-anchor', 'bottom-right');
      await trigger.click();
      const response = page.waitForResponse(res => res.url().endsWith('/api/admin/front-page') && res.request().method() === 'POST');
      await panel.getByTestId('home-palette-save').click(); expect((await response).ok()).toBe(true);
      await expect(panel.getByTestId('home-palette-save')).toBeEnabled();
      await panel.getByTestId('home-palette-anchor').selectOption('top-left');
      await panel.getByTestId('home-palette-reset').click();
      await expect(stage).toHaveAttribute('data-anchor', 'bottom-right');
      await page.reload({ waitUntil: 'domcontentloaded' }); await forceTheme(page, theme);
      await expect(stage).toHaveAttribute('data-anchor', 'bottom-right');
      await expect(hero).toHaveCSS('text-align', 'center');
      if (width === 375) expect(await page.locator('.front-page-scroller').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
      await page.getByTestId('home-palette-button').click();
      await expect(page.getByTestId('home-palette-anchor')).toHaveValue('bottom-right');
    }
    completed = true;
  } finally {
    // Every restore step runs even when another fails, so a failed run never leaves test copy or layout on Home.
    const failures: unknown[] = [];
    const attempt = async (step: () => Promise<void>) => { try { await step(); } catch (error) { failures.push(error); } };
    await attempt(async () => {
      expect((await page.request.post('/api/admin/front-page', { headers, data: { hero: {
        title: { fi: original.hero.title.fi, en: original.hero.title.en, usage_explanation: original.hero.title.usage_explanation },
        slogan: { fi: original.hero.slogan.fi, en: original.hero.slogan.en, usage_explanation: original.hero.slogan.usage_explanation },
      } } })).ok()).toBe(true);
    });
    await attempt(async () => {
      expect((await page.request.post('/api/admin/front-page', { headers, data: { settings: original.settings } })).ok()).toBe(true);
    });
    await attempt(async () => {
      if (original.presentation) {
        const latest = await (await page.request.get('/api/admin/front-page')).json();
        expect((await page.request.post('/api/admin/front-page', { headers, data: {
          presentation: original.presentation, version: latest.presentation_version,
        } })).ok()).toBe(true);
        return;
      }
      // Delete only the setting this test introduced, found by its key through supported application CRUD.
      const rowsResponse = await page.request.get('/api/get-results?dataset=system_config&key=front_page_presentation');
      expect(rowsResponse.ok()).toBe(true);
      const rows = (await rowsResponse.json()).data.filter((row: { key: string }) => row.key === 'front_page_presentation');
      expect(rows.length).toBeLessThanOrEqual(1);
      if (rows.length) {
        expect((await page.request.post('/api/delete-rows?dataset=system_config', { headers,
          data: { ids: rows.map((row: { id: number }) => row.id) } })).ok()).toBe(true);
      }
    });
    // A failure in the test body stays the reported error; cleanup failures are reported after a passing body.
    if (failures.length && completed) throw failures[0];
    if (failures.length) console.error('Home cleanup also failed:', failures);
  }
});

test('a missing layout retains legacy geometry and saved reset at desktop and phone widths', async ({ page }) => {
  const admin = await page.request.get('/api/admin/front-page');
  expect(admin.ok()).toBe(true);
  const original = await admin.json();
  const headers = { 'X-CSRF-Token': await fetchCsrfTokenForRequest(page.request) };
  expect((await page.request.post('/api/admin/front-page', { headers, data: { settings: {
    ...original.settings, separate_front_page: true,
  } } })).ok()).toBe(true);
  try {
    // The legacy response is controlled independently of installation layout choices.
    await page.route('**/api/front-page?*', async route => {
      const response = await route.fetch(); const data = await response.json();
      await route.fulfill({ response, json: { ...data, presentation: null, presentation_version: 'none' } });
    });
    for (const width of [1280, 375]) for (const theme of ['light', 'dark'] as const) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/', { waitUntil: 'domcontentloaded' }); await forceTheme(page, theme);
      const hero = page.locator('.front-page-hero');
      await expect(hero).toBeVisible(); await expect(hero).toHaveCSS('text-align', 'center');
      await expect(page.locator('.front-page-text-stage')).toHaveCount(0);
      const spacing = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--filterbar-content-top-space').trim() || '40px');
      await expect(hero).toHaveCSS('padding-top', spacing);
      await page.getByTestId('home-palette-button').click();
      await page.getByTestId('home-palette-paragraph-layout').selectOption('normal');
      await expect(hero).toHaveCSS('text-align', 'left');
      await page.getByTestId('home-palette-reset').click();
      await expect(hero).toHaveCSS('text-align', 'center');
      await expect(page.locator('.front-page-text-stage')).toHaveCount(0);
    }
  } finally {
    expect((await page.request.post('/api/admin/front-page', { headers, data: { settings: original.settings } })).ok()).toBe(true);
  }
});
