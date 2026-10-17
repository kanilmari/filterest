// active-dataset.test.ts
// Reproduces a dataset landing page remaining mounted during a delayed tab transition.
// Exercises the actual navigation predicate with browser-like visibility in jsdom.
// Covers alias addresses, overlapping surfaces, fallback and missing requested tabs.
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { Page } from '@playwright/test';
import { getActiveDatasetContainer } from './active-dataset';
import { navigateToDataset, navigateToDefaultDataset } from './navigation';

function visible(element: HTMLElement): boolean {
  for (let current: HTMLElement | null = element; current; current = current.parentElement) {
    const style = getComputedStyle(current);
    if (current.hidden || style.display === 'none' || style.visibility === 'hidden') return false;
  }
  return true;
}

class DomLocator {
  constructor(readonly elements: HTMLElement[]) {}
  first() { return new DomLocator(this.elements.slice(0, 1)); }
  locator(selector: string) {
    return new DomLocator(this.elements.flatMap(element => [...element.querySelectorAll<HTMLElement>(selector)]));
  }
  async isVisible() { return Boolean(this.elements[0] && visible(this.elements[0])); }
  async evaluate<T, A>(operation: (element: HTMLElement, argument: A) => T, argument: A) {
    return operation(this.elements[0], argument);
  }
  async waitFor() { expect(this.elements[0]?.isConnected).toBe(true); }
}

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(function () {
    return (visible(this) ? [new DOMRect(0, 0, 100, 100)] : []) as unknown as DOMRectList;
  });
});
afterEach(() => { document.body.replaceChildren(); sessionStorage.clear(); vi.restoreAllMocks(); });

function harness(start = 'subscriptions', requested = 'app_service_catalog') {
  document.body.innerHTML = `
    <button data-testid="tab-${requested}" data-id="${requested}"></button>
    <div id="${start}_tab_parts_container" class="tab_parts_container"><div class="scrollable_content"></div></div>
    <div id="${requested}_tab_parts_container" class="tab_parts_container" style="display:none"><div class="scrollable_content"></div></div>`;
  sessionStorage.setItem('selected_dataset', start);
  const incoming = document.getElementById(`${requested}_tab_parts_container`)!;
  const outgoing = document.getElementById(`${start}_tab_parts_container`)!;
  const phases: string[] = [];
  let advance: (() => void) | undefined;
  document.querySelector('button')!.onclick = () => {
    sessionStorage.setItem('selected_dataset', requested);
    advance = () => {
      if (incoming.style.display === 'none') {
        phases.push('both visible'); incoming.style.display = '';
      } else {
        phases.push('requested only'); outgoing.hidden = true; advance = undefined;
      }
    };
  };
  const page = {
    locator: (selector: string) => new DomLocator([...document.querySelectorAll<HTMLElement>(selector)]),
    evaluate: async <T, A>(operation: (argument: A) => T, argument: A) => operation(argument),
    waitForSelector: async () => {},
    waitForFunction: async <T, A>(operation: (argument: A) => T, argument: A) => {
      for (let attempt = 0; attempt < 4; attempt++) {
        const value = operation(argument);
        if (value) return { jsonValue: async () => value, dispose: async () => {} };
        if (!advance) throw new Error('Dataset did not settle');
        advance();
      }
      throw new Error('Dataset did not settle');
    },
  } as unknown as Page;
  return { page, incoming, outgoing, phases };
}

test('navigation cannot return on the start dataset or while both datasets are visible', async () => {
  const { page, phases, outgoing, incoming } = harness();
  // Public URL spelling is deliberately different from the container identity.
  window.history.replaceState(null, '', '/service_catalog?view=card');
  await navigateToDataset(page, 'app_service_catalog');
  expect(phases).toEqual(['both visible', 'requested only']);
  expect(visible(outgoing)).toBe(false);
  expect(visible(incoming)).toBe(true);
  const active = await getActiveDatasetContainer(page) as unknown as DomLocator;
  expect(active.elements[0]).toBe(incoming);
});

test('Home has no outgoing dataset but still waits for the requested surface', async () => {
  const { page, outgoing, phases } = harness();
  outgoing.hidden = true;
  await navigateToDataset(page, 'app_service_catalog');
  expect(phases).toEqual(['both visible']);
});

test('selected identity rejects the sole visible dataset when it is the previous one', async () => {
  const { page } = harness();
  sessionStorage.setItem('selected_dataset', 'app_service_catalog');
  await expect(getActiveDatasetContainer(page)).rejects.toThrow('Dataset did not settle');
});

test.each(['visibility:hidden', 'display:none'])('requested %s cannot count as active', async style => {
  const { page, incoming, outgoing } = harness();
  outgoing.hidden = true; incoming.style.cssText = style;
  await expect(getActiveDatasetContainer(page, 'app_service_catalog')).rejects.toThrow('Dataset did not settle');
});

test('a zero-rect requested surface cannot count as active', async () => {
  const { page, incoming, outgoing } = harness();
  outgoing.hidden = true; incoming.style.display = '';
  vi.spyOn(incoming, 'getClientRects').mockReturnValue([] as unknown as DOMRectList);
  await expect(getActiveDatasetContainer(page, 'app_service_catalog')).rejects.toThrow('Dataset did not settle');
});

test('missing tabs still fail by default and deliberate fallback waits for its actual target', async () => {
  const { page, phases } = harness();
  await expect(navigateToDataset(page, 'missing')).rejects.toThrow('Requested dataset tab "missing" was not available');
  await navigateToDataset(page, 'missing', { allowFallback: true });
  expect(phases).toEqual(['both visible', 'requested only']);
});

test('default navigation also waits for its clicked dataset', async () => {
  const { page, phases } = harness();
  await navigateToDefaultDataset(page);
  expect(phases).toEqual(['both visible', 'requested only']);
});

test('explicit fallback can keep an already selected dataset without a top-level tab', async () => {
  const { page, incoming, outgoing } = harness();
  document.querySelector('button')!.dataset.testid = 'tab-user';
  outgoing.hidden = true; incoming.style.display = '';
  sessionStorage.setItem('selected_dataset', 'app_service_catalog');
  await navigateToDataset(page, 'app_service_catalog', { allowFallback: true });
  expect(visible(incoming)).toBe(true);
});

test('a hidden mounted request does not prevent deliberate fallback to a different available tab', async () => {
  const { page, incoming, outgoing } = harness();
  const button = document.querySelector('button')!;
  button.dataset.testid = 'tab-subscriptions'; button.dataset.id = 'subscriptions';
  button.onclick = () => { sessionStorage.setItem('selected_dataset', 'subscriptions'); };
  await navigateToDataset(page, 'app_service_catalog', { allowFallback: true });
  expect(visible(incoming)).toBe(false);
  expect(visible(outgoing)).toBe(true);
});
