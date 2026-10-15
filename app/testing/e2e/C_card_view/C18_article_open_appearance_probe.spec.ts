// C18_article_open_appearance_probe.spec.ts
// Reports native card-to-article CSS writes, longest task and time to a visible frame.
// Connects a registered throwaway dataset to browser-native instrumentation only.
// Runs unchanged on main and WO19; performance numbers are observations, never pass limits.
import { expect, test } from '@playwright/test';
import { login, loadCredentials } from '../helpers/auth';
import { buildTempDatasetName, createTempDataset, cleanupDatasetViaRequest, openTempDataset } from '../helpers/temp-dataset';

type Probe = {
  startedAt: number;
  visibleAt: number;
  setPropertyCalls: number;
  longTaskSupported: boolean;
  tasks: Array<{ startTime: number; duration: number }>;
};
declare global { interface Window { __articleOpenAppearanceProbe: Probe } }

test('WO19 native article-open probe (reports performance without thresholds)', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-card', 'Comparable single desktop measurement.');
  test.setTimeout(180_000);
  const dataset = buildTempDatasetName('e2e_wo19_appearance');
  const articleSelector = '[data-testid="big-card-container"]';
  const openerSelector = `#${dataset}_card_view_container .card [data-testid="card-item-header"], `
    + `#${dataset}_card_view_container .card button[data-lang-key="show_more"]`;
  let created = false;
  await login(page, loadCredentials());
  // Init script survives openTempDataset's navigation. It imports no application code.
  await page.addInitScript(({ openerSelector, articleSelector }) => {
    const probe: Probe = { startedAt: 0, visibleAt: 0, setPropertyCalls: 0,
      longTaskSupported: PerformanceObserver.supportedEntryTypes.includes('longtask'), tasks: [] };
    window.__articleOpenAppearanceProbe = probe;
    const original = CSSStyleDeclaration.prototype.setProperty;
    CSSStyleDeclaration.prototype.setProperty = function (...args) {
      if (probe.startedAt && !probe.visibleAt) probe.setPropertyCalls += 1;
      return original.apply(this, args);
    };
    const recordTasks = (entries: PerformanceEntry[]) => {
      if (probe.startedAt) probe.tasks.push(...entries.map(({ startTime, duration }) => ({ startTime, duration })));
    };
    const observer = probe.longTaskSupported ? new PerformanceObserver(list => recordTasks(list.getEntries())) : null;
    observer?.observe({ type: 'longtask' });
    document.addEventListener('click', event => {
      if (probe.startedAt || !(event.target instanceof Element) || !event.target.closest(openerSelector)) return;
      observer?.takeRecords();
      probe.startedAt = performance.now();
      const waitForArticle = () => {
        const article = document.querySelector<HTMLElement>(articleSelector);
        const rect = article?.getBoundingClientRect();
        if (article && rect && rect.width > 0 && rect.height > 0
          && getComputedStyle(article).visibility !== 'hidden') {
          // The next frame follows a paint opportunity for the visible article.
          requestAnimationFrame(() => {
            probe.visibleAt = performance.now();
            if (observer) { recordTasks(observer.takeRecords()); observer.disconnect(); }
          });
        } else requestAnimationFrame(waitForArticle);
      };
      requestAnimationFrame(waitForArticle);
    }, { capture: true });
  }, { openerSelector, articleSelector });
  try {
    await createTempDataset(page, { datasetName: dataset,
      columns: { id: 'SERIAL', title: 'TEXT', description: 'TEXT' },
      seedRows: Array.from({ length: 60 }, (_, index) => ({
        title: `Ulkoasun mittaus ${index + 1}`, description: `Tilapäinen artikkeli 中文 ${index + 1}`,
      })) });
    created = true;
    await openTempDataset(page, dataset, 'card');
    const firstCard = page.locator(`#${dataset}_card_view_container .card`).first();
    await firstCard.locator('[data-testid="card-item-header"]:visible, button[data-lang-key="show_more"]:visible').first().click();
    await expect(page.locator(articleSelector).first()).toBeVisible({ timeout: 30_000 });
    await page.waitForFunction(() => window.__articleOpenAppearanceProbe.visibleAt > 0, null, { timeout: 30_000 });
    const metrics = await page.evaluate(() => {
      const probe = window.__articleOpenAppearanceProbe;
      // Include the click task: its startTime can precede the capture listener's timestamp.
      const tasks = probe.tasks.filter(task => task.startTime < probe.visibleAt
        && task.startTime + task.duration > probe.startedAt);
      return { setPropertyCalls: probe.setPropertyCalls,
        longestLongTaskMs: probe.longTaskSupported ? Math.max(0, ...tasks.map(task => task.duration)) : null,
        clickToArticleVisibleMs: probe.visibleAt - probe.startedAt, longTaskSupported: probe.longTaskSupported };
    });
    console.log(`WO19 article-open probe: ${JSON.stringify(metrics)}`);
    await testInfo.attach('WO19-article-open-metrics', { body: JSON.stringify(metrics, null, 2), contentType: 'application/json' });
  } finally {
    if (created) await cleanupDatasetViaRequest(page.request, dataset);
  }
});
