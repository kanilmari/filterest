// E19_shared_filter_section.spec.ts
// Proves one shaded sort/actions/categories section from its first visible load frame.
// Connects a temporary dataset, an existing category and explicit application themes.
// Keeps shared categories unchanged and removes the dataset and its memberships on failure too.
import { expect, test, type Page } from '@playwright/test';
import { assertPhoneHeroSpacing } from '../helpers/phone-hero-spacing';
import { login, loadCredentials } from '../helpers/auth';
import { buildTempDatasetName, createTempDataset, cleanupDatasetViaRequest,
  fetchCsrfTokenForRequest } from '../helpers/temp-dataset';
import { waitForActiveFilterbarLayout } from '../helpers/filterbar';
import { waitForVisiblePageReady } from '../../../server_tools/lib/browser_view_readiness.mjs';

type Category = { id: number; enabled: boolean; classification_id: number | null };
type Sample = { rect: number[]; rows: number };
type ProbeWindow = Window & { __wo22SectionProbe?: { samples: Sample[]; running: boolean } };

/** Observe from document startup, before waiting for fonts or layout readiness. */
async function installLoadProbe(page: Page, dataset: string) {
  await page.addInitScript(datasetName => {
    const probe = { samples: [] as Sample[], running: true };
    (window as ProbeWindow).__wo22SectionProbe = probe;
    const sample = () => {
      if (!probe.running) return;
      const section = document.getElementById(`${datasetName}_dataset_filter_section`);
      if (section && !section.hidden && section.getClientRects().length) {
        const box = section.getBoundingClientRect();
        probe.samples.push({ rect: [box.x, box.y, box.width, box.height], rows: section.children.length });
      }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }, dataset);
}

/** Compare with the unchanged component rules, outside the new section cascade. */
async function assertUnchangedControlSizes(page: Page, dataset: string) {
  const controls = await page.locator(`#${dataset}_dataset_filter_section`).evaluate(section => {
    const selector = '.filterbar-inline-hero-sort-row .vdw-dropdown-input, '
      + '.filterbar-inline-hero-filter-actions > button, .row-group-facet-heading';
    const originals = [...section.querySelectorAll<HTMLElement>(selector)];
    const reference = section.cloneNode(true) as HTMLElement;
    reference.classList.remove('dataset-filter-section');
    for (const element of [reference, ...reference.querySelectorAll('*')]) {
      element.removeAttribute('id'); element.removeAttribute('data-testid');
    }
    reference.inert = true;
    reference.setAttribute('aria-hidden', 'true');
    reference.style.position = 'fixed';
    reference.style.visibility = 'hidden';
    reference.style.width = `${section.getBoundingClientRect().width}px`;
    const references = [...reference.querySelectorAll<HTMLElement>(selector)];
    // Preserve each responsive width so translated wrapping is compared fairly.
    // The reference keeps the pre-WO22 .fw-btn / filter-toggle / facet rules and
    // vanilla_dropdown.css input sizing; no section selector can match it.
    originals.forEach((control, index) => {
      references[index].style.width = `${control.getBoundingClientRect().width}px`;
    });
    section.parentElement!.append(reference);
    try {
      const measure = (control: HTMLElement) => {
        const style = getComputedStyle(control);
        return { height: control.getBoundingClientRect().height,
          width: control.getBoundingClientRect().width,
          sizing: Object.fromEntries([
            'box-sizing', 'min-height', 'min-width', 'max-height', 'max-width',
            'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
            'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
            'font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing',
          ].map(property => [property, style.getPropertyValue(property)])) };
      };
      return originals.filter(control => control.getClientRects().length).map(control => ({
        name: control.dataset.langKey || control.className,
        actual: measure(control), reference: measure(references[originals.indexOf(control)]),
      }));
    } finally {
      reference.remove();
    }
  });
  // Sort, Filter results, Reset search and at least one category heading.
  expect(controls.length).toBeGreaterThanOrEqual(4);
  for (const { name, actual, reference } of controls) {
    expect(actual.sizing, `${name}: component sizing survives the container`).toEqual(reference.sizing);
    expect(actual.height, `${name}: height matches the unwrapped component`).toBeCloseTo(reference.height, 3);
    const minWidth = Number.parseFloat(reference.sizing['min-width']);
    if (Number.isFinite(minWidth)) expect(actual.width, `${name}: component minimum width`).toBeGreaterThanOrEqual(minWidth);
  }
}

async function assertSection(page: Page, dataset: string, width: number) {
  const section = page.locator(`#${dataset}_dataset_filter_section`);
  await expect(section).toBeVisible();
  await expect(page.locator(`#${dataset}_tab_parts_container .dataset-filter-section`)).toHaveCount(1);
  await expect(section.locator(':scope > *')).toHaveCount(3);
  await expect(section.locator(':scope > .filterbar-inline-hero-sort-row')).toBeVisible();
  await expect(section.locator(':scope > .filterbar-inline-hero-filter-actions')).toBeVisible();
  await expect(section.locator(':scope > [data-testid="row-group-facets"]')).toBeVisible();
  await expect(section.locator('.row-group-facets__guidance')).toHaveCount(0);
  await expect(section.locator('.row-group-facets__title')).toBeVisible();
  const geometry = await section.evaluate(element => {
    const box = element.getBoundingClientRect();
    const rows = [...element.children].map(child => child.getBoundingClientRect());
    const style = getComputedStyle(element);
    const paintedRows = [...element.children].filter(child => {
      const row = getComputedStyle(child);
      return row.backgroundColor !== 'rgba(0, 0, 0, 0)' || Number.parseFloat(row.borderRadius) !== 0
        || Number.parseFloat(row.borderTopWidth) !== 0;
    }).length;
    // Canvas resolves relative theme colours to pixels in the same colour space.
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d')!;
    const brightness = (colour: string) => {
      context.clearRect(0, 0, 1, 1); context.fillStyle = colour; context.fillRect(0, 0, 1, 1);
      const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
      return r + g + b;
    };
    // WO46: the shade is a subtle step below the theme's own surface (--bg_color_2) in BOTH themes; the dark theme's
    // old near-black shade below --bg_color_extreme was the "too dramatic" look the owner removed.
    const surface = brightness(style.getPropertyValue('--bg_color_2'));
    const shade = brightness(style.backgroundColor);
    return { left: box.left, right: box.right, radius: Number.parseFloat(style.borderRadius), paintedRows,
      separateRows: rows[0].bottom < rows[1].top && rows[1].bottom < rows[2].top,
      darker: shade < surface,
      outside: !element.querySelector('.active_filters, .results_count'),
      order: element.querySelector('.filterbar-inline-hero-sort-row') === element.children[0]
        && element.querySelector('.filterbar-inline-hero-filter-actions') === element.children[1]
        && element.querySelector('.row-group-facets') === element.children[2] };
  });
  expect(geometry).toMatchObject({ paintedRows: 0, separateRows: true, darker: true, outside: true, order: true });
  if (width <= 700) {
    // K531: the phone tools box is edge to edge with square corners (morphing_filterbar_content.css ≤ 700 section).
    expect(geometry.radius).toBe(0);
  } else {
    expect(geometry.radius).toBeGreaterThan(0);
  }
  expect(geometry.left).toBeGreaterThanOrEqual(0);
  expect(geometry.right).toBeLessThanOrEqual(width);
  const actions = section.locator('.filterbar-inline-hero-filter-actions');
  await expect(actions.locator(':scope > button').nth(0)).toHaveAttribute('data-lang-key', 'filterbar_filter_results');
  await expect(actions.locator(':scope > button').nth(1)).toHaveAttribute('data-lang-key', 'reset_search');
  // Native keyboard traversal follows the same action order after the wrapper change.
  await actions.locator('button').first().focus();
  await page.keyboard.press('Tab');
  await expect(actions.locator('button').nth(1)).toBeFocused();
  await assertUnchangedControlSizes(page, dataset);
  if (width <= 700) await test.info().attach('phone hero gaps', {
    body: JSON.stringify(await assertPhoneHeroSpacing(page, dataset), null, 2), contentType: 'application/json',
  });
}

test('hero search and shared filter section stay stable at desktop/320–700 px in both themes and languages', async ({ page }) => {
  test.setTimeout(300_000);
  await login(page, loadCredentials());
  const dataset = buildTempDatasetName('e2e_wo22_section');
  let created = false;
  try {
    // Reuse a readable category: global category creation has no matching delete API.
    const catalogueResponse = await page.request.get('/api/admin/row-groups');
    expect(catalogueResponse.ok(), await catalogueResponse.text()).toBe(true);
    const catalogue = await catalogueResponse.json() as { groups: Category[]; classifications: Category[] };
    const group = catalogue.groups.find(item => item.enabled && (item.classification_id === null
      || catalogue.classifications.some(heading => heading.id === item.classification_id && heading.enabled)));
    expect(group, 'Native fixture needs one enabled category; no shared names are created or edited.').toBeTruthy();
    await createTempDataset(page, { datasetName: dataset,
      columns: { id: 'SERIAL', name: 'TEXT' }, seedRows: [{ name: 'WO22 section / osio' }] });
    created = true;
    const rowResponse = await page.request.get(`/api/get-results?dataset=${dataset}&view_key=table`);
    expect(rowResponse.ok(), await rowResponse.text()).toBe(true);
    const rows = (await rowResponse.json()).data as Array<{ id: number }>;
    expect(rows).toHaveLength(1);
    const membership = await page.request.post('/api/admin/row-group-memberships', {
      data: { dataset, group_id: group!.id, row_ids: [rows[0].id] },
      headers: { 'X-CSRF-Token': await fetchCsrfTokenForRequest(page.request) },
    });
    expect(membership.ok(), await membership.text()).toBe(true);
    await installLoadProbe(page, dataset);
    for (const width of [1440, 320, 375, 390, 700]) for (const theme of ['light', 'dark'] as const) for (const language of ['fi', 'en']) {
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ colorScheme: theme === 'light' ? 'dark' : 'light' });
      await page.evaluate(({ theme, language }) => {
        localStorage.setItem('theme', theme); localStorage.setItem('chosen_language', language);
      }, { theme, language });
      await page.goto(`/${dataset}?view=card`, { waitUntil: 'domcontentloaded' });
      await expect(page.locator('body')).toHaveClass(new RegExp(`\\b${theme}-mode\\b`));
      await waitForActiveFilterbarLayout(page);
      await waitForVisiblePageReady(page);
      await expect(page.locator(`#${dataset}_row_group_facets`)).toBeVisible();
      await page.evaluate(() => new Promise<void>(resolve => {
        let remaining = 8;
        const frame = () => --remaining ? requestAnimationFrame(frame) : resolve();
        requestAnimationFrame(frame);
      }));
      const samples = await page.evaluate(() => {
        const probe = (window as ProbeWindow).__wo22SectionProbe!;
        probe.running = false;
        return probe.samples;
      });
      expect(samples.length).toBeGreaterThan(2);
      expect(samples.every(sample => sample.rows === 3), 'Every visible load frame contains all three rows.').toBe(true);
      for (const sample of samples) sample.rect.forEach((value, index) => {
        expect(Math.abs(value - samples[0].rect[index]), 'Section geometry stays fixed from its first visible frame.').toBeLessThanOrEqual(1);
      });
      await assertSection(page, dataset, width);
    }
  } finally {
    // Dataset deletion also removes precisely its category memberships.
    if (created) await cleanupDatasetViaRequest(page.request, dataset);
  }
});
