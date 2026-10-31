// G15_home_boxes.spec.ts
// Proves Home's stacked compact boxes through response-only fixtures.
// Reuses the real Home policy helper, shared thumbnails and native application CSS.
// Keeps owner settings, datasets and language keys untouched in every viewport/theme.
import { expect, test, type Page } from '@playwright/test';
import { installHomePolicy } from '../helpers/home-policy-fixture';
import { datasetAppearanceDefaultsForPlace } from '../../../frontend/shared/dataset_appearance/validator.js';
import presentationDefinition from '../../../frontend/shared/front_page_presentation/definition.json';

const datasets = ['app_e2e_home_info', 'app_e2e_home_deals', 'app_e2e_home_blogs'];
const labels = ['Matkailutietoa', 'Matkatarjoukset', 'Matkakertomukset'];
const presentations = ['contain', 'cover', 'contain_blur'] as const;
const imagePath = '/storage/app_e2e_home_boxes/300/landscape.png';
// An in-memory PNG response: no uploaded or persistent test media.
const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAKAAAABQCAIAAAARP+ljAAAA7ElEQVR4nO3RMRHCAAAEsCphRgQL1lDHXBE46F4Z/8/lLg5y/N7PBo/Pd911vgod8VrBgjfELwULFixYsGDBRQQLFixYsGDBgsfFLwULFixYsGDBRQQLFixYsGDBgsfFLwULFixYsGDBRQQLFixYsGDBgsfFLwULFixYsGDBRQQLFixYsGDBgsfFLwULFixYsGDBRQQLFixYsGDBgsfFLwULFixYsGDBRQQLFixYsGDBgsfFLwULFixYsGDBRQQLFixYsGDBgsfFLwULFixYsGDBRQQLFixYsGDBgsfFLwULFixYsGDBRQT/efANTQNq43U598UAAAAASUVORK5CYII=', 'base64');
const title = 'Suomalaisen matkailijan pitkä otsikko pohjoisen maisemista ja rauhallisista retkikohteista kaikkina vuodenaikoina';
const description = 'Koe pohjoisen maisemat ja kiireettömät retkipolut. Löydä matkavinkit, majoitus ja paikalliset elämykset seuraavaa lomaa varten. '.repeat(3);

async function openHomeBoxes(page: Page, theme: 'light' | 'dark', width: number, anchor = 'center-left') {
  const writes: string[] = [];
  await installHomePolicy(page.context(), theme, {
    site_name: 'WO95', show_blocks: true,
    presentation: { ...presentationDefinition.default, anchor, max_width_px: 750, horizontal_margin_px: 160 },
    hero: { title: { fi: 'Matkailijan etusivu', en: 'Traveller home' } },
    blocks: datasets.map((dataset, index) => ({ dataset, result_limit: 3,
      // The Home facade forwards the same authorized snapshot as get-results;
      // focal coordinates remain per-image companions, just as on full cards.
      dataset_appearance: { schema_version: 2, dataset_uid: 900304 + index, version: '1', shared_version: 'wo95',
        tab_values: datasetAppearanceDefaultsForPlace('tab_only'), site_values: datasetAppearanceDefaultsForPlace('site_only'),
        defaults: datasetAppearanceDefaultsForPlace('site_default'),
        overrides: { 'shared.card_image_presentation': presentations[index] } },
      columns: ['title', 'description'], types: {
        title: { card_element: 'header', show_value_on_card: true, is_multilingual: true },
        description: { card_element: 'description', show_value_on_card: true, is_multilingual: true },
      }, data: [1, 2, 3].map(id => ({ id,
        title: { fi: `${id === 2 ? 'Kuvaton' : 'Suomen'} ${title}`, en: 'Northern travel story' },
        description: { fi: description, en: 'Travel tips and quiet northern scenery.' },
        ...(id === 1 ? { cached_image: imagePath, cached_image_focal_x: 0.2, cached_image_focal_y: 0.3 } : {}),
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

// WO107: each case proves one anchor; the full matrix ran once in proof job d330m. Phones ignore the side.
const HOME_BOX_ANCHORS = {
  1440: { light: 'center-left', dark: 'center-right' },
  1000: { light: 'center-right', dark: 'center-center' },
  390: { light: 'center-left', dark: 'center-right' },
} as const;

for (const width of [1440, 1000, 390] as const) {
  for (const theme of ['light', 'dark'] as const) {
    const anchor = HOME_BOX_ANCHORS[width][theme];
    test(`Home boxes: one column, shared media and row links at ${width}px in ${theme}`, async ({ page }, info) => {
      const writes = await openHomeBoxes(page, theme, width, anchor);
      const blocks = page.locator('.front-page-blocks');
      const groups = blocks.locator(':scope > .supplemental-dataset-group');
      await expect(groups).toHaveCount(3);
      expect(await groups.evaluateAll(elements => elements.map(element => (element as HTMLElement).dataset.dataset))).toEqual(datasets);
      expect(await page.locator('.front-page-top-row .hero-dataset-tabs__button').evaluateAll(
        elements => elements.map(element => (element as HTMLElement).dataset.dataset))).toEqual(datasets);
      await expect(groups.locator('h2')).toHaveText(labels);
      const bar = page.locator(width <= 700 ? '.front-page-phone-topbar' : '.front-page > .front-page-top-row');
      const edge = await bar.evaluate(element => {
        const style = getComputedStyle(element);
        const colour = document.createElement('span'); colour.style.color = 'var(--border_color)'; element.append(colour);
        const expectedColour = getComputedStyle(colour).color; colour.remove();
        return { shadow: style.boxShadow, colour: style.borderBottomColor, width: style.borderBottomWidth, expectedColour };
      });
      if (width > 700) {
        expect(edge.shadow).toContain(edge.expectedColour);
        expect(edge.shadow).toContain('inset'); expect(edge.shadow).toContain('0px -2px 0px 0px');
        const geometry = await bar.evaluate(element => {
          const targets = [element, document.querySelector('.front-page-hero')!, document.querySelector('.front-page-scroller')!];
          const measure = () => targets.map(node => {
            const { x, y, width, height } = node.getBoundingClientRect(); return { x, y, width, height };
          });
          const before = measure(), row = element as HTMLElement;
          row.style.setProperty('box-shadow', 'none', 'important');
          const withoutEdge = measure(); row.style.removeProperty('box-shadow');
          return { before, withoutEdge, restored: measure() };
        });
        expect(geometry.before).toEqual(geometry.withoutEdge); expect(geometry.restored).toEqual(geometry.before);
        expect(edge.width).toBe('0px');
      } else {
        expect(edge.width).toBe('1px'); expect(edge.colour).toBe(edge.expectedColour);
      }
      const boxes = await groups.evaluateAll(elements => elements.map(element => {
        const { x, y, width, height } = element.getBoundingClientRect();
        return { x, y, width, height };
      }));
      for (const [index, box] of boxes.entries()) {
        expect(box.x).toBeCloseTo(boxes[0].x, 1);
        expect(box.width).toBeCloseTo(boxes[0].width, 1);
        if (index) expect(Math.abs(box.y - boxes[index - 1].y - boxes[index - 1].height - 40)).toBeLessThanOrEqual(1);
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
      if (width <= 700 || anchor.endsWith('-center')) {
        expect(layout.centre).toBeCloseTo(layout.parentCentre, 1);
      } else {
        const text = (await page.locator('.front-page-hero').boundingBox())!;
        for (const box of boxes) {
          const boxEdge = anchor.endsWith('-left') ? box.x : box.x + box.width;
          const textEdge = anchor.endsWith('-left') ? text.x : text.x + text.width;
          expect(Math.abs(boxEdge - textEdge)).toBeLessThanOrEqual(1);
          expect(box.width).toBe(768);
        }
      }

      for (let groupIndex = 0; groupIndex < 3; groupIndex++) {
        const group = groups.nth(groupIndex);
        const radius = await group.evaluate(element => {
          const style = getComputedStyle(element);
          return { actual: style.borderRadius, token: style.getPropertyValue('--fw-radius-lg').trim() };
        });
        if (width <= 700) {
          // WO108/K531: on a phone the box is one layer with square corners.
          expect(radius.actual).toBe('0px');
        } else {
          expect(radius.actual).toBe(radius.token); expect(radius.actual).toBe('10px');
        }
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
            const mode = presentations[groupIndex];
            const wrapper = row.locator('.card_photo_presentation');
            await expect(wrapper).toHaveAttribute('data-card-image-presentation', mode);
            await expect(wrapper).toHaveAttribute('data-card-image-source', 'dataset');
            await expect(photo).toHaveCSS('object-fit', mode === 'cover' ? 'cover' : 'contain');
            await expect(photo).toHaveCSS('object-position', mode === 'cover' ? '20% 30%' : '50% 50%');
            expect(await wrapper.evaluate(element => getComputedStyle(element).borderRadius))
              .toBe(await wrapper.evaluate(element => getComputedStyle(element).getPropertyValue('--fw-radius-md').trim()));
            const scrim = await wrapper.evaluate(element => {
              const before = getComputedStyle(element, '::before');
              return { display: before.display, filter: before.filter, inset: before.top,
                source: getComputedStyle(element).getPropertyValue('--card-photo-source').trim() };
            });
            expect(scrim.display).toBe(mode === 'contain_blur' ? 'block' : 'none');
            if (mode === 'contain_blur') {
              expect(scrim.filter).toBe('blur(48px)'); expect(scrim.inset).toBe('-144px');
              expect(scrim.source).toContain(imagePath);
            }
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
      if (width <= 700) {
        // The same 1px phone edge survives scroll and either drawer state; its
        // measured height (used by G13) must not change when the drawer opens.
        const initial = await bar.boundingBox();
        await page.locator('.front-page-scroller').evaluate(element => { element.scrollTop = element.scrollHeight; });
        for (const open of [true, false]) {
          await page.locator(open ? '#showMenuButton' : '#hideMenuButton').evaluate((element: HTMLElement) => element.click());
          await expect(page.locator('#navbar')).toHaveClass(open ? /^(?!.*\bcollapsed\b)/ : /\bcollapsed\b/);
          await expect(bar).toHaveCSS('border-bottom-width', '1px');
          await expect(bar).toHaveCSS('border-bottom-color', edge.expectedColour);
          expect((await bar.boundingBox())!.height).toBe(initial!.height);
          expect(await page.locator('.front-page-scroller').evaluate(element => parseFloat(getComputedStyle(element)
            .getPropertyValue('--home-phone-bar-size')))).toBe(initial!.height);
        }
      }
      expect(writes).toEqual([]);
    });
  }
}

for (const width of [390, 1440]) for (const theme of ['light', 'dark'] as const) {
  for (const layout of ['classic', 'top-left', 'center-left', 'bottom-right']) {
    test(`Home spacing: ${layout}, 40px gaps and bottom clearance at ${width}px in ${theme}`, async ({ page }, info) => {
      const writes = await openHomeBoxes(page, theme, width, layout === 'classic' ? 'center-left' : layout);
      const content = page.locator('.front-page-content');
      if (layout === 'classic') {
        // The printer always selects positioned mode today. Exercise the retained classic CSS contract in the
        // same response-only page, without changing saved presentation, node order or the phone projection.
        await content.evaluate(element => {
          element.classList.remove('front-page-content--positioned');
          element.parentElement!.classList.remove('front-page-scroller--positioned');
          element.querySelector('.front-page-text-stage')!.classList.remove('front-page-text-stage');
        });
      }
      const groups = content.locator('.front-page-blocks > .supplemental-dataset-group');
      await expect(groups).toHaveCount(3);
      await expect.poll(() => content.evaluate(element => {
        const hero = element.querySelector('.front-page-hero')!.getBoundingClientRect();
        const first = element.querySelector('.supplemental-dataset-group')!.getBoundingClientRect();
        return Math.abs(first.top - hero.bottom - 40);
      })).toBeLessThanOrEqual(1);
      const geometry = await content.evaluate(element => {
        const hero = element.querySelector('.front-page-hero')!;
        const heroRect = hero.getBoundingClientRect();
        const stage = hero.parentElement!, stageRect = stage.getBoundingClientRect();
        const stageStyle = getComputedStyle(stage);
        const scroller = element.parentElement!;
        const boxes = [...element.querySelectorAll('.supplemental-dataset-group')].map(box => box.getBoundingClientRect());
        return { textHeight: heroRect.height, viewportHeight: scroller.clientHeight,
          heroY: heroRect.top - stageRect.top, stageHeight: stageRect.height,
          insetTop: parseFloat(stageStyle.paddingTop), insetBottom: parseFloat(stageStyle.paddingBottom),
          alignment: getComputedStyle(hero).textAlign,
          gaps: boxes.slice(1).map((box, index) => box.top - boxes[index].bottom) };
      });
      expect(geometry.textHeight).toBeLessThan(geometry.viewportHeight);
      geometry.gaps.forEach(gap => expect(Math.abs(gap - 40)).toBeLessThanOrEqual(1));
      if (layout !== 'classic') {
        const expectedY = layout.startsWith('top-') ? geometry.insetTop : layout.startsWith('bottom-')
          ? geometry.stageHeight - geometry.insetBottom - geometry.textHeight
          : (geometry.stageHeight - geometry.textHeight) / 2;
        expect(Math.abs(geometry.heroY - expectedY)).toBeLessThanOrEqual(1);
        expect(geometry.alignment).toBe('start');
      }
      await page.screenshot({ path: info.outputPath(`home-spacing-${layout}-${width}-${theme}.png`), animations: 'disabled' });
      // Measure the real scroll end, rather than treating a padding declaration as proof of clearance.
      const bottomSpace = await page.locator('.front-page-scroller').evaluate(element => {
        element.scrollTop = element.scrollHeight;
        const viewport = element.getBoundingClientRect();
        const last = element.querySelector('.front-page-blocks > :last-child')!.getBoundingClientRect();
        // scrollHeight rounds to whole pixels; retain the fractional content end when it lies beyond that rounding.
        const contentEnd = element.querySelector('.front-page-content')!.getBoundingClientRect().bottom;
        return Math.max(viewport.top + element.clientTop + element.clientHeight, contentEnd) - last.bottom;
      });
      expect(bottomSpace).toBeGreaterThanOrEqual(40);
      await page.screenshot({ path: info.outputPath(`home-bottom-${layout}-${width}-${theme}.png`), animations: 'disabled' });
      expect(writes).toEqual([]);
    });
  }
}
