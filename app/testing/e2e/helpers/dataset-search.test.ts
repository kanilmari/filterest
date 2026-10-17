// dataset-search.test.ts
// Exercises responsive search selection against DOM hosts and the real phone controller.
// Connects the Playwright helper to hidden duplicates, focus and disclosure lifetime in jsdom.
// Guards tablet selection, person-like activation and loud failure without a filter fallback.
import { afterEach, expect, test, vi } from 'vitest';
import type { Page } from '@playwright/test';
import { createMobileTopbarSearchController } from '../../../frontend/core_components/filterbar/mobile_topbar_search_controller.js';
import { openActiveDatasetSearch } from './dataset-search';

vi.mock('../../../frontend/core_components/state_stores/lang_preference_reader.js', () => ({
  getLanguageWithBrowserFallback: () => 'en',
}));
vi.mock('../../../frontend/core_components/lang/translation_handler.js', () => ({
  getTranslationForKey: (_key: string, options: { fallback: string }) => options.fallback,
}));
vi.mock('@playwright/test', () => {
  const assertLocator = (locator: DomLocator) => ({
    toBeAttached: async () => expect(locator.element().isConnected).toBe(true),
    toBeVisible: async () => expect(await locator.isVisible()).toBe(true),
    toBeEnabled: async () => expect(locator.element().matches(':disabled')).toBe(false),
    toBeEditable: async () => {
      expect(await locator.isVisible()).toBe(true);
      expect(locator.element().matches(':disabled, [readonly]')).toBe(false);
      expect(locator.element().closest('[inert]')).toBeNull();
    },
    toHaveAttribute: async (name: string, value: string) =>
      expect(locator.element().getAttribute(name)).toBe(value),
    toBeFocused: async () => expect(document.activeElement).toBe(locator.element()),
  });
  assertLocator.poll = (operation: () => Promise<boolean>, options: { message: string }) => ({
    toBe: async (value: boolean) => expect(await operation(), options.message).toBe(value),
  });
  return { expect: assertLocator };
});

// jsdom has no layout engine; this harness models ancestor visibility, not pixel geometry.
function isVisible(element: HTMLElement): boolean {
  for (let ancestor: HTMLElement | null = element; ancestor; ancestor = ancestor.parentElement) {
    const style = getComputedStyle(ancestor);
    if (ancestor.hidden || style.display === 'none' || style.visibility === 'hidden') return false;
  }
  return true;
}

const activations: string[] = [];
class DomLocator {
  constructor(private readonly resolve: () => HTMLElement[]) {}
  element(): HTMLElement {
    const element = this.resolve()[0];
    if (!element) throw new Error('No matching search control.');
    return element;
  }
  locator(selector: string): DomLocator {
    return new DomLocator(() => this.resolve().flatMap(parent =>
      [...parent.querySelectorAll<HTMLElement>(selector.replaceAll(':visible', ''))]
        .filter(element => !selector.includes(':visible') || isVisible(element))));
  }
  getByTestId(testId: string) { return this.locator(`[data-testid="${testId}"]`); }
  first() { return new DomLocator(() => this.resolve().slice(0, 1)); }
  async isVisible() { return this.resolve()[0] ? isVisible(this.resolve()[0]) : false; }
  async evaluate<T>(operation: (element: HTMLElement) => T) { return operation(this.element()); }
  async click() { await this.activate('click'); }
  async tap() { await this.activate('tap'); }
  private async activate(method: string) {
    expect(await this.isVisible()).toBe(true);
    activations.push(method);
    this.element().click();
  }
}

let controller: ReturnType<typeof createMobileTopbarSearchController> | undefined;
afterEach(() => {
  controller?.destroy(); controller = undefined;
  document.body.replaceChildren(); activations.length = 0; vi.restoreAllMocks();
  sessionStorage.clear();
});

function mountSearch(width: number, heroVisible = true) {
  document.body.innerHTML = `
    <div class="tab_parts_container" hidden>
      <input data-testid="dataset-search-input" value="inactive dataset">
    </div>
    <div class="tab_parts_container" id="demo_tab_parts_container">
      <div class="dataset-shared-topbar" data-filterbar-shared-topbar-for="demo">
        <div class="dataset-shared-topbar__site-identity">Site</div>
        <div class="dataset-search-panel">
          <input id="shared-input" data-testid="dataset-search-input-search-only" value="draft">
        </div>
        <div class="dataset-shared-topbar__slot--end"></div>
      </div>
      <div id="hero"><input id="hero-input" data-testid="dataset-search-input-content-hero"></div>
      <div class="filterbar-panel">
        <button data-testid="filterbar-toggle">Filters</button>
        <input data-testid="dataset-search-input-filterbar">
      </div>
    </div>`;
  const phone = width <= 700;
  sessionStorage.setItem('selected_dataset', 'demo');
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(function () {
    return (isVisible(this) ? [new DOMRect(0, 0, 100, 100)] : []) as unknown as DOMRectList;
  });
  const bar = document.querySelector<HTMLElement>('.dataset-shared-topbar')!;
  bar.hidden = !phone && heroVisible;
  document.getElementById('hero')!.hidden = phone || !heroVisible;
  const panel = document.querySelector<HTMLElement>('.filterbar-panel')!;
  panel.querySelector<HTMLElement>('input')!.hidden = true;
  Object.assign(panel, { __sectionLayoutReady: Promise.resolve() });
  controller = createMobileTopbarSearchController(bar);
  controller.sync({ phone, active: !bar.hidden });
  const filterClick = vi.fn(); panel.querySelector('button')!.addEventListener('click', filterClick);
  const root = new DomLocator(() => [document.body]);
  const page = {
    locator: (selector: string) => root.locator(selector),
    waitForFunction: async (operation: (argument: unknown) => unknown, argument: unknown) => {
      const value = operation(argument);
      expect(value).toBeTruthy();
      return { jsonValue: async () => value, dispose: async () => {} };
    },
  } as unknown as Page;
  return { page, bar, filterClick };
}

test.each(['click', 'tap'] as const)('phone opens by %s, keeps focus/draft and does not close an open field', async activation => {
  const { page, bar, filterClick } = mountSearch(375);
  const input = await openActiveDatasetSearch(page, activation) as unknown as DomLocator;
  expect(input.element().id).toBe('shared-input');
  expect(document.activeElement).toBe(input.element());
  expect((input.element() as HTMLInputElement).value).toBe('draft');
  expect(bar.querySelector('[data-testid="mobile-search-toggle"]')!.getAttribute('aria-pressed')).toBe('true');
  await openActiveDatasetSearch(page, activation);
  expect(activations).toEqual([activation]);
  input.element().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await openActiveDatasetSearch(page, activation);
  expect(activations).toEqual([activation, activation]);
  expect((input.element() as HTMLInputElement).value).toBe('draft');
  expect(filterClick).not.toHaveBeenCalled();
});

test.each([768, 1440])('at %i px selects visible hero past hidden shared/inactive copies', async width => {
  const { page, filterClick } = mountSearch(width);
  const input = await openActiveDatasetSearch(page) as unknown as DomLocator;
  expect(input.element().id).toBe('hero-input');
  expect(input.element().closest('.tab_parts_container')!.id).toBe('demo_tab_parts_container');
  expect(activations).toEqual([]); expect(filterClick).not.toHaveBeenCalled();
});

test.each([768, 1440])('at %i px uses shared search when the hero is absent', async width => {
  const { page, filterClick } = mountSearch(width, false);
  const input = await openActiveDatasetSearch(page) as unknown as DomLocator;
  expect(input.element().id).toBe('shared-input');
  expect(activations).toEqual([]); expect(filterClick).not.toHaveBeenCalled();
});

test('missing tablet search and button fail instead of skipping or opening filters', async () => {
  const { page, filterClick } = mountSearch(768);
  document.getElementById('hero')!.hidden = true;
  await expect(openActiveDatasetSearch(page)).rejects.toThrow('The active dataset must expose a search field or its search button.');
  expect(activations).toEqual([]); expect(filterClick).not.toHaveBeenCalled();
});

test('a phone button that fails to reveal search still fails the helper', async () => {
  const { page, bar, filterClick } = mountSearch(375);
  controller!.destroy(); controller = undefined;
  const brokenToggle = document.createElement('button');
  brokenToggle.dataset.testid = 'mobile-search-toggle'; brokenToggle.setAttribute('aria-hidden', 'false');
  bar.append(brokenToggle);
  await expect(openActiveDatasetSearch(page)).rejects.toThrow();
  expect(activations).toEqual(['click']); expect(filterClick).not.toHaveBeenCalled();
});
