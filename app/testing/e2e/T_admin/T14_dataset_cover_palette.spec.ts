// T14_dataset_cover_palette.spec.ts
// Verifies the protected appearance palette and durable selected-chip side choice.
// Connects shared previews and saved settings to real dataset chips and reloads.
// Restores site defaults after the persistence proof on the supervisor's registry.
import { expect, test } from '@playwright/test';
import { fetchCsrfTokenForRequest } from '../helpers/temp-dataset';

test('admin cover palette is protected, movable, resizable, themed, and live-only', async ({ page }) => {
  await page.goto('/app_autojen_vanteet', { waitUntil: 'domcontentloaded' });
  const response = await page.request.get('/api/admin/ui-feature-flags');
  expect(response.ok()).toBe(true);
  expect(await response.json()).toEqual({ view_admin_cover_image_test_palette: true });
  const presentationResponse = await page.request.get('/api/site-presentation-settings');
  expect(presentationResponse.ok()).toBe(true);
  const presentation = await presentationResponse.json();

  const hero = page.locator('.filterbar-inline-hero--has-cover');
  await page.evaluate(() => {
    document.body.classList.remove('light-mode');
    document.body.classList.add('dark-mode');
  });
  await expect.poll(async () => hero.evaluate((element) => (
    getComputedStyle(element, '::before').opacity
  ))).toBe(String(presentation.dataset_cover_theme.dark.image_opacity));
  if (presentation.dataset_cover_theme.dark.oval_enabled) {
    await expect.poll(async () => hero.evaluate((element) => (
      getComputedStyle(element, '::before').maskImage
    ))).not.toBe('none');
  } else {
    await expect.poll(async () => hero.evaluate((element) => (
      getComputedStyle(element, '::before').maskImage
    ))).toBe('none');
  }
  await page.evaluate(() => {
    document.body.classList.remove('dark-mode');
    document.body.classList.add('light-mode');
  });
  if (presentation.dataset_cover_theme.light.oval_enabled) {
    await expect.poll(async () => hero.evaluate((element) => (
      getComputedStyle(element, '::before').maskImage
    ))).not.toBe('none');
  } else {
    await expect.poll(async () => hero.evaluate((element) => (
      getComputedStyle(element, '::before').maskImage
    ))).toBe('none');
  }

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
  await expect(panel.locator('.dataset-cover-test-palette__group-icon')).toHaveCount(5);
  await expect(panel.locator('.dataset-cover-test-palette__group-chevron')).toHaveCount(5);

  const coverVisible = panel.locator(
    '[data-testid="dataset-cover-test-palette-cover-visible"]'
  );
  const imageOpacity = panel.locator('[data-testid="dataset-cover-test-palette-image-opacity"]');
  await imageOpacity.evaluate((input: HTMLInputElement) => {
    input.value = '1';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect(coverVisible).toBeChecked();
  await coverVisible.uncheck();
  await expect.poll(async () => hero.evaluate((element) => (
    getComputedStyle(element, '::before').opacity
  ))).toBe('0');
  await coverVisible.check();
  await expect.poll(async () => hero.evaluate((element) => (
    getComputedStyle(element, '::before').opacity
  ))).toBe('1');

  const imageBlur = panel.locator('[data-testid="dataset-cover-test-palette-image-blur"]');
  await imageBlur.evaluate((input: HTMLInputElement) => {
    input.value = '4';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect.poll(async () => hero.evaluate((element) => (
    getComputedStyle(element, '::before').filter
  ))).toBe('blur(4px)');

  await panel.locator('[data-testid="dataset-cover-test-palette-tab-dark"]').click();
  await imageBlur.evaluate((input: HTMLInputElement) => {
    input.value = '0';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.evaluate(() => {
    document.body.classList.remove('light-mode');
    document.body.classList.add('dark-mode');
  });
  await expect.poll(async () => hero.evaluate((element) => (
    getComputedStyle(element, '::before').filter
  ))).toBe('blur(0px)');
  await expect.poll(async () => page.evaluate(() => (
    getComputedStyle(document.documentElement)
      .getPropertyValue('--dataset-background-dark-image-blur').trim()
  ))).toBe('0px');

  await panel.locator('[data-testid="dataset-cover-test-palette-tab-light"]').click();
  await page.evaluate(() => {
    document.body.classList.remove('dark-mode');
    document.body.classList.add('light-mode');
  });

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

test('selected-chip side previews both DOM orders, resets, saves and survives reload', async ({ page }) => {
  const response = await page.request.get('/api/admin/site-presentation-settings');
  expect(response.ok()).toBe(true);
  const original = await response.json();
  const savedSide = original.dataset_cover_theme.shared.active_filter_remove_side || 'start';
  const chosenSide = savedSide === 'start' ? 'end' : 'start';
  try {
    await page.goto('/app_autojen_vanteet?search=chip-proof', { waitUntil: 'domcontentloaded' });
    const chip = page.locator('[data-testid="active-filter-item"]').filter({ hasText: 'chip-proof' }).first();
    await expect(chip).toBeVisible();
    await page.locator('[data-testid="dataset-cover-test-palette-button"]').click();
    const panel = page.locator('[data-testid="dataset-cover-test-palette"]');
    const select = panel.locator('[data-testid="dataset-cover-test-palette-active-filter-remove-side"]');
    await select.evaluate(element => { element.closest('details')!.open = true; });
    await expect(select).toHaveValue(savedSide);
    // Keep object identities in the browser to catch filter rebuilds during previews.
    await chip.evaluate(element => {
      element.setAttribute('data-preview-identity', 'retained');
      element.querySelector('button')!.setAttribute('data-preview-identity', 'retained-button');
    });
    const order = () => chip.evaluate(element => element.firstElementChild!.tagName);
    let presentationPosts = 0;
    page.on('request', request => {
      if (request.method() === 'POST' && request.url().endsWith('/api/admin/site-presentation-settings')) presentationPosts += 1;
    });
    for (const side of ['start', 'end']) {
      await chip.locator('button').focus();
      await select.evaluate((element: HTMLSelectElement, value) => {
        element.value = value;
        element.dispatchEvent(new Event('change', { bubbles: true }));
      }, side);
      expect(await order()).toBe(side === 'start' ? 'BUTTON' : 'SPAN');
      await expect(chip.locator('button')).toBeFocused();
      await expect(chip).toHaveAttribute('data-preview-identity', 'retained');
      await expect(chip.locator('button')).toHaveAttribute('data-preview-identity', 'retained-button');
      await panel.locator('[data-testid="dataset-cover-test-palette-tab-dark"]').click();
      await expect(select).toHaveValue(side);
    }
    expect(presentationPosts).toBe(0);
    await chip.locator('button').focus();
    await panel.locator('[data-testid="dataset-cover-test-palette-reset"]').evaluate((element: HTMLButtonElement) => element.click());
    await expect(select).toHaveValue(savedSide);
    await expect(chip.locator('button')).toBeFocused();
    expect(await order()).toBe(savedSide === 'start' ? 'BUTTON' : 'SPAN');
    await select.selectOption(chosenSide);
    const saved = page.waitForResponse(response => response.url().endsWith('/api/admin/site-presentation-settings')
      && response.request().method() === 'POST');
    await panel.locator('[data-testid="dataset-cover-test-palette-save"]').click();
    const savedResponse = await saved;
    expect(savedResponse.ok()).toBe(true);
    expect((await savedResponse.json()).dataset_cover_theme.shared.active_filter_remove_side).toBe(chosenSide);
    await expect(panel.locator('[data-testid="dataset-cover-test-palette-save"]')).toBeEnabled();
    // A fresh load by the raw dataset name. The page may have rewritten its address to the public alias, and
    // reloading an alias within the alias registry's 60 s freshness window lands on Home (a separate, older issue).
    await page.goto('/app_autojen_vanteet?search=chip-proof', { waitUntil: 'domcontentloaded' });
    await expect(chip).toBeVisible();
    await expect(chip).toHaveAttribute('data-remove-side', chosenSide);
    expect(await order()).toBe(chosenSide === 'start' ? 'BUTTON' : 'SPAN');
    await page.locator('[data-testid="dataset-cover-test-palette-button"]').click();
    await expect(select).toHaveValue(chosenSide);
  } finally {
    const csrfToken = await fetchCsrfTokenForRequest(page.request);
    const restored = await page.request.post('/api/admin/site-presentation-settings', {
      data: original, headers: { 'X-CSRF-Token': csrfToken },
    });
    expect(restored.ok()).toBe(true);
  }
});

// The common shell must keep the dataset's unsaved preview when closed and release it on navigation.
test('shared palette shell keeps dataset preview through close and restores saved values on teardown', async ({ page }) => {
  const saved = await (await page.request.get('/api/site-presentation-settings')).json();
  await page.goto('/app_autojen_vanteet', { waitUntil: 'domcontentloaded' });
  const button = page.getByTestId('dataset-cover-test-palette-button');
  await button.click();
  const panel = page.getByTestId('dataset-cover-test-palette');
  const input = panel.getByTestId('dataset-cover-test-palette-hero-height');
  await input.evaluate((element: HTMLInputElement) => { element.value = '200'; element.dispatchEvent(new Event('input', { bubbles: true })); });
  const hero = page.locator('.filterbar-inline-hero--has-cover');
  const preview = () => hero.evaluate(el => getComputedStyle(el).getPropertyValue('--dataset-cover-hero-extra-height').trim());
  await expect.poll(preview).toBe('200px');
  await page.keyboard.press('Escape'); await expect(button).toBeFocused(); await expect(panel).toBeHidden();
  await expect.poll(preview).toBe('200px');
  await button.click(); await panel.getByTestId('dataset-cover-test-palette-reset').click();
  await expect(input).toHaveValue(String(saved.dataset_cover_theme.shared.hero_extra_height));
  await expect.poll(preview).toBe(`${saved.dataset_cover_theme.shared.hero_extra_height}px`);
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await expect(panel).toHaveCount(0);
});
