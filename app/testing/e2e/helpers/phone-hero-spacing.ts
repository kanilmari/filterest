// phone-hero-spacing.ts
// Measures the phone dataset hero's actual gaps and tools-box outer margins.
// Shared by the guest topbar and signed-in filter-section browser proofs.
// Keeps geometry assertions independent of translated text height and icon presence.
import { expect, type Page } from '@playwright/test';

export async function measurePhoneHeroSpacing(page: Page, dataset: string) {
  const hero = page.locator(`.filterbar-inline-hero[data-filterbar-inline-hero-for="${dataset}"]`);
  await expect(hero.getByTestId('dataset-filter-section')).toBeVisible();
  return hero.evaluate(hero => {
    const inner = hero.querySelector('.filter-content-inner')!;
    const header = inner.querySelector('.morphing-header')!;
    const title = header.querySelector('.morphing-title')!;
    const slogan = header.querySelector('.morphing-subtitle')!;
    const icon = header.querySelector('.filterbar-hero-dataset-icon');
    const search = inner.querySelector('.dataset-search-panel')!;
    const section = inner.querySelector('.dataset-filter-section')!;
    const rect = (node: Element) => {
      const box = node.getBoundingClientRect();
      return { x: box.x, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height };
    };
    const box = rect(hero), content = rect(inner), heading = rect(header), tools = rect(section);
    const titleBox = rect(title), sloganBox = rect(slogan);
    const style = getComputedStyle(section);
    return { heroInset: content.top - box.top, iconTitleGap: titleBox.top - (icon ? rect(icon).bottom : heading.top),
      titleSloganGap: sloganBox.top - titleBox.bottom, headerToolsGap: tools.top - heading.bottom,
      section: tools, inner: content, search: { ...rect(search), display: getComputedStyle(search).display },
      outerMargins: [style.marginTop, style.marginRight, style.marginBottom, style.marginLeft],
      padding: style.padding, border: style.borderTopWidth };
  });
}

export async function assertPhoneHeroSpacing(page: Page, dataset: string) {
  const sample = await measurePhoneHeroSpacing(page, dataset);
  expect(sample.outerMargins).toEqual(['0px', '0px', '0px', '0px']);
  expect(sample.heroInset).toBeCloseTo(8, 1);
  expect(sample.iconTitleGap).toBeGreaterThanOrEqual(0);
  expect(sample.iconTitleGap).toBeLessThanOrEqual(8.5);
  expect(sample.titleSloganGap).toBeGreaterThanOrEqual(0);
  expect(sample.titleSloganGap).toBeLessThanOrEqual(4.5);
  expect(sample.headerToolsGap).toBeCloseTo(8, 1);
  expect(sample.search.display).toBe('none'); expect(sample.search.height).toBe(0);
  expect(sample.section.x).toBeCloseTo(sample.inner.x, 1);
  expect(sample.section.width).toBeCloseTo(sample.inner.width, 1);
  expect(Number.parseFloat(sample.border)).toBeGreaterThan(0);
  expect(Number.parseFloat(sample.padding)).toBeGreaterThan(0);
  return sample;
}
