import { expect, test } from '@playwright/test';

test('admin cover palette is protected, movable, resizable, themed, and live-only', async ({ page }) => {
  await page.goto('/app_autojen_vanteet', { waitUntil: 'domcontentloaded' });
  const response = await page.request.get('/api/admin/ui-feature-flags');
  expect(response.ok()).toBe(true);
  expect(await response.json()).toEqual({ view_admin_cover_image_test_palette: true });

  const hero = page.locator('.filterbar-inline-hero--has-cover');
  await page.evaluate(() => {
    document.body.classList.remove('light-mode');
    document.body.classList.add('dark-mode');
  });
  await expect.poll(async () => hero.evaluate((element) => ({
    mask: getComputedStyle(element, '::before').maskImage,
    opacity: getComputedStyle(element, '::before').opacity,
  }))).toEqual({ mask: 'none', opacity: '0.3' });
  await page.evaluate(() => {
    document.body.classList.remove('dark-mode');
    document.body.classList.add('light-mode');
  });
  await expect.poll(async () => hero.evaluate((element) => (
    getComputedStyle(element, '::before').maskImage
  ))).not.toBe('none');

  const button = page.locator('[data-testid="dataset-cover-test-palette-button"]');
  await expect(button).toBeVisible({ timeout: 10_000 });
  await button.click();

  const panel = page.locator('[data-testid="dataset-cover-test-palette"]');
  await expect(panel).toBeVisible();
  const box = await panel.boundingBox();
  const viewportHeight = page.viewportSize()!.height;
  expect(box).not.toBeNull();
  expect(box!.width).toBeLessThanOrEqual(440);
  expect(box!.height).toBeLessThanOrEqual(viewportHeight * 0.97 + 1);
  await expect(panel.locator('.dataset-cover-test-palette__heading')).toBeVisible();
  await expect(panel.locator('.dataset-cover-test-palette__group-icon')).toHaveCount(6);
  await expect(panel.locator('.dataset-cover-test-palette__group-chevron')).toHaveCount(6);

  const defaultHeight = (await hero.boundingBox())!.height;
  const heroHeight = page.locator('[data-testid="dataset-cover-test-palette-hero-height"]');
  await heroHeight.evaluate((input: HTMLInputElement) => {
    input.value = '0';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const zeroExtraHeight = (await hero.boundingBox())!.height;
  expect(defaultHeight - zeroExtraHeight).toBeCloseTo(40, 0);

  const ovalPosition = page.locator(
    '[data-testid="dataset-cover-test-palette-oval-position-y"]'
  );
  await ovalPosition.evaluate((input: HTMLInputElement) => {
    input.value = '65';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect.poll(async () => hero.evaluate((element) => (
    getComputedStyle(element, '::before').maskImage
  ))).toContain('65%');

  const overlay = page.locator('[data-testid="dataset-cover-test-palette-overlay-opacity"]');
  await overlay.evaluate((input: HTMLInputElement) => {
    input.value = '0.35';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect.poll(async () => hero.evaluate((element) => ({
    configuredOpacity: getComputedStyle(element)
      .getPropertyValue('--dataset-cover-light-overlay-opacity').trim(),
    background: getComputedStyle(element, '::after').backgroundImage,
  }))).toMatchObject({ configuredOpacity: '0.35' });

  const bottomFade = page.locator('[data-testid="dataset-cover-test-palette-hero-bottom-fade"]');
  await bottomFade.evaluate((input: HTMLInputElement) => {
    input.value = '80';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect.poll(async () => hero.evaluate((element) => (
    getComputedStyle(element, '::after').backgroundImage
  ))).toContain('80px');

  const cardImageWidth = page.locator('[data-testid="dataset-cover-test-palette-card-image-width"]');
  await cardImageWidth.evaluate((input: HTMLInputElement) => {
    input.value = '360';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect.poll(async () => page.evaluate(() => (
    getComputedStyle(document.documentElement).getPropertyValue('--card_image_large_width').trim()
  ))).toBe('360px');

  const activeTabFade = page.locator('[data-testid="dataset-cover-test-palette-active-tab-fade"]');
  await activeTabFade.evaluate((input: HTMLInputElement) => {
    input.value = '42';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect.poll(async () => page.evaluate(() => (
    getComputedStyle(document.documentElement).getPropertyValue('--navtab-active-fade-width').trim()
  ))).toBe('42px');
  const activeTabMaximumOpacity = page.locator(
    '[data-testid="dataset-cover-test-palette-active-tab-max-opacity"]'
  );
  await expect(activeTabMaximumOpacity).toHaveValue('1');
  await activeTabMaximumOpacity.evaluate((input: HTMLInputElement) => {
    input.value = '0.2';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect.poll(async () => page.evaluate(() => (
    getComputedStyle(document.documentElement)
      .getPropertyValue('--navtab-active-max-opacity').trim()
  ))).toBe('0.2');

  const glowIntensity = page.locator(
    '[data-testid="dataset-cover-test-palette-active-tab-glow-intensity"]'
  );
  await glowIntensity.evaluate((input: HTMLInputElement) => {
    input.value = '0.15';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect.poll(async () => page.evaluate(() => (
    getComputedStyle(document.documentElement)
      .getPropertyValue('--navtab-active-glow-intensity').trim()
  ))).toBe('0.15');

  const brandColor = page.locator('[data-testid="dataset-cover-test-palette-brand-color"]');
  await brandColor.evaluate((input: HTMLInputElement) => {
    input.value = '#cc3366';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect.poll(async () => page.evaluate(() => ({
    hue: getComputedStyle(document.documentElement).getPropertyValue('--brand-hue').trim(),
    saturation: getComputedStyle(document.documentElement).getPropertyValue('--brand-sat').trim(),
    lightness: getComputedStyle(document.documentElement).getPropertyValue('--brand-light').trim(),
  }))).toEqual({ hue: '340', saturation: '60%', lightness: '50%' });

  const heading = panel.locator('.dataset-cover-test-palette__heading');
  const beforeDrag = (await panel.boundingBox())!;
  const headingBox = (await heading.boundingBox())!;
  await page.mouse.move(headingBox.x + 20, headingBox.y + 15);
  await page.mouse.down();
  await page.mouse.move(headingBox.x - 80, headingBox.y + 75);
  await page.mouse.up();
  const afterDrag = (await panel.boundingBox())!;
  expect(afterDrag.x).toBeLessThan(beforeDrag.x);
  expect(afterDrag.y).toBeGreaterThan(beforeDrag.y);
  await expect(panel).toHaveCSS('resize', 'both');
  await panel.evaluate((element: HTMLElement) => {
    element.style.width = '340px';
    element.style.height = '360px';
  });
  const resized = (await panel.boundingBox())!;
  expect(resized.width).toBeCloseTo(340, 0);
  expect(resized.height).toBeCloseTo(360, 0);
});
