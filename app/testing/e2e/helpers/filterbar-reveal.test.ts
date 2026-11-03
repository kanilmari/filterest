// filterbar-reveal.test.ts
// Pins temporary section reveals across filterbar replacement without browser startup.
// Uses snapshot DOM locators and the real disclosure to exercise detachment and saved-layout isolation.
// Keeps retries bounded while preserving the final expanded and visible assertions.
import { afterEach, expect, test, vi } from 'vitest';
import type { Locator, Page } from '@playwright/test';
import { createAnimatedDisclosureSection } from '../../../frontend/reusable_components/animated_disclosure/animated_disclosure_builder.js';
import { revealActiveFilterbarSection } from './filterbar';

const assertions = vi.hoisted(() => ({ visible: vi.fn(), attribute: vi.fn() }));
vi.mock('@playwright/test', () => ({
  expect: (locator: DomLocator) => ({
    toBeAttached: async () => expect(locator.element?.isConnected).toBe(true),
    toBeVisible: async (options: { timeout: number }) => {
      assertions.visible(locator, options);
      expect(locator.element?.isConnected).toBe(true);
      expect(locator.element?.hidden).toBe(false);
    },
    toHaveAttribute: async (name: string, value: string, options: { timeout: number }) => {
      assertions.attribute(locator, name, value, options);
      expect(locator.element?.getAttribute(name)).toBe(value);
    },
  }),
}));

class DomLocator {
  constructor(readonly element: HTMLElement | null) {}
  locator(selector: string) { return new DomLocator(this.element?.querySelector<HTMLElement>(selector) ?? null); }
  first() { return this; }
  async count() { return this.element ? 1 : 0; }
  async getAttribute(name: string) { return this.element!.getAttribute(name); }
  async scrollIntoViewIfNeeded(_options?: { timeout: number }) {}
  async evaluate<T>(operation: (element: HTMLElement) => T, _argument?: unknown, _options?: { timeout: number }) {
    return operation(this.element!);
  }
}

const cleanups: Array<() => void> = [];

function fixture() {
  const parts = document.createElement('div');
  const panel = document.createElement('div') as HTMLElement & { __sectionLayoutReady: Promise<void> };
  panel.className = 'filterbar-panel'; panel.__sectionLayoutReady = Promise.resolve();
  parts.append(panel); document.body.append(parts);
  const persisted = vi.fn();
  const sections: ReturnType<typeof createAnimatedDisclosureSection>[] = [];
  cleanups.push(() => sections.forEach(section => section.destroy()));
  const addSection = () => {
    const section = createAnimatedDisclosureSection({ titleText: 'Tools', contentElement: document.createElement('button'), startOpen: false });
    section.dataset.filterbarSectionKey = 'tools';
    section.addEventListener('animated-disclosure-toggle', () => {
      if (section.dataset.filterbarTemporaryDisclosureOperation !== 'true') persisted();
    });
    sections.push(section);
    return section;
  };
  const original = addSection(); panel.append(original);
  const replace = () => { const section = addSection(); panel.replaceChildren(section); return section; };
  const container = new DomLocator(parts);
  const lookup = vi.spyOn(container, 'locator');
  const lookups = () => lookup.mock.results.filter((_result, index) => lookup.mock.calls[index][0].includes('data-filterbar-section-key'));
  const page = { waitForFunction: async (operation: () => unknown) => expect(operation()).toBe(true) } as unknown as Page;
  const reveal = () => revealActiveFilterbarSection(page, 'tools', container as unknown as Locator);
  return { original, sections, replace, persisted, lookups, reveal };
}

afterEach(() => {
  cleanups.splice(0).forEach(cleanup => cleanup());
  document.body.replaceChildren(); vi.restoreAllMocks(); vi.resetAllMocks();
});

test.each(['Element is not attached', 'element is not attached to the DOM'])(
  're-resolves after one scroll failure: %s', async message => {
    const proof = fixture();
    const error = new Error(message);
    const scroll = vi.spyOn(DomLocator.prototype, 'scrollIntoViewIfNeeded').mockImplementationOnce(async () => {
      proof.replace(); throw error;
    });
    const result = await proof.reveal();
    expect(scroll).toHaveBeenCalledTimes(2);
    expect(proof.lookups()).toHaveLength(2);
    expect(result).toBe(proof.lookups()[1].value);
    expect((result as unknown as DomLocator).element).toBe(proof.sections[1]);
    expect(proof.sections[1].classList.contains('is-expanded')).toBe(true);
    expect(proof.sections[1].dataset.filterbarTemporaryDisclosureOperation).toBeUndefined();
    expect(proof.persisted).not.toHaveBeenCalled();
    expect(assertions.attribute).toHaveBeenCalledWith(expect.anything(), 'aria-expanded', 'true', { timeout: 5000 });
    expect(assertions.visible).toHaveBeenLastCalledWith(
      expect.objectContaining({ element: proof.sections[1].querySelector('.animated-disclosure-content-shell') }), { timeout: 5000 },
    );
  },
);

test.each(['Execution context was destroyed', 'disclosure detached during expansion'])(
  'clears the failed and successful attempt markers when expansion throws: %s', async message => {
    const proof = fixture();
    vi.spyOn(proof.original, 'expand').mockImplementationOnce(async () => {
      expect(proof.original.dataset.filterbarTemporaryDisclosureOperation).toBe('true');
      proof.replace(); throw new Error(message);
    });
    const result = await proof.reveal();
    expect(proof.lookups()).toHaveLength(2);
    expect(result).toBe(proof.lookups()[1].value);
    expect(proof.original.dataset.filterbarTemporaryDisclosureOperation).toBeUndefined();
    expect(proof.sections[1].dataset.filterbarTemporaryDisclosureOperation).toBeUndefined();
    expect(proof.sections[1].classList.contains('is-expanded')).toBe(true);
    expect(proof.persisted).not.toHaveBeenCalled();
  },
);

test('surfaces the third detachment unchanged and never attempts a fourth scroll', async () => {
  const proof = fixture();
  const errors = [1, 2, 3].map(attempt => new Error(`Element is not attached (attempt ${attempt})`));
  const scroll = vi.spyOn(DomLocator.prototype, 'scrollIntoViewIfNeeded').mockImplementation(async () => {
    proof.replace(); throw errors[proof.lookups().length - 1];
  });
  await expect(proof.reveal()).rejects.toBe(errors[2]);
  expect(proof.lookups()).toHaveLength(3);
  expect(scroll).toHaveBeenCalledTimes(3);
  expect(proof.sections.every(section => section.dataset.filterbarTemporaryDisclosureOperation === undefined)).toBe(true);
  expect(proof.persisted).not.toHaveBeenCalled();
});

test('clears every marker even when all three expansion attempts detach', async () => {
  const proof = fixture();
  const error = new Error('detached while expanding');
  const failExpansion = (section: typeof proof.original): void => {
    vi.spyOn(section, 'expand').mockImplementation(async () => {
      expect(section.dataset.filterbarTemporaryDisclosureOperation).toBe('true');
      failExpansion(proof.replace()); throw error;
    });
  };
  failExpansion(proof.original);
  await expect(proof.reveal()).rejects.toBe(error);
  expect(proof.lookups()).toHaveLength(3);
  expect(proof.sections.every(section => section.dataset.filterbarTemporaryDisclosureOperation === undefined)).toBe(true);
  expect(proof.persisted).not.toHaveBeenCalled();
});

test.each(['visibility', 'scroll', 'expand'])(
  'surfaces a different %s error unchanged on the first attempt', async step => {
    const proof = fixture();
    const error = new Error('Timeout 5000ms exceeded');
    const fail = () => { throw error; };
    const expand = vi.spyOn(proof.original, 'expand');
    const scroll = vi.spyOn(DomLocator.prototype, 'scrollIntoViewIfNeeded');
    if (step === 'visibility') assertions.visible.mockImplementationOnce(fail);
    if (step === 'scroll') scroll.mockImplementationOnce(fail);
    if (step === 'expand') expand.mockImplementationOnce(async () => {
      expect(proof.original.dataset.filterbarTemporaryDisclosureOperation).toBe('true'); fail();
    });
    await expect(proof.reveal()).rejects.toBe(error);
    expect(proof.lookups()).toHaveLength(1);
    expect(scroll).toHaveBeenCalledTimes(step === 'visibility' ? 0 : 1);
    expect(expand).toHaveBeenCalledTimes(step === 'expand' ? 1 : 0);
    expect(proof.original.dataset.filterbarTemporaryDisclosureOperation).toBeUndefined();
    expect(proof.persisted).not.toHaveBeenCalled();
  },
);

test.each(['header', 'content shell'])('does not retry a failed final %s assertion', async target => {
  const proof = fixture();
  const error = new Error('detached during final assertion');
  if (target === 'header') assertions.attribute.mockImplementationOnce(() => { throw error; });
  else assertions.visible.mockImplementation((locator: DomLocator) => {
    if (locator.element?.classList.contains('animated-disclosure-content-shell')) throw error;
  });
  await expect(proof.reveal()).rejects.toBe(error);
  expect(proof.lookups()).toHaveLength(1);
  expect(proof.original.dataset.filterbarTemporaryDisclosureOperation).toBeUndefined();
});

test('shares the five-second reveal budget across retry steps and preserves final assertion timeouts', async () => {
  const proof = fixture();
  const now = vi.spyOn(Date, 'now').mockReturnValue(1000);
  const evaluate = vi.spyOn(DomLocator.prototype, 'evaluate');
  const scroll = vi.spyOn(DomLocator.prototype, 'scrollIntoViewIfNeeded').mockImplementationOnce(async () => {
    now.mockReturnValue(5999); proof.replace(); throw new Error('Element is not attached');
  });
  await proof.reveal();
  expect(scroll).toHaveBeenNthCalledWith(1, { timeout: 5000 });
  expect(scroll).toHaveBeenNthCalledWith(2, { timeout: 1 });
  expect(assertions.visible).toHaveBeenNthCalledWith(1, expect.anything(), { timeout: 5000 });
  expect(assertions.visible).toHaveBeenNthCalledWith(2, expect.anything(), { timeout: 1 });
  expect(evaluate).toHaveBeenLastCalledWith(expect.any(Function), undefined, { timeout: 1 });
  expect(assertions.attribute).toHaveBeenLastCalledWith(expect.anything(), 'aria-expanded', 'true', { timeout: 5000 });
  expect(assertions.visible).toHaveBeenLastCalledWith(expect.anything(), { timeout: 5000 });
});

test('does not retry detachment after the existing five-second budget is spent', async () => {
  const proof = fixture();
  const now = vi.spyOn(Date, 'now').mockReturnValue(1000);
  const error = new Error('Element is not attached');
  const scroll = vi.spyOn(DomLocator.prototype, 'scrollIntoViewIfNeeded').mockImplementationOnce(async () => {
    now.mockReturnValue(6000); throw error;
  });
  await expect(proof.reveal()).rejects.toBe(error);
  expect(proof.lookups()).toHaveLength(1);
  expect(scroll).toHaveBeenCalledOnce();
});
