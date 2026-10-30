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
    const titleBox = rect(title), sloganBox = rect(slogan), searchBox = rect(search);
    const style = getComputedStyle(section);
    const searchStyle = getComputedStyle(search);
    return { heroInset: content.top - box.top, iconTitleGap: titleBox.top - (icon ? rect(icon).bottom : heading.top),
      titleSloganGap: sloganBox.top - titleBox.bottom, headerSearchGap: searchBox.top - heading.bottom,
      searchToolsGap: tools.top - searchBox.bottom, searchDirectlyBeforeTools: search.nextElementSibling === section,
      section: tools, inner: content, search: { ...searchBox, display: searchStyle.display,
        controlHeight: searchStyle.getPropertyValue('--dataset-search-control-height').trim(),
        row: rect(search.querySelector('.dataset-search-input-row')!),
        controls: [...search.querySelectorAll('.dataset-search-input, .dataset-search-submit-button')].map(rect),
        outerMargins: [searchStyle.marginTop, searchStyle.marginRight, searchStyle.marginBottom, searchStyle.marginLeft] },
      outerMargins: [style.marginTop, style.marginRight, style.marginBottom, style.marginLeft],
      padding: style.padding, border: style.borderTopWidth, viewportWidth: innerWidth,
      pageWidth: document.documentElement.scrollWidth };
  });
}

export async function assertPhoneHeroSpacing(page: Page, dataset: string) {
  await expect(page.locator(`.filterbar-inline-hero[data-filterbar-inline-hero-for="${dataset}"] .dataset-search-input`)).toBeVisible();
  const sample = await measurePhoneHeroSpacing(page, dataset);
  expect(sample.outerMargins).toEqual(['0px', '-16px', '0px', '-16px']);
  expect(sample.heroInset).toBeCloseTo(8, 1);
  expect(sample.inner.x).toBeCloseTo(16, 1);
  expect(sample.iconTitleGap).toBeGreaterThanOrEqual(0);
  expect(sample.iconTitleGap).toBeLessThanOrEqual(8.5);
  expect(sample.titleSloganGap).toBeGreaterThanOrEqual(0);
  expect(sample.titleSloganGap).toBeLessThanOrEqual(4.5);
  expect(sample.headerSearchGap).toBeCloseTo(8, 1);
  expect(sample.searchToolsGap).toBeCloseTo(8, 1);
  expect(sample.searchDirectlyBeforeTools).toBe(true);
  expect(sample.search.display).toBe('flex');
  expect(sample.search.controlHeight).toBe('44px');
  expect(sample.search.row.height).toBeCloseTo(44, 1);
  expect(sample.search.outerMargins).toEqual(['0px', '0px', '0px', '0px']);
  expect(sample.search.x).toBeCloseTo(sample.inner.x, 1);
  expect(sample.search.width).toBeCloseTo(sample.inner.width, 1);
  for (const control of sample.search.controls) {
    expect(control.width).toBeGreaterThan(0);
    expect(control.x).toBeGreaterThanOrEqual(sample.search.x);
    expect(control.right).toBeLessThanOrEqual(sample.search.right);
  }
  expect(sample.search.x).toBeGreaterThanOrEqual(0);
  expect(sample.search.right).toBeLessThanOrEqual(sample.viewportWidth);
  expect(sample.pageWidth).toBeLessThanOrEqual(sample.viewportWidth);
  expect(sample.section.x).toBeCloseTo(0, 1);
  expect(sample.section.x + sample.section.width).toBeCloseTo(sample.viewportWidth, 1);
  expect(Number.parseFloat(sample.border)).toBeGreaterThan(0);
  expect(Number.parseFloat(sample.padding)).toBeGreaterThan(0);
  return sample;
}
