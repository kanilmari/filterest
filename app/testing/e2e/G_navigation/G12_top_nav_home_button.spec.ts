// G12_top_nav_home_button.spec.ts
// Proves Home placement, original bar visibility and live authoritative availability.
// Every Home/settings response is intercepted; no settings POST reaches any server.
// Before/after screenshots live under test-results; G11 proves menu → Home → dataset.
import { test, expect, type Page } from '@playwright/test';
import { installHomePolicy, openHomeProbeDataset, captureHomeProbe, probePhase } from '../helpers/home-policy-fixture';
import { ensureNavbarVisible } from '../helpers/navbar';
import { expandAdminTreeFolder, openAdminTreeButton } from '../helpers/admin-navigation';

for (const language of ['fi', 'en']) for (const theme of ['light', 'dark'] as const) {
  test(`390px Home first-paint labels stay in ${language} in ${theme}`, async ({ page, context }) => {
    test.setTimeout(60_000);
    page.on('request', request => {
      if (['/api/admin/front-page', '/api/user-visual-preference', '/api/row-update', '/api/row-create']
        .includes(new URL(request.url()).pathname)) expect(request.method()).toBe('GET');
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme: theme === 'light' ? 'dark' : 'light' });
    await installHomePolicy(context, theme);
    const expected = language === 'fi'
      ? ['Etusivu', 'Matkailupalvelut ja pitkät paikalliset matkatarjoukset']
      : ['Home', 'Travel services and local offers'];
    let homeRequested!: () => void;
    const homeRead = new Promise<void>(resolve => { homeRequested = resolve; });
    await context.route(/\/api\/front-page(?:\?.*)?$/, async route => {
      expect(route.request().method()).toBe('GET');
      homeRequested(); await route.fallback();
    });
    await context.route(/\/api\/datasets(?:\?.*)?$/, async route => {
      expect(route.request().method()).toBe('GET');
      const response = await route.fetch();
      const data = await response.json();
      const dataset = data.datasets.find((entry: { dataset_name: string }) => entry.dataset_name === 'app_service_catalog');
      expect(dataset).toBeTruthy();
      await route.fulfill({ response, json: { ...data, tab_order: null,
        datasets: [{ ...dataset, is_top_level_in_current_project: true }] } });
    });
    await context.route(/\/api\/translations\?lang=(?:fi|en)$/, async route => {
      expect(route.request().method()).toBe('GET');
      const response = await route.fetch();
      const data = await response.json();
      const fi = new URL(route.request().url()).searchParams.get('lang') === 'fi';
      const overrides = { front_page: fi ? 'Etusivu' : 'Home', app_service_catalog: fi
        ? 'Matkailupalvelut ja pitkät paikalliset matkatarjoukset' : 'Travel services and local offers' };
      // Force the old cold-start race, even on a fast local target. Only GET responses change.
      await homeRead; await new Promise(resolve => setTimeout(resolve, 300));
      await route.fulfill({ response, json: data.translations
        ? { ...data, translations: { ...data.translations, ...overrides } } : { ...data, ...overrides } });
    });
    await page.addInitScript(language => {
      localStorage.setItem('chosen_language', language);
      localStorage.setItem('navVisibleNarrow', 'false');
      type Sample = { time: number; labels: { text: string; width: number; height: number }[];
        rowHeight: number; heroTop: number };
      const probe = { samples: [] as Sample[], done: false };
      (window as unknown as { homeLanguageProbe: typeof probe }).homeLanguageProbe = probe;
      let start: number | undefined;
      function sample(time: number) {
        const root = document.getElementById('front_page_container');
        const row = root?.querySelector('.front-page-top-row');
        const hero = root?.querySelector('.front-page-hero');
        const labels = [...(row?.querySelectorAll('.navbar-front-page-label, .hero-dataset-tabs__label') || [])];
        if (hero && row && labels.length >= 2 && labels.every(label => label.getBoundingClientRect().width > 0)) {
          start ??= time;
          probe.samples.push({ time: time - start, labels: labels.map(label => {
            const box = label.getBoundingClientRect();
            return { text: label.textContent || '', width: box.width, height: box.height };
          }), rowHeight: row.getBoundingClientRect().height, heroTop: hero.getBoundingClientRect().top });
          if (time - start >= 1000) { probe.done = true; return; }
        }
        requestAnimationFrame(sample);
      }
      requestAnimationFrame(sample);
    }, language);
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => (window as unknown as { homeLanguageProbe: { done: boolean } }).homeLanguageProbe.done);
    const samples = await page.evaluate(() => (window as unknown as { homeLanguageProbe: {
      samples: { time: number; labels: { text: string; width: number; height: number }[]; rowHeight: number; heroTop: number }[];
    } }).homeLanguageProbe.samples);
    expect(samples.length).toBeGreaterThan(10);
    expect(samples.at(-1)!.time).toBeGreaterThanOrEqual(1000);
    const first = samples[0];
    for (const sample of samples) {
      expect(sample.labels.map(label => label.text)).toEqual(expected);
      expect(sample.labels.map(({ width, height }) => ({ width, height }))).toEqual(
        first.labels.map(({ width, height }) => ({ width, height })));
      expect(sample.rowHeight).toBe(first.rowHeight);
      expect(sample.heroTop).toBe(first.heroTop);
    }
    await expect(page.locator('body')).toHaveClass(new RegExp(`\\b${theme}-mode\\b`));
  });
}

async function menuState(page: Page) {
  return page.evaluate(() => ({ classes: document.getElementById('navbar')!.className,
    narrow: localStorage.getItem('navVisibleNarrow'), wide: localStorage.getItem('navVisibleWide') }));
}

async function expectHomeMenuState(page: Page, before: Awaited<ReturnType<typeof menuState>>, width: number) {
  if (width >= 1850) expect(await menuState(page)).toEqual(before);
  else {
    await expect(page.locator('#navbar')).toHaveClass(/collapsed/);
    expect((await menuState(page)).narrow).toBe('false');
    expect((await menuState(page)).wide).toBe(before.wide);
    await expect(page.locator('#showMenuButton')).toHaveAttribute('aria-expanded', 'false');
  }
}

for (const width of [1920, 1440, 1000]) for (const theme of ['light', 'dark'] as const) {
  test(`first larger Home and independent bar at ${width}px in ${theme}`, async ({ page, context }, info) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ colorScheme: theme === 'light' ? 'dark' : 'light' });
    const policy = await installHomePolicy(context, theme);
    for (const menuOpen of [false, true]) {
      await openHomeProbeDataset(page, menuOpen);
      await expect(page.locator('body')).toHaveClass(new RegExp(`\\b${theme}-mode\\b`));
      const parts = page.locator('#app_service_catalog_tab_parts_container');
      const hero = parts.locator('.filterbar-inline-hero');
      await expect(hero).toBeVisible();
      await expect(parts).toHaveAttribute('data-shared-topbar-visible', 'false');
      await expect(parts.locator('.dataset-shared-topbar')).toHaveAttribute('aria-hidden', 'true');
      await captureHomeProbe(page, info, `${width}-${theme}-${menuOpen ? 'open' : 'closed'}-hero`);
      if (probePhase === 'before') {
        await hero.evaluate(element => {
          const scroller = element.closest('.scrollable_content')!;
          const spacer = document.createElement('div');
          spacer.dataset.wo37Spacer = 'true'; spacer.style.height = '2000px';
          scroller.append(spacer); scroller.scrollTop = scroller.scrollHeight;
          scroller.dispatchEvent(new Event('scroll'));
        });
        try {
          await expect(parts).toHaveAttribute('data-shared-topbar-visible', 'true');
          await captureHomeProbe(page, info, `${width}-${theme}-${menuOpen ? 'open' : 'closed'}-scrolled`);
        } finally {
          await parts.evaluate(element => {
            const spacer = element.querySelector('[data-wo37-spacer]');
            const scroller = spacer?.closest('.scrollable_content');
            spacer?.remove(); if (scroller) scroller.scrollTop = 0;
            scroller?.dispatchEvent(new Event('scroll'));
          });
        }
        continue;
      }
      const home = hero.getByTestId('top-nav-home-button');
      await expect(home).toBeVisible();
      expect(await home.evaluate(el => el === el.parentElement!.firstElementChild)).toBe(true);
      const dataset = hero.locator('.hero-dataset-tabs__button[data-dataset]:visible').first();
      await expect(dataset).toBeVisible();
      await expect(home).toHaveCSS('height', '44px');
      await expect(home.locator('.navbar-front-page-icon')).toHaveCSS('width', '24px');
      await expect(home.locator('.navbar-front-page-icon')).toHaveCSS('height', '24px');
      const homeBox = (await home.boundingBox())!, datasetBox = (await dataset.boundingBox())!;
      expect(homeBox.x + homeBox.width).toBeLessThanOrEqual(datasetBox.x);
      expect(homeBox.y + homeBox.height / 2).toBeCloseTo(datasetBox.y + datasetBox.height / 2, 1);
      expect(await home.evaluate(element => getComputedStyle(element.parentElement!).flexWrap)).toBe('nowrap');
      await expect(home.locator('[data-symbol-key="home"]')).toHaveCount(1);
      await expect(home).toHaveAttribute('href', await page.locator('#navbarFrontPage a').getAttribute('href') || '/');
      // Move the original node with its keyboard focus, even when the menu is open.
      const node = await home.elementHandle();
      await home.focus();
      await hero.evaluate(element => {
        const scroller = element.closest('.scrollable_content')!;
        const spacer = document.createElement('div');
        spacer.dataset.wo37Spacer = 'true'; spacer.style.height = '2000px';
        scroller.append(spacer); scroller.scrollTop = scroller.scrollHeight;
        scroller.dispatchEvent(new Event('scroll'));
      });
      try {
        await expect(parts).toHaveAttribute('data-shared-topbar-visible', 'true');
        const compact = parts.locator('.dataset-shared-topbar .top-nav-home-button');
        await expect(compact).toBeVisible();
        await expect(compact).toHaveCSS('width', '44px');
        await expect(compact).toHaveCSS('height', '44px');
        await expect(compact).toBeFocused();
        expect(await node!.evaluate(el => el === document.activeElement)).toBe(true);
        await expect(parts.locator('.top-nav-home-button')).toHaveCount(1);
        await captureHomeProbe(page, info, `${width}-${theme}-${menuOpen ? 'open' : 'closed'}-scrolled`);
      } finally {
        await node?.dispose();
        await parts.evaluate(element => {
          const spacer = element.querySelector('[data-wo37-spacer]');
          const scroller = spacer?.closest('.scrollable_content');
          spacer?.remove(); if (scroller) scroller.scrollTop = 0;
          scroller?.dispatchEvent(new Event('scroll'));
        });
      }
      await expect(home).toBeVisible();
      const before = await menuState(page);
      await home.press('Enter');
      await expect(page).toHaveURL(/\/$/);
      await expect(page.locator('#front_page_container')).toHaveAttribute('aria-busy', 'false');
      await expectHomeMenuState(page, before, width);
      await expect(page.locator('#front_page_container .top-nav-home-button')).toHaveAttribute('aria-current', 'page');
      await expect(page.locator('#front_page_container .top-nav-home-button')).toHaveCSS('height', `${homeBox.height}px`);
    }
    policy.enabled = false;
    await openHomeProbeDataset(page, false);
    await expect(page.locator('.top-nav-home-button')).toHaveCount(0);
    await expect(page.locator('#navbarFrontPage a')).toHaveCount(0);
    await page.goto('/');
    await expect(page.locator('.front-page:visible')).toHaveCount(0);
    await expect(page.locator('.front-page-status')).toHaveCount(0);
  });
}

for (const width of [375, 390, 768, 1920]) for (const theme of ['light', 'dark'] as const) {
  test(`${width}px dataset keeps one larger Home in the existing compact bar in ${theme}`, async ({ page, context }, info) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width, height: 844 });
    await page.emulateMedia({ colorScheme: theme === 'light' ? 'dark' : 'light' });
    await installHomePolicy(context, theme);
    for (const menuOpen of [false, true]) {
      await openHomeProbeDataset(page, menuOpen);
      const parts = page.locator('#app_service_catalog_tab_parts_container');
      if (width <= 700) await expect(parts.locator('.filterbar-inline-hero .hero-dataset-tabs')).toBeHidden();
      await expect(parts.locator('.top-nav-home-button')).toHaveCount(1);
      if (width > 700) {
        await parts.locator('.filterbar-inline-hero').evaluate(hero => {
          const scroller = hero.closest('.scrollable_content')!;
          const spacer = document.createElement('div'); spacer.dataset.wo70Spacer = 'true'; spacer.style.height = '2000px';
          scroller.append(spacer); scroller.scrollTop = scroller.scrollHeight; scroller.dispatchEvent(new Event('scroll'));
        });
        // Above 700 px the bar reveals over 260 ms (rows, padding, translateY); measure it settled.
        await expect(parts).toHaveAttribute('data-shared-topbar-visible', 'true');
        await expect.poll(() => parts.locator('.dataset-shared-topbar').evaluate(bar => bar.getAnimations().length)).toBe(0);
      }
      const home = parts.locator('.dataset-shared-topbar .top-nav-home-button');
      await expect(home).toBeVisible();
      await expect(home).toHaveCSS('width', '44px');
      await expect(home).toHaveCSS('height', '44px');
      await expect(home.locator('.navbar-front-page-icon')).toHaveCSS('width', '24px');
      const homeBox = (await home.boundingBox())!;
      const barBox = (await parts.locator('.dataset-shared-topbar__inner').boundingBox())!;
      expect(homeBox.x).toBeGreaterThanOrEqual(0);
      expect(homeBox.x + homeBox.width).toBeLessThanOrEqual(width);
      expect(homeBox.y).toBeGreaterThanOrEqual(barBox.y);
      expect(homeBox.y + homeBox.height).toBeLessThanOrEqual(barBox.y + barBox.height);
      await captureHomeProbe(page, info, `${width}-${theme}-${menuOpen ? 'open' : 'closed'}-compact`);
      await parts.evaluate(element => element.querySelector('[data-wo70-spacer]')?.remove());
    }
  });
}

for (const width of [1440, 1000, 390]) {
  test(`simulated settings save removes cached Home in both tabs at ${width}px`, async ({ page, context }) => {
    test.skip(probePhase === 'before', 'Live policy regression is verified on the fixed version.');
    test.setTimeout(90_000);
    await page.setViewportSize({ width, height: 1000 });
    const policy = await installHomePolicy(context);
    await openHomeProbeDataset(page, false);
    const timeOrigin = await page.evaluate(() => performance.timeOrigin);
    const cached = await page.locator('#app_service_catalog_tab_parts_container').elementHandle();
    const editor = await context.newPage();
    try {
      await openHomeProbeDataset(editor, true, 'card', false);
      await ensureNavbarVisible(editor);
      await expandAdminTreeFolder(editor, 'site_settings');
      await openAdminTreeButton(editor, 'front_page_settings');
      const form = editor.locator('#front_page_settings_container .front-page-settings-view');
      await expect(form.getByTestId('front-page-enabled')).toBeEnabled();
      if (!/collapsed/.test(await editor.locator('#navbar').getAttribute('class') || '')) {
        await editor.locator('#hideMenuButton').click();
      }
      await form.getByTestId('front-page-enabled').uncheck();
      await form.getByTestId('front-page-settings-save').click();
      await expect.poll(() => policy.enabled).toBe(false);
      await expect(form).toHaveAttribute('aria-busy', 'false');
      // The save's real localStorage write emits storage in the other page.
      // Dispatch it in the saving page too, proving both notification paths.
      await editor.evaluate(() => window.dispatchEvent(new StorageEvent('storage', {
        key: 'separate_front_page', newValue: 'false', storageArea: localStorage,
      })));
      for (const tab of [page, editor]) {
        await expect(tab.locator('.top-nav-home-button')).toHaveCount(0);
        await expect(tab.locator('#navbarFrontPage a')).toHaveCount(0);
      }
      expect(await cached!.evaluate(el => el === document.getElementById('app_service_catalog_tab_parts_container'))).toBe(true);
      expect(await page.evaluate(() => performance.timeOrigin)).toBe(timeOrigin);
      await page.goto('/');
      await expect(page.locator('.content_div:visible')).toBeVisible();
      await expect(page.locator('.front-page:visible, .front-page-status')).toHaveCount(0);
    } finally { await cached?.dispose(); await editor.close(); }
  });
}

test('unavailable Home opens normal start without an error; other failures offer retry', async ({ page, context }, info) => {
  test.skip(probePhase === 'before', 'Disabled-response recovery is verified on the fixed version.');
  test.setTimeout(60_000);
  const policy = await installHomePolicy(context);
  await page.setViewportSize({ width: 1440, height: 1000 });
  for (const status of [500, 404]) {
    policy.enabled = true; policy.failure = status === 500 ? 500 : 0;
    await openHomeProbeDataset(page, false);
    const home = page.getByTestId('top-nav-home-button').filter({ visible: true });
    await expect(home).toHaveCount(1);
    if (status === 404) policy.enabled = false; // Stale client, current simulated server off.
    await home.click();
    if (status === 500) {
      await expect(page.locator('.front-page-status button')).toBeVisible();
    } else {
      await expect(page.locator('#app_service_catalog_container')).toBeVisible();
      await expect(page.locator('.top-nav-home-button, #navbarFrontPage a, .front-page-status')).toHaveCount(0);
      expect(await page.evaluate(() => localStorage.getItem('separate_front_page'))).toBe('false');
    }
    await captureHomeProbe(page, info, `response-${status}`);
  }
});

// Retain G12's existing presentation coverage alongside the focused hero proof.
for (const width of [1440, 1000, 375]) for (const theme of ['light', 'dark'] as const) {
  test(`Home policy and menu memory across dataset presentations at ${width}px in ${theme}`, async ({ page, context }, info) => {
    test.setTimeout(150_000);
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ colorScheme: theme === 'light' ? 'dark' : 'light' });
    const policy = await installHomePolicy(context, theme);
    for (const enabled of [true, false]) for (const view of ['card', 'table', 'article_view', 'image_first_view', 'normal', 'transposed']) {
      policy.enabled = enabled;
      for (const menuOpen of [false, true]) {
        await openHomeProbeDataset(page, menuOpen, view);
        await captureHomeProbe(page, info, `${width}-${theme}-${enabled ? 'on' : 'off'}-${view}-${menuOpen ? 'open' : 'closed'}`);
        if (probePhase === 'before') continue;
        const home = page.getByTestId('top-nav-home-button').filter({ visible: true });
        await expect(home).toHaveCount(enabled ? 1 : 0);
        if (!enabled) {
          await expect(page.locator('#navbarFrontPage a')).toHaveCount(0);
          continue;
        }
        await expect(home).toHaveAccessibleName(/\S/);
        expect(await home.getAttribute('href')).toBe(await page.locator('#navbarFrontPage a').getAttribute('href'));
        const before = await menuState(page);
        // Enter creates the same bubbling primary click as a dataset destination.
        await home.focus(); await home.press('Enter');
        await expect(page).toHaveURL(/\/$/);
        await expect(page.locator('#front_page_container')).toHaveAttribute('aria-busy', 'false');
        await expectHomeMenuState(page, before, width);
        await expect(page.getByTestId('top-nav-home-button').filter({ visible: true })).toHaveCount(1);
      }
    }
  });
}
