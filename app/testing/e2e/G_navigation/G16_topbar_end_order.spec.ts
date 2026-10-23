// G16_topbar_end_order.spec.ts
// Proves original Home hosts, final panel order, row geometry and real label fitting.
// Compares with main's Home stylesheet after the unchanged fitter has settled.
// GET-only policy/CSS fixtures and owned temporary datasets leave no saved settings.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { login, loadCredentials } from '../helpers/auth';
import { installHomePolicy } from '../helpers/home-policy-fixture';
import { buildTempDatasetName, createTempDataset, cleanupDatasetViaRequest, openTempDataset } from '../helpers/temp-dataset';
import { closeActiveFilterbarIfOpen } from '../helpers/filterbar';

// Production placement, hero CSS and fitter are restored to main. This independent
// source reference also catches future changes to Home's sizing/compact selectors.
const mainHomeCSS = readFileSync(join(__dirname, '../fixtures/wo96_main_home.css'), 'utf8');

async function settleFit(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    window.dispatchEvent(new Event('resize'));
    for (let frame = 0; frame < 3; frame++) await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  });
}

async function geometry(parts: Locator) {
  return parts.evaluate(element => {
    const home = element.querySelector('.top-nav-home-button')!;
    const row = element.querySelector('.filterbar-inline-hero__top-row')!;
    const label = home.querySelector('.navbar-front-page-label')!;
    const size = (node: Element) => {
      const rect = node.getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    };
    return { rowHeight: size(row).height, home: size(home),
      datasetHeights: [...row.querySelectorAll('button[data-dataset]')].map(button => size(button).height),
      compact: home.classList.contains('top-nav-home-button--compact'),
      labelVisible: getComputedStyle(label).display !== 'none' && label.getBoundingClientRect().width > 0 };
  });
}

async function expectMainGeometry(parts: Locator, width: number, compact = width <= 700) {
  const page = parts.page();
  await settleFit(page);
  const actual = await geometry(parts);
  // Loading main's real CSS is a GET route fixture, with no cloned control and
  // no test manipulation of the compact class. The production fitter remeasures.
  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const sheet = document.createElement('link'); sheet.rel = 'stylesheet';
    sheet.id = 'wo96-main-home'; sheet.href = '/__wo96_main_home.css';
    sheet.onload = () => resolve(); sheet.onerror = () => reject(new Error('Main CSS fixture failed'));
    document.head.append(sheet);
  }));
  let main: Awaited<ReturnType<typeof geometry>>;
  try {
    await settleFit(page);
    main = await geometry(parts);
    expect(actual).toEqual(main);
  } finally {
    await page.evaluate(() => document.getElementById('wo96-main-home')?.remove());
    await settleFit(page);
  }
  expect(actual.home.height).toBe(44);
  if (width > 700 && !compact) {
    expect(actual.rowHeight).toBe(44);
    expect(actual.datasetHeights.some(height => height > 0)).toBe(true);
    expect(actual.datasetHeights.filter(height => height > 0).every(height => height === 44)).toBe(true);
  } else if (width <= 700) expect(actual.rowHeight).toBe(0); // Main hides the hero row on phones.
  return { actual, main: main! };
}

async function expectEndPair(parts: Locator, width: number, compact = width <= 700) {
  const surface = parts.locator(compact ? '.dataset-shared-topbar' : '.filterbar-inline-hero');
  const home = surface.locator('.top-nav-home-button:visible');
  const panel = surface.locator('.filterbar-fixed-toggle:visible');
  await expect(home).toHaveCount(1); await expect(panel).toHaveCount(1);
  const homeHost = compact ? width <= 700 ? 'dataset-shared-topbar__slot--start'
    : 'dataset-shared-topbar__slot--end' : 'hero-dataset-tabs';
  await expect.poll(() => home.evaluate((element, host) => element.parentElement!.classList.contains(host), homeHost)).toBe(true);
  expect(await panel.evaluate(element => element === element.parentElement!.lastElementChild)).toBe(true);
  expect(await home.evaluate(element => Boolean(element.compareDocumentPosition(
    element.closest('.tab_parts_container')!.querySelector('.filterbar-fixed-toggle')!) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
  const h = (await home.boundingBox())!, p = (await panel.boundingBox())!;
  expect(h.x + h.width).toBeLessThanOrEqual(p.x);
  const rightEdges = await surface.locator('button:visible, a:visible').evaluateAll(elements =>
    elements.map(element => element.getBoundingClientRect().right));
  expect(Math.max(...rightEdges)).toBeLessThanOrEqual(p.x + p.width + 1);
  expect(p.x + p.width).toBeLessThanOrEqual(parts.page().viewportSize()!.width);
  if (compact) {
    await home.focus(); await home.press('Tab');
    if (width <= 700) {
      await expect(surface.getByTestId('mobile-search-toggle')).toBeFocused();
      await parts.page().keyboard.press('Tab');
    }
    await expect(panel).toBeFocused();
  } else {
    // Home retains its original first position and never overlaps the fitted tabs.
    expect(await home.evaluate(element => element === element.parentElement!.firstElementChild)).toBe(true);
    for (const tab of await surface.locator('.hero-dataset-tabs > button:visible').all()) {
      const t = (await tab.boundingBox())!;
      expect(h.x + h.width).toBeLessThanOrEqual(t.x);
      expect(t.x + t.width).toBeLessThanOrEqual(p.x);
    }
  }
}

const labels = [
  { name: 'translated', value: '' }, { name: 'site name', value: 'Fintravel' },
  { name: 'long site name', value: 'Fintravel kansainvälinen matkailu ja paikalliset kulttuurielämykset '.repeat(8) },
];
for (const width of [1440, 1000, 700, 390]) for (const theme of ['light', 'dark'] as const) for (const label of labels) {
  test(`WO96 original hosts/order/geometry/fitter: ${label.name} at ${width}px/${theme}`, async ({ page, context }, info) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ colorScheme: theme === 'light' ? 'dark' : 'light' });
    const policy = await installHomePolicy(context, theme); policy.label = label.value;
    await context.route('**/__wo96_main_home.css', async route => {
      expect(route.request().method()).toBe('GET');
      await route.fulfill({ contentType: 'text/css', body: mainHomeCSS });
    });
    await context.addInitScript(theme => {
      localStorage.setItem('theme', theme); localStorage.setItem('chosen_language', 'fi');
      localStorage.setItem('navVisibleNarrow', 'false'); localStorage.setItem('navVisibleWide', 'false');
    }, theme);
    await login(page, loadCredentials());
    const dataset = buildTempDatasetName('e2e_wo96_order');
    let created = false;
    try {
      await createTempDataset(page, { datasetName: dataset, columns: { id: 'SERIAL', name: 'TEXT' },
        seedRows: [{ name: 'Matkat / Travel' }] });
      created = true;
      await openTempDataset(page, dataset, 'card');
      const parts = page.locator(`#${dataset}_tab_parts_container`);
      await closeActiveFilterbarIfOpen(page, parts);
      await expect(page.locator('body')).toHaveClass(new RegExp(`(^| )${theme}-mode( |$)`));
      await expect(page.locator('html')).toHaveAttribute('lang', 'fi');
      await expect(parts.locator('.navbar-front-page-label')).toHaveText(label.value || /\S/);
      await info.attach('main-geometry', {
        body: JSON.stringify(await expectMainGeometry(parts, width)), contentType: 'application/json',
      });
      const hero = parts.locator('.filterbar-inline-hero');
      const compact = parts.locator('.dataset-shared-topbar');
      await expectEndPair(parts, width);
      if (width > 700) {
        const tabs = hero.locator('.hero-dataset-tabs');
        const originalStyle = await tabs.getAttribute('style');
        try {
          // Leave room for compact Home and the first dataset; longer labels
          // must compact through the real ResizeObserver/fitter to retain both.
          const first = tabs.locator('button[data-dataset]').first();
          await expect(first).toBeVisible();
          const crowdedWidth = await tabs.evaluate(element => Math.ceil(
            element.querySelector('button[data-dataset]')!.getBoundingClientRect().width
            + 44 + (Number.parseFloat(getComputedStyle(element).columnGap) || 0) + 1));
          await tabs.evaluate((element, width) => { (element as HTMLElement).style.width = `${width}px`; }, crowdedWidth);
          await settleFit(page);
          if (label.name === 'long site name') await expect(parts.locator('.top-nav-home-button')).toHaveClass(/top-nav-home-button--compact/);
          await expect(first).toBeVisible();
          await info.attach('crowded-main-geometry-and-fit', {
            body: JSON.stringify(await expectMainGeometry(parts, width)), contentType: 'application/json',
          });
          await expectEndPair(parts, width);
        } finally {
          await tabs.evaluate((element, style) => { (element as HTMLElement).style.cssText = style || ''; }, originalStyle);
          await settleFit(page);
        }
      }
      await page.screenshot({ path: info.outputPath('dataset-top.png') });
      await hero.evaluate(element => {
        const scroller = element.closest('.scrollable_content')!;
        const spacer = document.createElement('div'); spacer.dataset.wo96Spacer = 'true'; spacer.style.height = '2200px';
        scroller.append(spacer); scroller.scrollTop = scroller.scrollHeight; scroller.dispatchEvent(new Event('scroll'));
      });
      await expect(parts).toHaveAttribute('data-shared-topbar-visible', 'true');
      await expect.poll(() => compact.evaluate(element => element.getAnimations().length)).toBe(0);
      await expectEndPair(parts, width, true);
      await info.attach('compact-main-geometry', {
        body: JSON.stringify(await expectMainGeometry(parts, width, true)), contentType: 'application/json',
      });
      await page.screenshot({ path: info.outputPath('dataset-compact.png') });
      for (const resized of [width === 390 ? 1440 : 390, width]) {
        await page.setViewportSize({ width: resized, height: 900 });
        await settleFit(page); await expectEndPair(parts, resized, true);
      }
      await compact.locator('.top-nav-home-button').click();
      await expect(page.locator('#front_page_container')).toHaveAttribute('aria-busy', 'false');
      await expect(page.locator('#front_page_container .top-nav-home-button')).toHaveAttribute('aria-current', 'page');
      await expect(page.locator('#front_page_container .filterbar-fixed-toggle')).toHaveCount(0);
      await page.screenshot({ path: info.outputPath('home.png') });
      for (const direction of ['back', 'forward', 'back'] as const) {
        if (direction === 'back') await page.goBack(); else await page.goForward();
        if (direction === 'back') {
          await expect(parts).toBeVisible(); await closeActiveFilterbarIfOpen(page, parts); await settleFit(page);
          await expectEndPair(parts, width, (await parts.getAttribute('data-shared-topbar-visible')) === 'true');
        } else await expect(page.locator('#front_page_container')).toBeVisible();
      }
    } finally {
      await page.locator('[data-wo96-spacer]').evaluateAll(elements => elements.forEach(element => element.remove()));
      if (created) await cleanupDatasetViaRequest(page.request, dataset);
    }
  });
}
