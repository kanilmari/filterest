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

async function fixture(page: Page, language: 'fi' | 'en', theme: 'light' | 'dark') {
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
        title: { fi: copy.fi.title, en: copy.en.title }, slogan: { fi: copy.fi.accent, en: copy.en.accent },
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
  await page.addInitScript(({ language, theme }) => {
    localStorage.setItem('chosen_language', language); localStorage.setItem('theme', theme);
    localStorage.setItem('navVisibleWide', 'false'); localStorage.setItem('navVisibleNarrow', 'false');
  }, { language, theme });
}

const linesFor = (page: Page) => page.locator('.front-page-story-line');
// The reveal's own fade animation: a theme switch also starts short colour/shadow transitions on the same line,
// and getAnimations() then lists those first (native diag 17.10.: [0] was a 17-83 ms transition).
async function age(line: Locator) {
  return line.evaluate(element => Number(element.getAnimations()
    .find(animation => (animation as CSSAnimation).animationName === 'home-story-fade')?.currentTime ?? -1));
}
async function waitUntilAge(line: Locator, milliseconds: number) {
  const elapsed = await age(line);
  expect(elapsed).toBeGreaterThanOrEqual(0);
  await line.page().waitForTimeout(Math.max(0, milliseconds - elapsed));
}
async function expectComplete(page: Page) {
  await expect.poll(() => linesFor(page).evaluateAll(lines => lines.every(line => getComputedStyle(line).opacity === '1'))).toBe(true);
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
      const bounds = await heading.evaluate(element => {
        const box = element.getBoundingClientRect();
        const scroller = element.closest('.front-page-scroller')!.getBoundingClientRect();
        const range = document.createRange(); range.selectNodeContents(element);
        const rects = [...range.getClientRects()].filter(rect => rect.width > 0);
        return { left: box.left, right: Math.max(box.right, ...rects.map(rect => rect.right)),
          topRows: [...new Set(rects.map(rect => Math.round(rect.top)))].length,
          scrollerLeft: scroller.left, scrollerRight: scroller.right };
      });
      if (viewport.width === 1440) {
        expect(bounds.topRows).toBe(1);
        await expect(heading).toHaveCSS('white-space', 'nowrap');
        await expect(heading.locator('em')).toHaveCSS('white-space', 'nowrap');
        // The right edge with real Georgia is checked by the Stylist's Windows-fonts probe, not by this spec.
      }
      if (viewport.width === 390) {
        expect(bounds.right).toBeLessThanOrEqual(bounds.scrollerRight - 15);
        expect(bounds.left).toBeGreaterThanOrEqual(bounds.scrollerLeft + 15);
        expect(bounds.topRows).toBeGreaterThan(1);
        await expect(heading).toHaveCSS('white-space', 'normal');
        await expect(heading.locator('em')).toHaveCSS('white-space', 'normal');
      }
      await waitUntilAge(first, 3700); await expect(first).toHaveCSS('opacity', '1');
      await waitUntilAge(first, 12600); await expectComplete(page);
      const final = (await hero.boundingBox())!;
      for (const key of ['x', 'y', 'width', 'height'] as const) expect(final[key]).toBeCloseTo(initial[key], 1);
      await expect(page.locator('body')).toHaveClass(new RegExp(`\\b${theme}-mode\\b`));
      await mkdir(outputRoot, { recursive: true });
      await page.screenshot({ path: path.join(outputRoot, `${testInfo.project.name}-${viewport.width}-${language}-${theme}.png`), fullPage: true });
    });
  }
}

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
