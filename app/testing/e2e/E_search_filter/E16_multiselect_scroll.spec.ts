// E16_multiselect_scroll.spec.ts
// Proves that plain and rich multiselects have one scrolling option viewport.
// Loads the actual shared library and styles on the native application's page.
// Uses disposable DOM fixtures, all UI languages and opposite OS/application themes.
import { expect, test } from '@playwright/test';

test.use({ storageState: { cookies: [], origins: [] }, hasTouch: true });
const LANGUAGES = ['fi', 'en', 'zh-CN', 'zh-TW', 'zh-HK'];

for (const language of LANGUAGES) for (const theme of ['light', 'dark'] as const) {
  test(`#900: one option scroller, fixed controls (${language}, ${theme})`, async ({ page }, info) => {
    test.skip(info.project.metadata.cardView === 'big', 'The shared popup does not depend on card presentation.');
    await page.emulateMedia({ colorScheme: theme === 'light' ? 'dark' : 'light' });
    await page.addInitScript(({ language, theme }) => {
      localStorage.setItem('chosen_language', language);
      localStorage.setItem('theme', theme);
    }, { language, theme });
    await page.goto('/');
    await expect(page.locator('body')).toHaveClass(new RegExp(`\\b${theme}-mode\\b`));
    for (const rich of [false, true]) {
      const popupID = await page.evaluate(async ({ rich, language }) => {
        const path = '/frontend/reusable_components/multiselect_dropdown/multiselect_dropdown_builder.js';
        const { createMultiselectDropdown } = await import(path);
        const owner = document.createElement('div');
        owner.style.cssText = 'position:fixed;top:70px;left:20px;width:240px;z-index:100005;';
        document.body.append(owner);
        const container = document.createElement('div');
        const trigger = document.createElement('button');
        trigger.textContent = 'Filter'; owner.append(container, trigger);
        const fixed = document.createElement('fieldset');
        fixed.innerHTML = '<legend>Match</legend><label><input type="radio" checked>Any</label><label><input type="radio">All</label>';
        const labels: Record<string, string> = { fi: 'Tarjouksen tyyppi', en: 'Offer type',
          'zh-CN': '优惠类型', 'zh-TW': '優惠類型', 'zh-HK': '優惠類型' };
        const dropdown = createMultiselectDropdown({ containerElement: container,
          options: Array.from({ length: 60 }, (_, index) => ({ value: String(index), label: `${labels[language]} ${index}` })),
          // Match the real category caller: its short heading trigger requests a 360 px popup.
          ...(rich ? { triggerElement: trigger, minPopupWidth: 360,
            popupHeader: { title: labels[language], showCloseButton: true },
            beforeSearchElement: fixed, allowExclude: false } : {}),
        });
        (owner as HTMLElement & { cleanup?: () => void }).cleanup = () => { dropdown.destroy(); owner.remove(); };
        owner.dataset.testid = 'scroll-proof-owner';
        dropdown.open();
        return document.querySelector('.msd-dropdown-list:not([style*="display: none"])')!.id;
      }, { rich, language });
      const popup = page.locator(`#${popupID}`);
      await expect(popup).toBeVisible();
      const options = popup.locator('.msd-dropdown-options');
      const search = popup.locator('.msd-dropdown-search-input');
      await expect(options).toBeVisible();
      expect((await options.boundingBox())!.height).toBeGreaterThan(44);
      const controlsBefore = await popup.evaluate(element => [...element.children]
        .filter(child => !child.classList.contains('msd-dropdown-options'))
        .map(child => ({ top: child.getBoundingClientRect().top, height: child.getBoundingClientRect().height })));
      await options.hover(); await page.mouse.wheel(0, 900);
      await expect.poll(() => options.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
      expect(await popup.evaluate(element => element.scrollTop)).toBe(0);
      expect(await popup.evaluate(element => [...element.children]
        .filter(child => !child.classList.contains('msd-dropdown-options'))
        .map(child => ({ top: child.getBoundingClientRect().top, height: child.getBoundingClientRect().height })))).toEqual(controlsBefore);
      const scrollers = await popup.evaluate(element => [element, ...element.querySelectorAll('*')]
        .filter(child => child.scrollHeight > child.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(child).overflowY))
        .map(child => child.className));
      expect(scrollers).toEqual(['msd-dropdown-options']);
      await expect(search).toBeVisible();
      const box = await popup.boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
      await search.focus(); await search.press('ArrowDown'); await page.keyboard.press('End');
      expect(await options.evaluate(element => {
        const focused = document.activeElement!;
        const frame = element.getBoundingClientRect(), target = focused.getBoundingClientRect();
        return element.contains(focused) && target.top >= frame.top - 1 && target.bottom <= frame.bottom + 1;
      })).toBe(true);
      await page.keyboard.press('Escape'); await expect(popup).toBeHidden();
      await page.getByTestId('scroll-proof-owner').evaluate(element =>
        (element as HTMLElement & { cleanup: () => void }).cleanup());
    }
  });
}
