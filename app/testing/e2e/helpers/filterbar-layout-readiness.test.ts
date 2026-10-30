// filterbar-layout-readiness.test.ts
// Verifies that temporary E2E disclosure reveals follow the saved layout load.
// Runs the helper with real disclosure DOM and a delayed layout promise in jsdom.
// Prevents setup from collapsing the controls immediately after a test reveals them.
import { afterEach, expect, test, vi } from 'vitest';
import type { Locator, Page } from '@playwright/test';
import { createAnimatedDisclosureSection } from '../../../frontend/reusable_components/animated_disclosure/animated_disclosure_builder.js';
import { revealActiveFilterbarSection, waitForActiveFilterbarLayout } from './filterbar';

vi.mock('@playwright/test', () => ({
  expect: (locator: DomLocator) => ({
    toBeAttached: async () => expect(locator.element?.isConnected).toBe(true),
    toBeVisible: async () => expect(locator.element?.hidden).toBe(false),
    toHaveAttribute: async (name: string, value: string) => expect(locator.element?.getAttribute(name)).toBe(value),
  }),
}));

class DomLocator {
  constructor(readonly element: HTMLElement | null) {}
  locator(selector: string) {
    return new DomLocator(this.element?.querySelector<HTMLElement>(selector.replaceAll(':visible', '')) ?? null);
  }
  first() { return this; }
  async count() { return this.element ? 1 : 0; }
  async getAttribute(name: string) { return this.element!.getAttribute(name); }
  async evaluate<T>(operation: (element: HTMLElement) => T) { return operation(this.element!); }
  async scrollIntoViewIfNeeded() {}
}

afterEach(() => { document.body.replaceChildren(); sessionStorage.clear(); vi.restoreAllMocks(); });

test('waits for saved collapse state before revealing style, without persisting the reveal', async () => {
  const parts = document.createElement('div'); parts.className = 'tab_parts_container';
  parts.id = 'demo_tab_parts_container';
  sessionStorage.setItem('selected_dataset', 'demo');
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([new DOMRect(0, 0, 100, 100)] as unknown as DOMRectList);
  const panel = document.createElement('div') as HTMLElement & { __sectionLayoutReady: Promise<void> };
  panel.className = 'filterbar-panel';
  const content = document.createElement('div'); content.innerHTML = '<button>Palette</button>';
  const section = createAnimatedDisclosureSection({ titleText: 'Style', contentElement: content, startOpen: false });
  section.dataset.filterbarSectionKey = 'style';
  panel.append(section); parts.append(panel); document.body.append(parts);
  let finishLayout!: () => void;
  panel.__sectionLayoutReady = new Promise(resolve => { finishLayout = resolve; });
  const waitForShellReady = vi.fn(async (operation: (argument: unknown) => unknown, argument: unknown) => {
    const value = operation(argument);
    expect(value).toBeTruthy();
    return { jsonValue: async () => value, dispose: async () => {} };
  });
  const page = { locator: () => new DomLocator(parts),
    waitForFunction: waitForShellReady,
  } as unknown as Page;
  const persisted = vi.fn();
  section.addEventListener('animated-disclosure-toggle', () => {
    if (section.dataset.filterbarTemporaryDisclosureOperation !== 'true') persisted();
  });
  const reveal = revealActiveFilterbarSection(page, 'style');
  await Promise.resolve(); await Promise.resolve();
  expect(waitForShellReady).toHaveBeenCalled();
  expect(section.classList.contains('is-collapsed')).toBe(true);
  // The delayed response retains the saved collapsed state, then unlocks the helper.
  await section.collapse({ animate: false }); persisted.mockClear(); finishLayout();
  await reveal;
  expect(section.classList.contains('is-expanded')).toBe(true);
  expect(section.querySelector<HTMLElement>('.animated-disclosure-content-shell')!.hidden).toBe(false);
  expect(section.dataset.filterbarTemporaryDisclosureOperation).toBeUndefined();
  expect(persisted).not.toHaveBeenCalled();
  section.destroy();
});

test('an allowed missing panel returns after shell readiness without evaluating a layout', async () => {
  const parts = document.createElement('div'); document.body.append(parts);
  const container = new DomLocator(parts);
  const findPanel = vi.spyOn(container, 'locator');
  const evaluateLayout = vi.spyOn(DomLocator.prototype, 'evaluate');
  const waitForShellReady = vi.fn(async (operation: () => unknown) => {
    expect(findPanel).not.toHaveBeenCalled();
    expect(operation()).toBe(true);
  });
  const page = { waitForFunction: waitForShellReady } as unknown as Page;
  await waitForActiveFilterbarLayout(page, container as unknown as Locator, { allowMissingPanel: true });
  expect(waitForShellReady).toHaveBeenCalledWith(expect.any(Function), null, { timeout: 15000 });
  expect(findPanel).toHaveBeenCalledWith('.filterbar-panel');
  expect(evaluateLayout).not.toHaveBeenCalled();
});
