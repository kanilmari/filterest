// T14_dataset_cover_palette.spec.ts
// Verifies the protected palette and durable shared/dataset appearance choices.
// Connects UI previews and revision-protected saves to real cards, chips and reloads.
// Follows admin_tools/dataset_cover_test_palette.js, dataset_appearance_palette_state.js
// and site_presentation_state.js; restores only the paths this test changes.
import { expect, test } from '@playwright/test';
import {
  loadDatasetCardVisibility,
  loadSitePresentationSettings,
  restoreDatasetAppearance,
  restoreSitePresentationSettings,
} from '../helpers/appearance-revisions';
import { buildTempDatasetName, createTempDataset, dropTempDataset, openTempDataset } from '../helpers/temp-dataset';
import { waitForAppReady } from '../helpers/navigation';

test('admin cover palette is protected, movable, resizable, themed, and live-only', async ({ page }) => {
  await page.goto('/app_autojen_vanteet', { waitUntil: 'domcontentloaded' });
  const response = await page.request.get('/api/admin/ui-feature-flags');
  expect(response.ok()).toBe(true);
  expect(await response.json()).toEqual({ view_admin_cover_image_test_palette: true });
  const presentationResponse = await page.request.get('/api/site-presentation-settings');
  expect(presentationResponse.ok()).toBe(true);
  const presentation = (await loadDatasetCardVisibility(page.request, 'app_autojen_vanteet')).dataset_appearance;

  const hero = page.locator('.filterbar-inline-hero--has-cover');
  await page.evaluate(() => {
    document.body.classList.remove('light-mode');
    document.body.classList.add('dark-mode');
  });
  await expect.poll(async () => hero.evaluate((element) => (
    getComputedStyle(element, '::before').opacity
  ))).toBe(String(presentation.tab_values['dark.image_opacity']));
  // The cover always retains its bottom fade, even with the oval disabled.
  // A results-owned legacy mask can differ from the public site's mask; exercise
  // the actual palette toggle below rather than assuming its initial ownership.
  await expect.poll(async () => hero.evaluate((element) => (
    getComputedStyle(element, '::before').maskImage
  ))).toContain('linear-gradient');
  await page.evaluate(() => {
    document.body.classList.remove('dark-mode');
    document.body.classList.add('light-mode');
  });
  await expect.poll(async () => hero.evaluate((element) => (
    getComputedStyle(element, '::before').maskImage
  ))).toContain('linear-gradient');

  const button = page.locator('[data-testid="dataset-cover-test-palette-button"]');
  await expect(button).toBeVisible({ timeout: 10_000 });
  await button.click();

  const panel = page.locator('[data-testid="dataset-cover-test-palette"]');
  await expect(panel).toBeVisible();
  await expect(panel.getByTestId('dataset-cover-test-palette-scope-tab')).toBeChecked();
  const ovalEnabled = panel.locator('[data-testid="dataset-cover-test-palette-mask-enabled"]');
  // The background/cover toolbox remembers its native disclosure state.
  // Open the toolbox that owns the oval before interacting with its control.
  const coverDisclosure = panel.locator('details').filter({
    has: page.getByTestId('dataset-cover-test-palette-mask-enabled'),
  });
  if (!(await coverDisclosure.evaluate((element: HTMLDetailsElement) => element.open))) {
    await coverDisclosure.locator(':scope > summary').click();
  }
  await expect(ovalEnabled).toBeVisible();
  await expect(ovalEnabled).toBeEnabled();
  await ovalEnabled.uncheck();
  await expect.poll(async () => hero.evaluate((element) => (
    getComputedStyle(element, '::before').maskImage.includes('radial-gradient')
  ))).toBe(false);
  await ovalEnabled.check();
  await expect.poll(async () => hero.evaluate((element) => (
    getComputedStyle(element, '::before').maskImage
  ))).toContain('radial-gradient');
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
  await expect.poll(async () => hero.evaluate((element) => (
    getComputedStyle(element)
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
  expect(defaultHeight - zeroExtraHeight).toBeCloseTo(Number(presentation.tab_values['shared.hero_extra_height']), 0);

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
    background: getComputedStyle(element, '::after').backgroundColor,
  }))).toMatchObject({ configuredOpacity: '0.35' });

  const bottomFade = page.locator('[data-testid="dataset-cover-test-palette-hero-bottom-fade"]');
  await bottomFade.evaluate((input: HTMLInputElement) => {
    input.value = '80';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect.poll(async () => hero.evaluate((element) => (
    getComputedStyle(element, '::after').maskImage
  ))).toContain('80px');

  const cardImageWidth = page.locator('[data-testid="dataset-cover-test-palette-card-image-width"]');
  await cardImageWidth.evaluate((input: HTMLInputElement) => {
    input.value = '360';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect.poll(async () => hero.evaluate((element) => (
    getComputedStyle(element).getPropertyValue('--card_image_large_width').trim()
  ))).toBe('360px');

  await panel.getByTestId('dataset-cover-test-palette-scope-site').check();
  await expect(panel.getByTestId('dataset-cover-test-palette-theme-controls')).toHaveCount(0);
  await expect(ovalEnabled).toBeHidden();
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
  await expect(activeTabMaximumOpacity).toHaveValue(String(presentation.site_values['shared.active_tab_max_opacity']));
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
  test.setTimeout(60_000);
  const original = await loadSitePresentationSettings(page.request);
  const savedSide = original.site_values['shared.active_filter_remove_side'] || 'start';
  const chosenSide = savedSide === 'start' ? 'end' : 'start';
  try {
    await page.goto('/app_autojen_vanteet?search=chip-proof', { waitUntil: 'domcontentloaded' });
    const chip = page.locator('[data-testid="active-filter-item"]').filter({ hasText: 'chip-proof' }).first();
    await expect(chip).toBeVisible();
    await page.locator('[data-testid="dataset-cover-test-palette-button"]').click();
    const panel = page.locator('[data-testid="dataset-cover-test-palette"]');
    await panel.getByTestId('dataset-cover-test-palette-scope-site').check();
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
      await page.evaluate(() => { document.body.classList.toggle('dark-mode'); document.body.classList.toggle('light-mode'); });
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
    expect((await savedResponse.json()).site_values['shared.active_filter_remove_side']).toBe(chosenSide);
    await expect(panel.locator('[data-testid="dataset-cover-test-palette-save"]')).toBeEnabled();
    // A fresh load by the raw dataset name. The page may have rewritten its address to the public alias, and
    // reloading an alias within the alias registry's 60 s freshness window lands on Home (a separate, older issue).
    await page.goto('/app_autojen_vanteet?search=chip-proof', { waitUntil: 'domcontentloaded' });
    await expect(chip).toBeVisible();
    await expect(chip).toHaveAttribute('data-remove-side', chosenSide);
    expect(await order()).toBe(chosenSide === 'start' ? 'BUTTON' : 'SPAN');
    await page.locator('[data-testid="dataset-cover-test-palette-button"]').click();
    await expect(panel.getByTestId('dataset-cover-test-palette-scope-tab')).toBeChecked();
    await panel.getByTestId('dataset-cover-test-palette-scope-site').check();
    await expect(select).toHaveValue(chosenSide);
  } finally {
    await restoreSitePresentationSettings(page.request, original, ['shared.active_filter_remove_side']);
  }
});

test('dataset card palette saves style and detail columns through the administrator appearance route and survives reload', async ({ page }) => {
  test.setTimeout(60_000);
  const datasetName = 'app_autojen_vanteet';
  const original = (await loadDatasetCardVisibility(page.request, datasetName)).dataset_appearance;
  const chosenStyle = original.effective.shared.card_style_variant === 'modern' ? 'standard' : 'modern';
  const chosenColumns = original.effective.shared.card_detail_columns === 1 ? 2 : 1;
  const paths = ['shared.card_style_variant', 'shared.card_detail_columns'];
  const address = `/${datasetName}?view=card`;
  const card = page.locator(`#${datasetName}_card_view_container .card[data-card-presentation-view="card"]`).first();
  const panel = page.getByTestId('dataset-cover-test-palette');
  const style = panel.getByTestId('dataset-cover-test-palette-card-style');
  const columns = panel.getByTestId('dataset-cover-test-palette-card-detail-columns');
  const save = panel.getByTestId('dataset-cover-test-palette-save');
  const expectCardChoices = async () => {
    await expect(card).toBeVisible();
    await expect(card).toHaveAttribute('data-card-style-variant', chosenStyle);
    await expect(card).toHaveAttribute('data-card-detail-columns', String(chosenColumns));
    if (chosenStyle === 'modern') await expect(card).toHaveClass(/\bcard--modern\b/);
    else await expect(card).not.toHaveClass(/\bcard--modern\b/);
  };
  try {
    await page.goto(address, { waitUntil: 'domcontentloaded' });
    await expect(card).toBeVisible();
    await page.getByTestId('dataset-cover-test-palette-button').click();
    await style.evaluate(element => { element.closest('details')!.open = true; });
    await expect(style).toBeEnabled();
    await expect(columns).toBeEnabled();
    await expect(style).toHaveValue(String(original.effective.shared.card_style_variant));
    await expect(columns).toHaveValue(String(original.effective.shared.card_detail_columns));
    await style.selectOption(chosenStyle);
    await columns.evaluate((element: HTMLInputElement, value) => { element.value = String(value); element.dispatchEvent(new Event('input', { bubbles: true })); }, chosenColumns);
    await expectCardChoices();

    const latest = (await loadDatasetCardVisibility(page.request, datasetName)).dataset_appearance;
    const saved = page.waitForResponse(response => new URL(response.url()).pathname === '/api/admin/dataset-appearance'
      && response.request().method() === 'POST');
    await save.click();
    const response = await saved;
    expect(response.ok(), await response.text()).toBe(true);
    expect(response.request().postDataJSON()).toEqual({
      schema_version: 2, tab_set: {}, dataset_uid: original.dataset_uid, version: latest.version, shared_version: latest.shared_version,
      set: { 'shared.card_style_variant': chosenStyle, 'shared.card_detail_columns': chosenColumns }, unset: [],
    });
    const persisted = await response.json();
    expect(persisted.dataset_uid).toBe(original.dataset_uid);
    expect(persisted.version).not.toBe(latest.version);
    expect(persisted.overrides).toMatchObject({
      'shared.card_style_variant': chosenStyle, 'shared.card_detail_columns': chosenColumns,
    });
    await expect(save).toBeEnabled();
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    await expectCardChoices();

    // Load the raw dataset address again: reload of its rewritten alias can land on Home.
    await page.goto(address, { waitUntil: 'domcontentloaded' });
    await expectCardChoices();
    await expect(card).toHaveAttribute('data-card-style-override', chosenStyle);
    await expect(card).toHaveAttribute('data-card-columns-override', String(chosenColumns));
    const reloaded = (await loadDatasetCardVisibility(page.request, datasetName)).dataset_appearance;
    expect(reloaded.version).toBe(persisted.version);
    expect(reloaded.effective.shared.card_style_variant).toBe(chosenStyle);
    expect(reloaded.effective.shared.card_detail_columns).toBe(chosenColumns);
    await page.getByTestId('dataset-cover-test-palette-button').click();
    await style.evaluate(element => { element.closest('details')!.open = true; });
    await expect(style).toHaveValue(chosenStyle);
    await expect(columns).toHaveValue(String(chosenColumns));
  } finally {
    await restoreDatasetAppearance(page.request, datasetName, original, paths);
  }
});

// The common shell must keep the dataset's unsaved preview when closed and release it on navigation.
test('shared palette shell keeps dataset preview through close and restores saved values on teardown', async ({ page }) => {
  const saved = (await loadDatasetCardVisibility(page.request, 'app_autojen_vanteet')).dataset_appearance;
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
  await expect(input).toHaveValue(String(saved.tab_values['shared.hero_extra_height']));
  await expect.poll(preview).toBe(`${saved.tab_values['shared.hero_extra_height']}px`);
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await expect(panel).toHaveCount(0);
});

// Follows dataset_appearance_state.js and the definition's 28/9/7 ownership.
// The site patch and cleanup touch only one default; covers never enter site writes.
test('two empty datasets keep separate covers, inherit site defaults and retain explicit equality overrides', async ({ page }) => {
  test.setTimeout(90_000);
  // The page-based CRUD helper needs the authenticated application's origin.
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await waitForAppReady(page);
  const names = [buildTempDatasetName('palette_a'), buildTempDatasetName('palette_b')];
  const original = await loadSitePresentationSettings(page.request);
  const path = 'shared.card_image_width';
  const initialWidth = Number(original.defaults[path]);
  const chosenWidth = initialWidth === 420 ? 360 : 420;
  const created: string[] = [];
  let siteChanged = false;
  try {
    for (const name of names) {
      await createTempDataset(page, { datasetName: name, columns: { id: 'SERIAL', title: 'TEXT' } });
      created.push(name);
      await openTempDataset(page, name, 'card', { expectEmpty: true });
      await page.getByTestId('dataset-cover-test-palette-button').click();
      const panel = page.getByTestId('dataset-cover-test-palette');
      await expect(panel.getByTestId('dataset-cover-test-palette-scope-tab')).toBeChecked();
      await panel.getByTestId('dataset-cover-test-palette-hero-height').evaluate((el: HTMLInputElement, value) => {
        el.value = String(value); el.dispatchEvent(new Event('input', { bubbles: true }));
      }, name === names[0] ? 80 : 120);
      if (name === names[1]) {
        // Inputting the existing value still creates an override by presence.
        await panel.getByTestId('dataset-cover-test-palette-card-image-width').evaluate((el: HTMLInputElement, value) => {
          el.value = String(value); el.dispatchEvent(new Event('input', { bubbles: true }));
        }, initialWidth);
        await expect(panel.locator(`[data-appearance-path="${path}"] > small`)).toContainText(/Override|Oma asetus/);
      }
      const response = page.waitForResponse(res => res.url().endsWith('/api/admin/dataset-appearance')
        && res.request().method() === 'POST');
      await panel.getByTestId('dataset-cover-test-palette-save').click();
      const saved = await response; expect(saved.ok(), await saved.text()).toBe(true);
      expect(saved.request().postDataJSON()).toMatchObject({ schema_version: 2, tab_set: {
        'shared.hero_extra_height': name === names[0] ? 80 : 120,
      } });
    }
    const panel = page.getByTestId('dataset-cover-test-palette');
    await panel.getByTestId('dataset-cover-test-palette-scope-site').check();
    await expect(panel.getByTestId('dataset-cover-test-palette-image-opacity')).toBeHidden();
    await panel.getByTestId('dataset-cover-test-palette-card-image-width').evaluate((el: HTMLInputElement, value) => {
      el.value = String(value); el.dispatchEvent(new Event('input', { bubbles: true }));
    }, chosenWidth);
    const siteResponse = page.waitForResponse(res => res.url().endsWith('/api/admin/site-presentation-settings')
      && res.request().method() === 'POST');
    await panel.getByTestId('dataset-cover-test-palette-save').click();
    const siteSaved = await siteResponse; expect(siteSaved.ok(), await siteSaved.text()).toBe(true); siteChanged = true;
    expect(siteSaved.request().postDataJSON()).toEqual({ schema_version: 2, version: original.version, set: { [path]: chosenWidth } });
    for (const name of names) {
      await openTempDataset(page, name, 'card', { expectEmpty: true });
      const appearance = (await loadDatasetCardVisibility(page.request, name)).dataset_appearance;
      expect(appearance.tab_values['shared.hero_extra_height']).toBe(name === names[0] ? 80 : 120);
      expect(appearance.effective.shared.card_image_width).toBe(name === names[0] ? chosenWidth : initialWidth);
      expect(appearance.sources[path]).toBe(name === names[0] ? 'default' : 'override');
    }
    await page.getByTestId('dataset-cover-test-palette-button').click();
    await panel.locator(`[data-appearance-path="${path}"] button`).evaluate((el: HTMLButtonElement) => el.click());
    expect((await loadDatasetCardVisibility(page.request, names[1])).dataset_appearance.overrides[path]).toBe(initialWidth);
    const removal = page.waitForResponse(res => res.url().endsWith('/api/admin/dataset-appearance') && res.request().method() === 'POST');
    await panel.getByTestId('dataset-cover-test-palette-save').click(); expect((await removal).ok()).toBe(true);
    expect((await loadDatasetCardVisibility(page.request, names[1])).dataset_appearance.overrides[path]).toBeUndefined();
  } finally {
    try { if (siteChanged) await restoreSitePresentationSettings(page.request, original, [path]); }
    finally { for (const name of created.reverse()) await dropTempDataset(page, name); }
  }
});

test('phone palette keeps native scope keyboard focus and actions reachable in FI/EN over opposite OS themes', async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 375, height: 740 });
  for (const theme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: theme === 'light' ? 'dark' : 'light' });
    await page.goto('/app_autojen_vanteet', { waitUntil: 'domcontentloaded' });
    await page.evaluate(value => { document.body.classList.remove('light-mode', 'dark-mode'); document.body.classList.add(`${value}-mode`); }, theme);
    await page.getByTestId('dataset-cover-test-palette-button').click();
    const panel = page.getByTestId('dataset-cover-test-palette');
    const tab = panel.getByTestId('dataset-cover-test-palette-scope-tab');
    const site = panel.getByTestId('dataset-cover-test-palette-scope-site');
    await tab.focus(); await page.keyboard.press('ArrowRight'); await expect(site).toBeChecked(); await expect(site).toBeFocused();
    for (const language of ['fi', 'en']) {
      await page.evaluate(value => { document.documentElement.lang = value; }, language);
      await expect(site).toBeFocused();
      await expect(site.locator('..')).toContainText(language === 'fi' ? 'Kaikki aineistot' : 'All datasets');
    }
    await page.keyboard.press('ArrowLeft'); await expect(tab).toBeChecked();
    await panel.locator('details').evaluateAll(elements => elements.forEach(el => { (el as HTMLDetailsElement).open = true; }));
    await panel.locator('.dataset-cover-test-palette__body').evaluate(el => { el.scrollTop = el.scrollHeight; });
    for (const id of ['scope', 'save', 'reset', 'close']) {
      const control = panel.getByTestId(`dataset-cover-test-palette-${id}`);
      await expect(control).toBeVisible(); const rect = (await control.boundingBox())!;
      expect(rect.y).toBeGreaterThanOrEqual(0); expect(rect.y + rect.height).toBeLessThanOrEqual(740);
      expect(rect.height).toBeGreaterThanOrEqual(44);
    }
    const grids = await panel.locator('.dataset-cover-test-palette__controls').evaluateAll(elements => elements
      .filter(el => el.getBoundingClientRect().height > 0).map(el => getComputedStyle(el).gridTemplateColumns.split(' ').length));
    expect(grids.every(columns => columns === 1)).toBe(true);
    await panel.getByTestId('dataset-cover-test-palette-close').click();
    await page.getByTestId('dataset-cover-test-palette-button').click(); await expect(tab).toBeChecked();
  }
});
