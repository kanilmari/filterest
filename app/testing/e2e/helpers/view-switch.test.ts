// view-switch.test.ts
// Proves rendered-view detection and selector actions stay inside the resolved dataset.
// Supplies a stale visible dataset before the requested one to expose global DOM picks.
// Covers collapsed sections, direct controls, dropdown portals and optional views.
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { Locator, Page } from '@playwright/test';
import { switchToView } from './view-switch';
import { isVisibleWithin } from './filterbar';

const filterbar = vi.hoisted(() => ({
  open: vi.fn(async () => false), close: vi.fn(), reveal: vi.fn(), layout: vi.fn(async () => {}),
}));
vi.mock('./filterbar', async importOriginal => ({
  ...await importOriginal<typeof import('./filterbar')>(),
  openActiveFilterbarIfCollapsed: filterbar.open,
  closeActiveFilterbarIfOpen: filterbar.close,
  revealActiveFilterbarSection: filterbar.reveal,
  waitForActiveFilterbarLayout: filterbar.layout,
}));
vi.mock('./active-dataset', () => ({
  getActiveDatasetContainer: async (page: Page) => page.locator('#app_service_catalog_tab_parts_container'),
}));
vi.mock('@playwright/test', () => {
  const assertion = (locator: DomLocator) => ({
    not: { toHaveClass: async (pattern: RegExp) => expect(locator.element().className).not.toMatch(pattern) },
  });
  assertion.poll = (operation: () => Promise<unknown>) => ({
    toBe: async (value: unknown) => expect(await operation()).toBe(value),
  });
  return { expect: assertion };
});

function visible(element: HTMLElement) {
  if (!element.isConnected) return false;
  for (let current: HTMLElement | null = element; current; current = current.parentElement) {
    const style = getComputedStyle(current);
    if (current.hidden || style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return false;
  }
  return true;
}
class DomLocator {
  constructor(readonly elements: HTMLElement[]) {}
  element() { if (this.elements.length !== 1) throw new Error('Ambiguous control'); return this.elements[0]; }
  first() { return new DomLocator(this.elements.slice(0, 1)); }
  locator(selector: string) {
    return new DomLocator(this.elements.flatMap(parent => [...parent.querySelectorAll<HTMLElement>(selector.replaceAll(':visible', ''))])
      .filter(element => !selector.includes(':visible') || visible(element)));
  }
  getByTestId(id: string) { return this.locator(`[data-testid="${id}"]`); }
  async isVisible() { return this.elements.length > 0 && visible(this.element()); }
  async waitFor({ state = 'visible', timeout = 30000 }: { state?: 'attached' | 'visible'; timeout?: number } = {}) {
    if (this.elements.length > 1) throw new Error('strict mode violation: locator resolved to multiple elements');
    const element = this.elements[0];
    if (element?.isConnected && (state === 'attached' || visible(element))) return;
    // These fixtures settle synchronously; an unresolved wait represents its timeout.
    const error = new Error(`Timeout ${timeout}ms exceeded waiting for ${state}`);
    error.name = 'TimeoutError';
    throw error;
  }
  async count() { return this.elements.length; }
  async evaluate<T, A>(operation: (element: HTMLElement, argument: A) => T, argument: A) {
    return operation(this.element(), argument);
  }
  async scrollIntoViewIfNeeded() {}
  async click() { this.element().click(); }
}

beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(function () {
    return (visible(this) ? [new DOMRect(0, 0, 100, 100)] : []) as unknown as DOMRectList;
  });
});
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); vi.clearAllMocks(); });

function mount(active = true) {
  document.body.innerHTML = ['subscriptions', 'app_service_catalog'].map(name => `
    <div id="${name}_tab_parts_container" class="tab_parts_container">
      <div class="scrollable_content"></div>
      <div id="${name}_card_view_container" style="display:${name === 'app_service_catalog' && active ? 'block' : 'none'}"></div>
      <section class="dataset-filter-views-section is-collapsed" data-filterbar-section-key="views">
        <button data-testid="view-btn-card"></button>
        <div data-testid="view-dropdown-more"><input data-testid="view-dropdown-more-trigger"></div>
      </section>
    </div>`).join('');
  const root = new DomLocator([document.body]);
  const page = { locator: (selector: string) => root.locator(selector),
    evaluate: async (operation: () => unknown) => operation() } as unknown as Page;
  const requested = document.getElementById('app_service_catalog_tab_parts_container')!;
  const otherClick = vi.fn();
  document.querySelector('#subscriptions_tab_parts_container [data-testid="view-btn-card"]')!.addEventListener('click', otherClick);
  const requestedClick = vi.fn(() => { document.getElementById('app_service_catalog_card_view_container')!.style.display = 'block'; });
  requested.querySelector('[data-testid="view-btn-card"]')!.addEventListener('click', requestedClick);
  filterbar.reveal.mockImplementation(async (_page, _section, container: DomLocator) => {
    container.element().querySelector('section')!.classList.remove('is-collapsed');
  });
  return { page, requested, otherClick, requestedClick };
}

test('already active requested cards need no control from the earlier dataset', async () => {
  const { page, otherClick } = mount();
  await switchToView(page, 'card');
  expect(filterbar.open).not.toHaveBeenCalled();
  expect(otherClick).not.toHaveBeenCalled();
});

test('expands and clicks only the requested dataset section and direct button', async () => {
  const { page, requested, otherClick, requestedClick } = mount(false);
  await switchToView(page, 'card');
  expect(filterbar.layout).toHaveBeenCalledWith(page, expect.objectContaining({ elements: [requested] }), { allowMissingPanel: true });
  expect(filterbar.reveal).toHaveBeenCalledWith(page, 'views', expect.objectContaining({ elements: [requested] }));
  expect(requestedClick).toHaveBeenCalledOnce(); expect(otherClick).not.toHaveBeenCalled();
  expect(document.querySelector('#subscriptions_tab_parts_container section')!.classList.contains('is-collapsed')).toBe(true);
});

test('optional missing controls still return, required ones fail inside the requested dataset', async () => {
  const { page, requested, otherClick } = mount(false);
  requested.querySelector('[data-testid="view-btn-card"]')!.remove();
  await expect(switchToView(page, 'card')).rejects.toThrow('Required direct view control');
  await switchToView(page, 'card', { allowMissing: true });
  expect(otherClick).not.toHaveBeenCalled();
});

test('uses the requested dropdown trigger and its one visible body-portalled menu', async () => {
  const { page, requested } = mount(false);
  document.body.insertAdjacentHTML('beforeend', `
    <div data-testid="view-dropdown-more-list" hidden><button data-testid="view-dropdown-more-option-tree"></button></div>
    <div id="requested-menu" data-testid="view-dropdown-more-list" hidden><button data-testid="view-dropdown-more-option-tree"></button></div>`);
  requested.insertAdjacentHTML('beforeend', '<div id="app_service_catalog_tree_view_container" hidden></div>');
  const wrongTrigger = vi.fn();
  document.querySelector('#subscriptions_tab_parts_container [data-testid="view-dropdown-more-trigger"]')!
    .addEventListener('click', wrongTrigger);
  const menu = document.getElementById('requested-menu')!;
  requested.querySelector('[data-testid="view-dropdown-more-trigger"]')!.addEventListener('click', () => { menu.hidden = false; });
  menu.querySelector('button')!.onclick = () => { document.getElementById('app_service_catalog_tree_view_container')!.hidden = false; };
  await switchToView(page, 'tree');
  expect(wrongTrigger).not.toHaveBeenCalled();
  expect(document.getElementById('app_service_catalog_tree_view_container')!.hidden).toBe(false);
});

test('closes a menu another dataset left open, then uses only the requested menu', async () => {
  const { page, requested } = mount(false);
  document.body.insertAdjacentHTML('beforeend', `
    <div id="stale-menu" data-testid="view-dropdown-more-list"><button data-testid="view-dropdown-more-option-tree"></button></div>
    <div id="requested-menu" data-testid="view-dropdown-more-list" hidden><button data-testid="view-dropdown-more-option-tree"></button></div>`);
  requested.insertAdjacentHTML('beforeend', '<div id="app_service_catalog_tree_view_container" hidden></div>');
  const stale = document.getElementById('stale-menu')!;
  const staleOption = vi.fn();
  stale.querySelector('button')!.addEventListener('click', staleOption);
  // Like VanillaDropdown: a document click outside the open list closes it.
  const outside = (event: Event) => { if (!stale.contains(event.target as Node)) stale.hidden = true; };
  document.addEventListener('click', outside);
  const menu = document.getElementById('requested-menu')!;
  requested.querySelector('[data-testid="view-dropdown-more-trigger"]')!.addEventListener('click', (event) => {
    event.stopPropagation(); menu.hidden = false;
  });
  menu.querySelector('button')!.onclick = () => { document.getElementById('app_service_catalog_tree_view_container')!.hidden = false; };
  try {
    await switchToView(page, 'tree');
    expect(stale.hidden).toBe(true);
    expect(staleOption).not.toHaveBeenCalled();
    expect(document.getElementById('app_service_catalog_tree_view_container')!.hidden).toBe(false);
  } finally {
    document.removeEventListener('click', outside);
  }
});

test.each(['timeout', 'strict mode violation'])('visibility wait returns false on %s rejection', async failure => {
  const { requested } = mount(false);
  const button = requested.querySelector<HTMLElement>('[data-testid="view-btn-card"]')!;
  button.hidden = failure === 'timeout';
  const matches = failure === 'timeout' ? [button] : [...document.querySelectorAll<HTMLElement>('[data-testid="view-btn-card"]')];
  const locator = new DomLocator(matches);
  const waitFor = vi.spyOn(locator, 'waitFor');
  await expect(locator.waitFor({ state: 'visible', timeout: 25 })).rejects.toThrow(
    failure === 'timeout' ? 'Timeout 25ms exceeded' : failure,
  );
  await expect(isVisibleWithin(locator as unknown as Locator, 25)).resolves.toBe(false);
  expect(waitFor).toHaveBeenLastCalledWith({ state: 'visible', timeout: 25 });
});
