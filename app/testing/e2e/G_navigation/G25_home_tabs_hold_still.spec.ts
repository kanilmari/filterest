// G25_home_tabs_hold_still.spec.ts
// Proves Home's top-row dataset buttons never jump sideways for a frame while the side menu opens or closes.
// Connects the menu slot Home shows in one frame (front_page_top_row_builder.js) with the centring offset that
// navigation_fit_controller.js must refit before the browser paints, at the narrowest, a drawer and a docked width.
// Exists because the buttons flicked about 27px and back on every menu toggle while dataset pages did not (owner, 21.11.2026).
import { expect, test, type Page } from '@playwright/test';
import { installHomePolicy } from '../helpers/home-policy-fixture';
import { LAYOUT_BREAKPOINTS } from '../../../frontend/ui_config.js';

// Response-only fixtures: four short destinations like the owner's site, in the owner's dark theme.
const datasets = ['app_e2e_still_info', 'app_e2e_still_offers', 'app_e2e_still_blogs', 'app_e2e_still_about'];
const labels = ['Matkainfo', 'Matkatarjoukset', 'Blogit', 'Tietoa meistä'];
// Narrowest desktop, the menu as a drawer over Home, and the menu docked beside Home.
const widths = [LAYOUT_BREAKPOINTS.tablet + 1, 1440, LAYOUT_BREAKPOINTS.navbarCollapsed + 70];
// A frame counts as a jump when its buttons sit this far from both the frame before and the frame after.
const JUMP_PX = 2;

// A frame without a visible destination has no group centre.
type Sample = { fromCentre: number | null };

async function openHome(page: Page, width: number, { topBarHome = true } = {}) {
  const policy = await installHomePolicy(page.context(), 'dark', { site_name: 'Fintravel', show_blocks: false });
  policy.topBarHome = topBarHome;
  await page.route(url => url.pathname === '/api/datasets', async route => {
    expect(route.request().method()).toBe('GET');
    const response = await route.fetch(); expect(response.ok()).toBe(true);
    await route.fulfill({ response, json: { ...await response.json(),
      tab_order: datasets.map((dataset_name, sort_order) => ({ dataset_name, sort_order })),
      datasets: datasets.map((dataset_name, index) => ({ dataset_name, table_uid: 900673 + index,
        names: [dataset_name], preferred_name: dataset_name, is_top_level_in_current_project: true,
        can_read_rows: true, icon_key: 'table' })),
    } });
  });
  await page.route(url => url.pathname === '/api/translations', async route => {
    expect(route.request().method()).toBe('GET');
    const response = await route.fetch(); expect(response.ok()).toBe(true);
    const data = await response.json();
    Object.assign(data.translations || data, Object.fromEntries(datasets.map((name, index) => [name, labels[index]])));
    await route.fulfill({ response, json: data });
  });
  // Registered last: nothing this test does may write to the target.
  await page.route('**/*', async route => {
    if (route.request().method() === 'GET') return route.fallback();
    await route.abort('blockedbyclient');
  });
  await page.routeWebSocket('**/*', () => {});
  await page.setViewportSize({ width, height: 900 });
  await page.addInitScript(() => {
    localStorage.setItem('theme', 'dark'); localStorage.setItem('chosen_language', 'fi');
    // The menu starts where each width puts it by default: docked open on wide screens, closed below.
    localStorage.removeItem('navVisibleWide'); localStorage.removeItem('navVisibleNarrow');
    // A refit that starts observing an element inside its own resize callback reports a loop error.
    const errors: string[] = [];
    Object.assign(window, { __resizeLoopErrors: errors });
    window.addEventListener('error', event => {
      if (String(event.message).includes('ResizeObserver')) errors.push(String(event.message));
    });
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#front_page_container')).toHaveAttribute('aria-busy', 'false');
  const buttons = page.locator('.front-page > .front-page-top-row .hero-dataset-tabs__button');
  await expect(buttons).toHaveCount(4);
  await expect(buttons.first()).toBeVisible();
  // Let the menu's entrance and font loading settle before recording.
  await expect.poll(() => buttons.first().evaluate(async node => {
    const before = node.getBoundingClientRect().left;
    await new Promise(resolve => setTimeout(resolve, 300));
    return Math.abs(node.getBoundingClientRect().left - before);
  })).toBeLessThan(0.5);
}

/** Toggles the menu with its visible control and records where the buttons were painted in every changed frame. */
async function toggleAndRecord(page: Page): Promise<{ direction: string; samples: Sample[] }> {
  await page.evaluate(() => {
    const row = document.querySelector('.front-page > .front-page-top-row')!;
    const nav = row.querySelector('.hero-dataset-tabs')!;
    const samples: Sample[] = [];
    // The visible group's centre relative to the row's centre; the row itself slides with the menu.
    const sample = () => {
      const box = row.getBoundingClientRect();
      const visible = [...nav.querySelectorAll<HTMLElement>(':scope > :is(a, button):not([hidden])')];
      if (!visible.length) { samples.push({ fromCentre: null }); return; }
      const first = visible[0].getBoundingClientRect();
      const last = visible[visible.length - 1].getBoundingClientRect();
      samples.push({ fromCentre: (first.left + last.right) / 2 - (box.left + box.width / 2) });
    };
    // Created after the application's own observer, so this callback runs after its refit and
    // before the browser paints: each sample is what the person saw in that frame.
    const observer = new ResizeObserver(sample);
    for (const target of [row, nav, ...row.children]) observer.observe(target);
    Object.assign(window, { __stillSamples: samples, __stillSample: sample, __stillObserver: observer });
  });
  const navbar = page.locator('#navbar');
  const opening = await navbar.evaluate(element => element.classList.contains('collapsed'));
  await (opening ? page.locator('.front-page-top-row #showMenuButton') : page.locator('#hideMenuButton')).click();
  await expect.poll(() => navbar.evaluate(element => element.classList.contains('collapsed'))).toBe(!opening);
  // The menu slides for 0.7s; wait until the row has kept its width for a while.
  await expect.poll(() => page.evaluate(async () => {
    const row = document.querySelector('.front-page > .front-page-top-row')!;
    const before = row.getBoundingClientRect().width;
    await new Promise(resolve => setTimeout(resolve, 250));
    return Math.abs(row.getBoundingClientRect().width - before);
  })).toBeLessThan(0.5);
  const samples = await page.evaluate(() => {
    const state = window as unknown as { __stillSamples: Sample[]; __stillSample: () => void; __stillObserver: ResizeObserver };
    state.__stillObserver.disconnect();
    state.__stillSample(); // The settled position closes the sequence.
    return state.__stillSamples;
  });
  return { direction: opening ? 'opening' : 'closing', samples };
}

/** Frames whose buttons stood apart from both neighbouring frames in the same direction: a jump and a return. */
function jumps(samples: Sample[]) {
  const found: string[] = [];
  for (let index = 1; index < samples.length - 1; index++) {
    const [previous, current, next] = [samples[index - 1], samples[index], samples[index + 1]].map(sample => sample.fromCentre);
    if (previous === null || current === null || next === null) continue;
    const before = current - previous;
    const after = current - next;
    if (Math.sign(before) === Math.sign(after) && Math.min(Math.abs(before), Math.abs(after)) > JUMP_PX) {
      found.push(`frame ${index}: ${current.toFixed(1)}px from the row centre between `
        + `${previous.toFixed(1)} and ${next.toFixed(1)}`);
    }
  }
  return found;
}

test.use({ serviceWorkers: 'block' });
for (const width of widths) {
  test(`G25 ${width}px: Home's dataset buttons hold still while the menu opens and closes`, async ({ page }) => {
    await openHome(page, width);
    const first = await toggleAndRecord(page);
    const second = await toggleAndRecord(page);
    for (const { direction, samples } of [first, second]) {
      expect(samples.length, `${direction} the menu changed at least one frame`).toBeGreaterThan(2);
      expect(jumps(samples), `${direction} the menu at ${width}px`).toEqual([]);
    }
    // The steady layout is unchanged: closing and reopening returns the buttons to where they began.
    expect(Math.abs(second.samples.at(-1)!.fromCentre! - first.samples[0].fromCentre!)).toBeLessThan(1);
    expect(await page.evaluate(() => (window as unknown as { __resizeLoopErrors: string[] }).__resizeLoopErrors)).toEqual([]);
  });
}

// Codex review 21.11.2026: without the top-row Home link, a menu toggle can hide the only visible
// destination inside the resize callback. The row's own height then changes in the same frame,
// which the browser reports as a resize-loop error unless the row is observed afresh.
test('G25 1440px without the top-row Home link: the only destination comes and goes without a resize-loop error', async ({ page }) => {
  await openHome(page, 1440, { topBarHome: false });
  const nav = page.locator('.front-page > .front-page-top-row > .hero-dataset-tabs');
  await expect(nav.locator('.top-nav-home-button')).toHaveCount(0);
  const widthOf = () => nav.evaluate(element => element.clientWidth);
  const closedWidth = await widthOf();
  await toggleAndRecord(page);
  const openWidth = await widthOf();
  await toggleAndRecord(page);
  // The open menu's closer leaves Home's 44px menu slot and its 8px gap out of the row.
  expect(openWidth - closedWidth).toBeGreaterThan(40);
  // Lengthen the first destination's label until it fits beside the open menu only.
  await nav.evaluate((element, target) => {
    const button = element.querySelector<HTMLElement>('.hero-dataset-tabs__button')!;
    const label = button.querySelector('.hero-dataset-tabs__label')!;
    const measure = () => {
      const hidden = button.hidden;
      const previous = button.style.cssText;
      button.style.cssText += ';position:absolute;visibility:hidden;display:inline-flex;width:max-content;max-width:none;';
      button.hidden = false;
      const width = button.getBoundingClientRect().width;
      button.hidden = hidden;
      button.style.cssText = previous;
      return width;
    };
    while (measure() < target) label.textContent += 'a';
  }, (closedWidth + openWidth) / 2);
  const first = nav.locator('.hero-dataset-tabs__button').first();
  await expect(first).toBeHidden();
  const opened = await toggleAndRecord(page);
  await expect(first).toBeVisible();
  const closed = await toggleAndRecord(page);
  await expect(first).toBeHidden();
  for (const { direction, samples } of [opened, closed]) {
    expect(jumps(samples), `${direction} the menu`).toEqual([]);
  }
  expect(await page.evaluate(() => (window as unknown as { __resizeLoopErrors: string[] }).__resizeLoopErrors)).toEqual([]);
});
