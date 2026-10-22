// G15_home_boxes.spec.ts
// Proves Home's stacked compact boxes through response-only fixtures.
// Reuses the real Home policy helper, shared thumbnails and native application CSS.
// Keeps owner settings, datasets and language keys untouched in every viewport/theme.
import { expect, test, type Page } from '@playwright/test';
import { installHomePolicy } from '../helpers/home-policy-fixture';

const datasets = ['app_e2e_home_info', 'app_e2e_home_deals', 'app_e2e_home_blogs'];
const labels = ['Matkailutietoa', 'Matkatarjoukset', 'Matkakertomukset'];
const imagePath = '/storage/app_e2e_home_boxes/300/landscape.png';
// An in-memory PNG response: no uploaded or persistent test media.
const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAoUlEQVR4nO3RvQmAMBCG4cxm4RIOYmUjuIVDuYKVY6gQCOa83E+8swp81UHep0hYt8N1oQG/Aec+x7kAqf42DABQB0YD7P+gHyfaAHcdcNfj5E8UQKqrDCkA6nJDBKB1ocEDRF1iMABbZw0KENZpowio6oSBAxX1koEA1XXUgMDHely3DGnBqv6M4oBhFAFsoxAwj2aAR7QIWEUzwCPaANUuQRtBWxLcjQcAAAAASUVORK5CYII=', 'base64');
const title = 'Suomalaisen matkailijan pitkä otsikko pohjoisen maisemista ja rauhallisista retkikohteista kaikkina vuodenaikoina';
const description = 'Koe pohjoisen maisemat ja kiireettömät retkipolut. Löydä matkavinkit, majoitus ja paikalliset elämykset seuraavaa lomaa varten. '.repeat(3);

async function openHomeBoxes(page: Page, theme: 'light' | 'dark', width: number) {
  const writes: string[] = [];
  await installHomePolicy(page.context(), theme, {
    site_name: 'WO85', show_blocks: true,
    hero: { title: { fi: 'Matkailijan etusivu', en: 'Traveller home' } },
    blocks: datasets.map(dataset => ({ dataset, result_limit: 3,
      columns: ['title', 'description'], types: {
        title: { card_element: 'header', show_value_on_card: true, is_multilingual: true },
        description: { card_element: 'description', show_value_on_card: true, is_multilingual: true },
      }, data: [1, 2, 3].map(id => ({ id,
        title: { fi: `${id === 2 ? 'Kuvaton' : 'Suomen'} ${title}`, en: 'Northern travel story' },
        description: { fi: description, en: 'Travel tips and quiet northern scenery.' },
        ...(id === 1 ? { cached_image: imagePath } : {}),
      })),
    })),
  });
  // Register last so a write is rejected before installHomePolicy's simulated save handler.
  await page.context().route(/\/api\/(?:admin\/)?front-page(?:[/?]|$)/, async route => {
    if (route.request().method() === 'GET') return route.fallback();
    writes.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`);
    await route.abort();
  });
  await page.route(url => url.pathname === '/api/datasets', async route => {
    expect(route.request().method()).toBe('GET');
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    const data = await response.json();
    // The saved order's entries are { dataset_name, sort_order } (main_dataset_tabs.js); bare names would be ignored.
    await route.fulfill({ response, json: { ...data,
      tab_order: datasets.map((dataset_name, sort_order) => ({ dataset_name, sort_order })),
      datasets: datasets.map((dataset_name, index) => ({ dataset_name, table_uid: 900304 + index,
        is_top_level_in_current_project: true, can_read_rows: true, icon_key: 'table' })),
    } });
  });
  await page.route(url => url.pathname === '/api/translations', async route => {
    expect(route.request().method()).toBe('GET');
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    const data = await response.json();
    const translations = data.translations && typeof data.translations === 'object' ? data.translations : data;
    datasets.forEach((dataset, index) => { translations[dataset] = labels[index]; });
    await route.fulfill({ response, json: data });
  });
  await page.route(url => url.pathname === imagePath, route => route.fulfill({ contentType: 'image/png', body: image }));
  await page.emulateMedia({ colorScheme: theme === 'light' ? 'dark' : 'light', reducedMotion: 'reduce' });
  await page.setViewportSize({ width, height: 900 });
  await page.addInitScript(({ theme }) => {
    localStorage.setItem('theme', theme);
    localStorage.setItem('chosen_language', 'fi');
    localStorage.setItem('navVisibleWide', 'false');
    localStorage.setItem('navVisibleNarrow', 'false');
  }, { theme });
  await page.goto('/front_page', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#front_page_container')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('body')).toHaveClass(new RegExp(`\\b${theme}-mode\\b`));
  return writes;
}

for (const width of [1440, 1000, 390]) {
  for (const theme of ['light', 'dark'] as const) {
    test(`Home boxes: one column, shared media and row links at ${width}px in ${theme}`, async ({ page }, info) => {
      const writes = await openHomeBoxes(page, theme, width);
      const blocks = page.locator('.front-page-blocks');
      const groups = blocks.locator(':scope > .supplemental-dataset-group');
      await expect(groups).toHaveCount(3);
      expect(await groups.evaluateAll(elements => elements.map(element => (element as HTMLElement).dataset.dataset))).toEqual(datasets);
      expect(await page.locator('.front-page-top-row .hero-dataset-tabs__button').evaluateAll(
        elements => elements.map(element => (element as HTMLElement).dataset.dataset))).toEqual(datasets);
      await expect(groups.locator('h2')).toHaveText(labels);
      const boxes = await groups.evaluateAll(elements => elements.map(element => {
        const { x, y, width, height } = element.getBoundingClientRect();
        return { x, y, width, height };
      }));
      for (const [index, box] of boxes.entries()) {
        expect(box.x).toBeCloseTo(boxes[0].x, 1);
        expect(box.width).toBeCloseTo(boxes[0].width, 1);
        if (index) expect(box.y).toBeGreaterThanOrEqual(boxes[index - 1].y + boxes[index - 1].height);
      }
      const layout = await blocks.evaluate(element => {
        const rect = element.getBoundingClientRect();
        const parent = element.parentElement!.getBoundingClientRect();
        return { width: rect.width, centre: rect.x + rect.width / 2, parentCentre: parent.x + parent.width / 2,
          tracks: getComputedStyle(element).gridTemplateColumns.split(' ').length };
      });
      expect(layout.tracks).toBe(1);
      expect(layout.width).toBeLessThanOrEqual(800);
      if (width >= 1000) expect(layout.width).toBe(800);
      expect(layout.centre).toBeCloseTo(layout.parentCentre, 1);

      for (let groupIndex = 0; groupIndex < 3; groupIndex++) {
        const group = groups.nth(groupIndex);
        const rows = group.locator('li');
        for (let rowIndex = 0; rowIndex < 3; rowIndex++) {
          const row = rows.nth(rowIndex);
          // Centre the row: at the screen's edge the phone's sticky Home bar would be the element hit at its points.
          await row.evaluate(element => element.scrollIntoView({ block: 'center' }));
          await expect(row.locator('.card_small_image_inner')).toBeVisible();
          await expect(row.locator('.supplemental-dataset-thumbnail')).toHaveAttribute('aria-hidden', 'true');
          await expect(row.locator('a[href], button, [tabindex]')).toHaveCount(1);
          const geometry = await row.evaluate(element => {
            const text = element.querySelector('.supplemental-dataset-result-text')!;
            const anchor = text.querySelector('a')!;
            const excerpt = text.querySelector('p')!;
            const titleStyle = getComputedStyle(anchor);
            const excerptRect = excerpt.getBoundingClientRect();
            const linkAt = (x: number, y: number) => document.elementFromPoint(x, y)?.closest('a') === anchor;
            const rect = element.getBoundingClientRect();
            return { height: rect.height, titleHeight: anchor.getBoundingClientRect().height, titleScrollHeight: anchor.scrollHeight,
              titleLineHeight: parseFloat(titleStyle.lineHeight), clamp: titleStyle.webkitLineClamp,
              titleDisplay: titleStyle.display, titleOverflow: titleStyle.overflow,
              excerptHeight: excerptRect.height, excerptLineHeight: parseFloat(getComputedStyle(excerpt).lineHeight),
              excerptVisible: excerptRect.bottom <= text.getBoundingClientRect().bottom + 0.5,
              imageClickable: linkAt(rect.x + 38, rect.y + 38),
              excerptClickable: linkAt(excerptRect.x + 10, excerptRect.y + excerptRect.height / 2) };
          });
          expect(geometry.height).toBe(76);
          expect(geometry.clamp).toBe('1');
          // Chromium computes a -webkit-line-clamp box as flow-root; the height checks below prove the clamp itself.
          expect(['-webkit-box', 'flow-root']).toContain(geometry.titleDisplay);
          expect(geometry.titleOverflow).toBe('hidden');
          expect(geometry.titleHeight).toBeCloseTo(geometry.titleLineHeight, 0);
          expect(geometry.titleScrollHeight).toBeGreaterThan(geometry.titleHeight);
          expect(geometry.excerptHeight).toBeCloseTo(2 * geometry.excerptLineHeight, 0);
          expect(geometry.excerptVisible).toBe(true);
          expect(geometry.imageClickable).toBe(true);
          expect(geometry.excerptClickable).toBe(true);
          if (rowIndex === 0) {
            const photo = row.locator('img');
            await expect(photo).toBeVisible();
            await expect.poll(() => photo.evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true);
          } else {
            await expect(row.locator('.card_small_image_inner')).toContainText(rowIndex === 1 ? 'K' : 'S');
            await expect(row.locator('img')).toHaveCount(0);
          }
          const link = row.locator('.supplemental-dataset-result-text > a');
          if (rowIndex === 0 && groupIndex === 0) await link.focus();
          await expect(link).toBeFocused();
          await page.keyboard.press('Tab');
        }
        const showAll = group.locator('.supplemental-dataset-show-all');
        await expect(showAll).toBeFocused();
        await expect(showAll).toHaveCSS('min-height', '44px');
        expect((await showAll.boundingBox())!.height).toBeGreaterThanOrEqual(44);
        await group.screenshot({ path: info.outputPath(`home-box-${groupIndex + 1}-${width}-${theme}.png`), animations: 'disabled' });
        await page.keyboard.press('Tab');
      }
      expect(writes).toEqual([]);
    });
  }
}
