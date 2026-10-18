// E21_category_heading_order.spec.ts
// Proves manual and frozen result-count heading order on an existing category dataset.
// Connects each visit's first facet response, keyboard disclosure and site revisions.
// Changes only the site preference and restores its original value in finally.
import { expect, test, type Page, type Response } from '@playwright/test';
import { loadCredentials, login } from '../helpers/auth';
import { loadSitePresentationSettings, restoreSitePresentationSettings } from '../helpers/appearance-revisions';
import { fetchCsrfTokenForRequest } from '../helpers/temp-dataset';

const DATASET = process.env.FILTEREST_E2E_CATEGORY_DATASET || '';
const PATH = 'shared.row_group_heading_order';
const PANEL = `#${DATASET}_row_group_facets`;
type Facet = { slug: string; row_count: number; heading?: { id: number; sort_order: number } };
type Heading = { id: number; sort: number; sum: number };

function firstPage(response: Response): boolean {
  const url = new URL(response.url());
  return response.request().method() === 'GET' && url.pathname === '/api/get-results'
    && url.searchParams.get('dataset') === DATASET && Number(url.searchParams.get('offset') || 0) === 0;
}

async function facetsFrom(response: Response): Promise<Facet[]> {
  expect(response.ok(), 'First-page category response succeeds').toBe(true);
  const body = await response.json() as { row_group_facets: Facet[] };
  expect(Array.isArray(body.row_group_facets), 'First-page response supplies its own facets').toBe(true);
  return body.row_group_facets;
}

// Independent expectation: sum the flat response, including the untitled 0/0 heading.
function headings(facets: Facet[]): Heading[] {
  const groups = new Map<number, Heading>();
  for (const facet of facets) {
    const id = facet.heading?.id ?? 0;
    if (!groups.has(id)) groups.set(id, { id, sort: facet.heading?.sort_order ?? 0, sum: 0 });
    groups.get(id)!.sum += facet.row_count;
  }
  return [...groups.values()];
}

function expectedOrder(facets: Facet[], mode: 'manual' | 'result_count'): string[] {
  return headings(facets).sort((a, b) => (mode === 'result_count' ? b.sum - a.sum : 0)
    || a.sort - b.sort || a.id - b.id).map(heading => heading.id ? String(heading.id) : 'legacy');
}

async function ready(page: Page): Promise<void> {
  await expect(page.locator(PANEL)).toBeVisible();
  await expect(page.locator(PANEL)).not.toHaveAttribute('aria-busy', 'true');
}

async function visit(page: Page, reload = false): Promise<Facet[]> {
  // Arm before navigation: only the first offset-zero response establishes this visit's reference.
  const first = page.waitForResponse(firstPage);
  if (reload) await page.reload();
  else await page.goto(`/${DATASET}?view=card`);
  const facets = await facetsFrom(await first);
  await ready(page);
  return facets;
}

async function assertOrder(page: Page, expected: string[]): Promise<void> {
  // Hidden headings still have their real DOM order behind the existing More button.
  await expect.poll(() => page.locator(`${PANEL} .row-group-facet-heading`).evaluateAll(buttons =>
    buttons.map(button => (button as HTMLElement).dataset.headingId))).toEqual(expected);
}

async function saveMode(page: Page, mode: 'manual' | 'result_count'): Promise<void> {
  const csrf = await fetchCsrfTokenForRequest(page.request);
  const latest = await loadSitePresentationSettings(page.request);
  const response = await page.request.post('/api/admin/site-presentation-settings', {
    headers: { 'X-CSRF-Token': csrf },
    data: { schema_version: 2, version: latest.version, set: { [PATH]: mode } },
  });
  expect(response.ok(), await response.text()).toBe(true);
  expect((await response.json()).site_values[PATH]).toBe(mode);
}

async function showMore(page: Page): Promise<void> {
  const more = page.locator(`${PANEL} [data-row-group-focus="more"]`);
  if (await more.isVisible() && await more.getAttribute('aria-expanded') === 'false') {
    await more.focus(); await more.press('Enter');
    await expect(more).toHaveAttribute('aria-expanded', 'true');
    await expect(more).toBeFocused();
  }
}

async function toggle(page: Page, facet: Facet): Promise<Facet[]> {
  await showMore(page);
  const heading = page.locator(`${PANEL} [data-heading-id="${facet.heading?.id ?? 'legacy'}"]`);
  if (await heading.getAttribute('aria-expanded') !== 'true') await heading.press('Enter');
  const popup = page.locator(`#${await heading.getAttribute('aria-controls')}`);
  const option = popup.locator(`[role="option"][data-option-value="${facet.slug}"]`);
  const next = page.waitForResponse(firstPage);
  await option.press('Space');
  const facets = await facetsFrom(await next);
  await ready(page);
  return facets;
}

test('category headings use first-response sums and restore the site preference', async ({ page }, testInfo) => {
  test.setTimeout(300_000);
  test.skip(!/^[a-z][a-z0-9_]{0,62}$/.test(DATASET), 'Set FILTEREST_E2E_CATEGORY_DATASET to an existing categorized dataset.');
  test.skip(testInfo.project.metadata.cardView === 'big', 'This proof uses shared listing controls.');
  await login(page, loadCredentials());
  const original = await loadSitePresentationSettings(page.request);
  expect(['manual', 'result_count']).toContain(original.site_values[PATH]);
  let changed = false;
  try {
    const initial = await visit(page);
    const groups = headings(initial);
    test.skip(groups.length < 2, 'The existing dataset needs at least two returned category headings.');
    test.skip(new Set(groups.map(heading => heading.sum)).size < 2, 'Every returned heading has the same summed count.');

    // Mark before POST so even an interrupted/mismatched save triggers restoration.
    changed = true;
    await saveMode(page, 'manual');
    const manual = await visit(page);
    await assertOrder(page, expectedOrder(manual, 'manual'));

    await saveMode(page, 'result_count');
    const reference = await visit(page);
    const order = expectedOrder(reference, 'result_count');
    await assertOrder(page, order);
    if (order.length >= 4) {
      const buttons = page.locator(`${PANEL} .row-group-facet-heading`);
      await expect(page.locator(`${PANEL} .row-group-facet-heading:visible`)).toHaveCount(3);
      for (let index = 0; index < 3; index += 1) await expect(buttons.nth(index)).toBeVisible();
      await expect(buttons.nth(3)).toBeHidden();
      await showMore(page);
      await expect(buttons.nth(3)).toBeVisible();
    }

    const counts = (facets: Facet[]) => facets.map(facet => [facet.slug, facet.row_count])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    let narrowed: Facet[] | undefined;
    // Prefer a narrow positive value; try the returned vocabulary without editing the catalogue.
    for (const facet of reference.filter(value => value.row_count > 0).sort((a, b) => a.row_count - b.row_count)) {
      const selected = await toggle(page, facet);
      await expect.poll(() => new URL(page.url()).searchParams.get('row_group')).toBe(facet.slug);
      await assertOrder(page, order);
      if (JSON.stringify(counts(selected)) !== JSON.stringify(counts(reference))) { narrowed = selected; break; }
      await toggle(page, facet);
      await assertOrder(page, order);
    }
    expect(narrowed, 'Selecting one existing group must change returned counts to prove frozen ordering.').toBeDefined();
    const reloaded = await visit(page, true);
    await assertOrder(page, expectedOrder(reloaded, 'result_count'));
  } finally {
    if (changed) {
      await restoreSitePresentationSettings(page.request, original, [PATH]);
      expect((await loadSitePresentationSettings(page.request)).site_values[PATH]).toBe(original.site_values[PATH]);
      // This API exposes complete effective values, not stored JSON; the opt-in PostgreSQL test proves omission.
    }
  }
});
