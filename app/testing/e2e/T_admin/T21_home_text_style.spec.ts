// T21_home_text_style.spec.ts
// Proves native Serif story typography, timing, motion, language and explicit themes.
// Uses response-only GET fixtures and the signed-in viewer's actual profile identity.
// Never enables Home or saves shared settings; the native Stylist runs this proof.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import * as path from 'node:path';
import { loadCredentials, login } from '../helpers/auth';
import { ensureNavbarVisible } from '../helpers/navbar';
import { resolveFilterestTestRuntimeRoot } from '../helpers/test-runtime-paths';

const copy = {
  fi: {
    title: 'Matkatiedot ja -edut', accent: 'yhdellä silmäyksellä',
    description: [
      '**Fintravel kokoaa yhteen sen, mitä matkaa suunnitteleva tarvitsee:**',
      'ajankohtaisen matkatiedon ja kannattavat tarjoukset.', '',
      'Uudet raide- ja lentoyhteydet, muuttuneet reitit ja käytännön vinkit',
      'löytyvät samasta paikasta, ja jokaisen jutun lähteeseen pääset suoraan linkistä.', '',
      'Tarjouksista näet heti olennaisen: risteilyedut, alennuskoodit, voimassaoloajat',
      'ja suorat varauslinkit. Kun hyvä tilaisuus osuu kohdalle,',
      'ehtoja tai varaussivua ei tarvitse etsiä erikseen.', '',
      'Haku ja suodattimet auttavat löytämään juuri sinua kiinnostavan.',
      'Kortit kertovat pääasiat kuvan, otsikon ja lyhyen kuvauksen avulla,',
      'ja koko juttu avautuu, kun haluat tietää enemmän.', '',
      '**Fintravel aloittaa suomeksi. Myöhemmin samojen matkatietojen ja tarjousten rinnalle**',
      'voidaan lisätä myös englanninkielistä sisältöä.',
    ].join('\n'),
  },
  en: {
    title: 'Travel news and deals', accent: 'at a glance',
    description: [
      '**Fintravel brings together what you need when planning a trip:**',
      'current travel information and deals worth your time.', '',
      'New rail and flight connections, route changes and practical tips',
      'are all in one place, and every story links straight to its source.', '',
      'Deals show what matters right away: cruise offers, discount codes, validity periods',
      'and direct booking links. When a good opportunity comes along,',
      'there is no need to hunt for the terms or the booking page.', '',
      'Search and filters help you find what interests you.',
      'Cards give you the essentials with an image, a title and a short description,',
      'and the full article opens when you want the details.', '',
      '**Fintravel starts out in Finnish. English content may later be added**',
      'to the same travel news and deals.',
    ].join('\n'),
  },
};
const presentation = {
  schema_version: 3, anchor: 'center-center', alignment: 'left', horizontal_margin_px: 40,
  vertical_margin_px: 40, max_width_px: 1120, light_wash: 15, light_opacity: 75, dark_wash: 0, dark_opacity: 20,
  text_style: { preset: 'serif_story_v1', reveal: { mode: 'lines', start_ms: 3000, interval_ms: 800 } },
};
const outputRoot = path.join(resolveFilterestTestRuntimeRoot(), 'wo38a', 'after');

async function fixture(page: Page, language: 'fi' | 'en', theme: 'light' | 'dark',
  { dockMenu = false, slogan = copy[language].accent } = {}) {
  await login(page, loadCredentials());
  const profileResponse = await page.request.get('/api/user-profile');
  expect(profileResponse.ok()).toBe(true);
  const { user_id: viewerID } = await profileResponse.json();
  expect(Number.isInteger(viewerID) && viewerID > 1).toBe(true);
  await page.route(url => url.pathname === '/api/auth-modes', async route => {
    expect(route.request().method()).toBe('GET');
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    await route.fulfill({ response, json: { ...await response.json(), separate_front_page: true,
      display_index_html_at_startup: false } });
  });
  await page.route(url => url.pathname === '/api/front-page', async route => {
    expect(route.request().method()).toBe('GET');
    await route.fulfill({ json: { viewer_id: viewerID, site_name: 'Fintravel', blocks: [], show_blocks: false,
      presentation, presentation_version: 'wo38a-response-only', hero: {
        title: { fi: copy.fi.title, en: copy.en.title }, slogan: { fi: copy.fi.accent, en: copy.en.accent, [language]: slogan },
        description: { fi: copy.fi.description, en: copy.en.description },
      } } });
  });
  await page.route(url => url.pathname === '/api/user-visual-preference', async route => {
    expect(route.request().method()).toBe('GET');
    await route.fulfill({ json: { theme_mode: theme, revision: 1, configured: true } });
  });
  // The spec must fail if a future edit accidentally adds a shared-settings write.
  page.on('request', request => {
    const shared = ['/api/admin/front-page', '/api/row-update', '/api/row-create', '/api/user-visual-preference'];
    if (shared.includes(new URL(request.url()).pathname)) expect(request.method()).toBe('GET');
  });
  await page.emulateMedia({ colorScheme: theme === 'light' ? 'dark' : 'light', reducedMotion: 'no-preference' });
  await page.addInitScript(({ language, theme, dockMenu }) => {
    localStorage.setItem('chosen_language', language); localStorage.setItem('theme', theme);
    localStorage.setItem('navVisibleWide', String(dockMenu)); localStorage.setItem('navVisibleNarrow', 'false');
  }, { language, theme, dockMenu });
}

const linesFor = (page: Page) => page.locator('.front-page-story-line');
// The reveal's own fade animation: a theme switch also starts short colour/shadow transitions on the same line,
// and getAnimations() then lists those first (native diag 17.10.: [0] was a 17-83 ms transition).
async function age(line: Locator) {
  return line.evaluate(element => Number(element.getAnimations()
    .find(animation => (animation as CSSAnimation).animationName === 'home-story-fade')?.currentTime ?? -1));
}
// 20.10. (d258c: clean main fails 3/60 at 390 px, mobile/tablet/desktop) a line's fade is sometimes not listed by
// getAnimations() when read, e.g. a late hero rebuild replaced the lines (WO62). Decide from the line's state instead
// of failing: poll (bounded) until its current fade exists, or the line is already fully shown, which means the
// requested age has passed.
async function waitUntilAge(line: Locator, milliseconds: number) {
  let elapsed = -1;
  await expect.poll(async () => {
    elapsed = await age(line);
    return elapsed >= 0 || await line.evaluate(element => getComputedStyle(element).opacity === '1');
  }, { timeout: 5_000 }).toBe(true);
  if (elapsed >= 0) await line.page().waitForTimeout(Math.max(0, milliseconds - elapsed));
}
async function expectComplete(page: Page) {
  await expect.poll(() => linesFor(page).evaluateAll(lines => lines.every(line => getComputedStyle(line).opacity === '1'))).toBe(true);
}
// End of the reveal (the fixture's 12 lines: 3000 + 11 × 800 + 650 = 12 450 ms after the first line's start; 12 600
// leaves a margin). The first line's fade may be unlisted at this point (see waitUntilAge), so the end wait polls the
// end state instead of trusting that one clock.
async function expectRevealCompletes(page: Page, first: Locator) {
  const elapsed = await age(first);
  if (elapsed >= 0) await page.waitForTimeout(Math.max(0, 12600 - elapsed));
  await expect.poll(() => linesFor(page).evaluateAll(lines => lines.length > 0
    && lines.every(line => getComputedStyle(line).opacity === '1')), { timeout: 15_000 }).toBe(true);
}
async function openHome(page: Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const hero = page.locator('.front-page-hero--serif-story-v1');
  await expect(hero).toBeVisible();
  await expect(linesFor(page)).toHaveCount(12);
  await expect(hero.locator('.front-page-story-line--section-start')).toHaveCount(4);
  await expect(hero.locator('.front-page-story-line--emphasis')).toHaveCount(2);
  return hero;
}

async function expectHeadingFits(hero: Locator) {
  const heading = hero.locator('h1');
  for (const part of [heading, heading.locator('em')]) {
    await expect(part).toHaveCSS('white-space', 'normal');
    await expect(part).toHaveCSS('text-wrap', 'balance');
  }
  const bounds = await heading.evaluate(element => {
    const hero = element.parentElement!;
    const scroller = element.closest('.front-page-scroller')!;
    const scrollerBox = scroller.getBoundingClientRect();
    const range = document.createRange(); range.selectNodeContents(element);
    const rects = [...range.getClientRects()].filter(rect => rect.width > 0);
    const top = Math.min(...rects.map(rect => rect.top));
    const lineHeight = parseFloat(getComputedStyle(element).lineHeight);
    const actual = { left: element.getBoundingClientRect().left,
      right: Math.max(...rects.map(rect => rect.right)),
      rows: new Set(rects.map(rect => Math.round((rect.top - top) / lineHeight))).size,
      availableWidth: hero.getBoundingClientRect().width,
      scrollerLeft: scrollerBox.left, scrollerRight: scrollerBox.right,
      scrollWidth: scroller.scrollWidth, clientWidth: scroller.clientWidth };
    // Measure the actual regular/italic fonts, including spacing, rather than assuming Georgia is installed.
    // A temporary stylesheet keeps the probe out of inline styles; both probe and sheet are always removed.
    const clone = element.cloneNode(true) as HTMLElement;
    clone.classList.add('home-heading-width-probe'); clone.setAttribute('aria-hidden', 'true');
    const sheet = new CSSStyleSheet();
    sheet.insertRule('.home-heading-width-probe, .home-heading-width-probe em { white-space: nowrap !important; }');
    const previous = [...document.adoptedStyleSheets];
    try {
      document.adoptedStyleSheets = [...previous, sheet]; hero.append(clone);
      range.selectNodeContents(clone);
      return { ...actual, singleLineWidth: range.getBoundingClientRect().width };
    } finally {
      clone.remove(); document.adoptedStyleSheets = previous;
    }
  });
  expect(bounds.availableWidth).toBeGreaterThan(0);
  expect(bounds.scrollWidth).toBeLessThanOrEqual(bounds.clientWidth);
  expect(bounds.right).toBeLessThanOrEqual(bounds.scrollerRight);
  if (bounds.singleLineWidth <= bounds.availableWidth) expect(bounds.rows).toBe(1);
  else expect(bounds.rows).toBeGreaterThan(1);
  const storyWidth = await hero.locator('.front-page-description').evaluate(element => element.getBoundingClientRect().width);
  expect(storyWidth).toBeLessThanOrEqual(presentation.max_width_px);
  return bounds;
}

for (const language of ['fi', 'en'] as const) for (const theme of ['light', 'dark'] as const) {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    test(`${language} ${theme} text/reveal at ${viewport.width}px`, async ({ page }, testInfo) => {
      test.setTimeout(90_000);
      await page.setViewportSize(viewport); await fixture(page, language, theme);
      const hero = await openHome(page);
      const first = linesFor(page).first();
      expect(await age(first)).toBeLessThan(3000);
      expect(Number(await first.evaluate(element => getComputedStyle(element).opacity))).toBeLessThan(0.1);
      const initial = (await hero.boundingBox())!;
      const heading = hero.locator('h1');
      await expect(heading).toHaveText(`${copy[language].title} ${copy[language].accent}`);
      await expect(heading).toHaveCSS('font-family', 'Georgia, "Times New Roman", serif');
      await expect(heading).toHaveCSS('font-weight', '400');
      await expect(heading.locator('em')).toHaveCSS('font-style', 'italic');
      await expect(heading.locator('em')).toHaveCSS('color', theme === 'light' ? 'rgb(169, 86, 32)' : 'rgb(239, 174, 85)');
      await expect(linesFor(page).nth(1)).toHaveCSS('font-weight', '570');
      await expect(first).toHaveCSS('font-weight', '700');
      for (const line of [first, linesFor(page).nth(1)]) {
        await expect(line).toHaveCSS('white-space', 'normal');
        await expect(line).toHaveCSS('overflow-wrap', 'break-word');
      }
      await expect(heading).toHaveCSS('text-align', 'left');
      const sizes = await hero.evaluate(element => ({ title: parseFloat(getComputedStyle(element.querySelector('h1')!).fontSize),
        story: parseFloat(getComputedStyle(element.querySelector('.front-page-story-line')!).fontSize) }));
      expect(sizes.title).toBeGreaterThan(sizes.story * 2.5);
      await expect(hero.locator('.front-page-story-line[hidden], .front-page-story-line[aria-hidden], .front-page-story-line[aria-live]')).toHaveCount(0);
      const bounds = await expectHeadingFits(hero);
      if (viewport.width === 390) {
        expect(bounds.right).toBeLessThanOrEqual(bounds.scrollerRight - 15);
        expect(bounds.left).toBeGreaterThanOrEqual(bounds.scrollerLeft + 15);
        expect(bounds.rows).toBeGreaterThan(1);
      }
      await waitUntilAge(first, 3700); await expect(first).toHaveCSS('opacity', '1');
      await expectRevealCompletes(page, first);
      const final = (await hero.boundingBox())!;
      for (const key of ['x', 'y', 'width', 'height'] as const) expect(final[key]).toBeCloseTo(initial[key], 1);
      await expect(page.locator('body')).toHaveClass(new RegExp(`\\b${theme}-mode\\b`));
      await mkdir(outputRoot, { recursive: true });
      await page.screenshot({ path: path.join(outputRoot, `${testInfo.project.name}-${viewport.width}-${language}-${theme}.png`), fullPage: true });
    });
  }
}

test('long slogan at 1920 with the side menu docked', async ({ page }) => {
  test.setTimeout(90_000);
  const slogan = 'Fintravel kokoaa yhteen sen, mitä matkaa suunnitteleva tarvitsee: päivitetyn matkatiedon ja edulliset tarjoukset.';
  await page.setViewportSize({ width: 1920, height: 1080 });
  await fixture(page, 'fi', 'light', { dockMenu: true, slogan });
  const hero = await openHome(page);
  const navbar = page.locator('#navbar');
  await expect(navbar).toBeVisible();
  await expect(navbar).not.toHaveClass(/\bcollapsed\b/);
  await expect.poll(async () => {
    const menu = (await navbar.boundingBox())!;
    const content = (await page.locator('.front-page-scroller--positioned').boundingBox())!;
    return menu.x >= 0 && menu.width > 0 && menu.x + menu.width <= content.x;
  }).toBe(true);
  const heading = hero.locator('h1');
  expect(await heading.textContent()).toBe(copy.fi.title);
  await expect(heading.locator('.front-page-title-accent')).toHaveCount(0);
  const lead = hero.locator('.front-page-story-lead');
  await expect(lead).toHaveCount(1);
  await expect(lead).toHaveText(slogan);
  await expect(lead).toBeVisible();
  await expect(lead).toHaveCSS('font-style', 'italic');
  await expect(lead).toHaveCSS('animation-name', 'none');
  await expect(lead).toHaveCSS('opacity', '1');
  await expect(hero.locator('.front-page-description > :first-child')).toHaveClass('front-page-story-lead');
  const bounds = await hero.evaluate(element => {
    const heading = element.querySelector('h1')!.getBoundingClientRect();
    const lead = element.querySelector('.front-page-story-lead')!;
    const leadBox = lead.getBoundingClientRect();
    const scroller = element.closest('.front-page-scroller')!;
    const scrollerBox = scroller.getBoundingClientRect();
    return { headingBottom: heading.bottom, headingRight: heading.right, leadTop: leadBox.top, leadRight: leadBox.right,
      leadSize: parseFloat(getComputedStyle(lead).fontSize), scrollerRight: scrollerBox.right,
      scrollWidth: scroller.scrollWidth, clientWidth: scroller.clientWidth };
  });
  expect(bounds.leadTop).toBeGreaterThanOrEqual(bounds.headingBottom);
  expect(bounds.leadSize).toBeGreaterThan(0);
  expect(bounds.leadSize).toBeLessThanOrEqual(22);
  expect(bounds.scrollWidth).toBeLessThanOrEqual(bounds.clientWidth);
  expect(bounds.headingRight).toBeLessThanOrEqual(bounds.scrollerRight);
  expect(bounds.leadRight).toBeLessThanOrEqual(bounds.scrollerRight);
  await expectRevealCompletes(page, linesFor(page).first());
});

test('language restarts; theme continues; entering reduced motion completes and leaving keeps all visible', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 }); await fixture(page, 'fi', 'light');
  let hero = await openHome(page);
  const first = linesFor(page).first();
  await waitUntilAge(first, 3700);
  const before = await age(first);
  const sameNode = await first.evaluateHandle(element => element);
  // An explicit application theme switch is local CSS state; account settings stay untouched.
  await page.evaluate(() => {
    document.body.classList.remove('light-mode', 'system-mode'); document.body.classList.add('dark-mode');
  });
  expect(await first.evaluate((element, original) => element === original, sameNode)).toBe(true);
  expect(await age(first)).toBeGreaterThanOrEqual(before);
  await expect(first).toHaveCSS('opacity', '1');
  // The fixture keeps the side menu closed, so its language control sits off-canvas (native job 17.10.): open the
  // menu first and use the control inside it, as M1 does.
  await ensureNavbarVisible(page);
  const languageButton = page.locator('#navbar [data-testid="language-menu-button"]');
  const panelId = await languageButton.getAttribute('aria-controls');
  await languageButton.click();
  await page.locator(`[id="${panelId}"] [data-testid="language-menu-option-en"]`).check();
  await expect(hero).toHaveAttribute('lang', 'en');
  await expect(hero.locator('h1')).toHaveText('Travel news and deals at a glance');
  await expect(linesFor(page).first()).toHaveText('Fintravel brings together what you need when planning a trip:');
  expect(await age(linesFor(page).first())).toBeLessThan(3000);
  expect(Number(await linesFor(page).first().evaluate(element => getComputedStyle(element).opacity))).toBeLessThan(0.1);
  await page.emulateMedia({ reducedMotion: 'reduce' }); await expectComplete(page);
  await expect(hero).toHaveClass(/front-page-hero--reveal-complete/);
  await page.emulateMedia({ reducedMotion: 'no-preference' }); await expectComplete(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  hero = await openHome(page); await expectComplete(page);
  await expect(hero).toHaveClass(/front-page-hero--reveal-complete/);
  await sameNode.dispose();
});
