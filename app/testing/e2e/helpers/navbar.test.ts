// navbar.test.ts
// Exercises the shared navbar helper on Home and dataset DOM fixtures.
// Models visibility events and actionability without a live application or database.
// Guards Home ownership and rejects inaccessible toggles without relaxing datasets.
import { afterEach, expect, test, vi } from 'vitest';
import type { Page } from '@playwright/test';
import { ensureNavbarVisible } from './navbar';

vi.mock('@playwright/test', () => ({
  expect: (locator: DomLocator) => ({
    toHaveCount: async (count: number) => expect(await locator.count()).toBe(count),
    toBeVisible: async () => expect(locator.element().hidden).toBe(false),
    toBeEnabled: async () => expect(locator.element().matches(':disabled')).toBe(false),
    // jsdom has no layout; native specs provide the actual viewport proof.
    toBeInViewport: async () => expect(locator.element().dataset.offscreen).not.toBe('true'),
    toHaveAttribute: async (name: string, value: string) =>
      expect(locator.element().getAttribute(name)).toBe(value),
    toHaveClass: async (pattern: RegExp) => expect(locator.element().className).toMatch(pattern),
    not: {
      toHaveClass: async (pattern: RegExp) => expect(locator.element().className).not.toMatch(pattern),
    },
  }),
}));

const clicks: boolean[] = [];
class DomLocator {
  constructor(private readonly resolve: () => HTMLElement[]) {}
  element() {
    const element = this.resolve()[0];
    if (!element) throw new Error('No matching navbar control.');
    return element;
  }
  first() { return new DomLocator(() => this.resolve().slice(0, 1)); }
  async count() { return this.resolve().length; }
  async getAttribute(name: string) { return this.element().getAttribute(name); }
  async click(options?: { trial?: boolean }) {
    const button = this.element();
    expect(button.hidden).toBe(false);
    expect(button.matches(':disabled')).toBe(false);
    expect(button.closest('[inert]')).toBeNull();
    expect(button.dataset.obstructed).not.toBe('true');
    clicks.push(options?.trial === true);
    if (!options?.trial) button.click();
  }
}

afterEach(() => { document.body.replaceChildren(); clicks.length = 0; vi.restoreAllMocks(); });

function mountNavbar(home: boolean, collapsed = false) {
  document.body.innerHTML = `
    <nav id="navbar" class="${collapsed ? 'collapsed' : ''}"></nav>
    <button id="showMenuButton"></button>`;
  const navbar = document.getElementById('navbar')!;
  const button = document.getElementById('showMenuButton') as HTMLButtonElement;
  if (home) {
    const row = document.createElement('div'); row.className = 'front-page-top-row';
    row.append(button); document.body.append(row);
  }
  const sync = () => {
    const open = !navbar.classList.contains('collapsed');
    button.hidden = !home && open;
    button.classList.toggle('menu-toggle-visible', home || !open);
    button.setAttribute('aria-hidden', String(button.hidden));
    button.setAttribute('aria-expanded', String(open));
    button.setAttribute('tabindex', button.hidden ? '-1' : '0');
  };
  sync();
  button.addEventListener('click', () => {
    navbar.classList.toggle('collapsed'); sync();
    window.dispatchEvent(new CustomEvent('navbar-visibility-changed', {
      detail: { isVisible: !navbar.classList.contains('collapsed') },
    }));
  });
  const url = vi.fn(() => home ? '/dataset-address' : '/');
  const page = {
    url,
    locator: (selector: string) => new DomLocator(() =>
      [...document.querySelectorAll<HTMLElement>(selector.replaceAll(':visible', ''))]
        .filter(element => !selector.includes(':visible') || !element.hidden)),
    evaluate: async <T, A>(operation: (argument: A) => T, argument: A) => operation(argument),
  } as unknown as Page;
  return { page, navbar, button, url };
}

test.each([false, true])('Home keeps an actionable expanded borrowed toggle; initially collapsed=%s', async collapsed => {
  const { page, navbar, button, url } = mountNavbar(true, collapsed);
  await ensureNavbarVisible(page);
  expect(navbar.classList.contains('collapsed')).toBe(false);
  expect(button.getAttribute('aria-expanded')).toBe('true');
  expect(clicks).toEqual(collapsed ? [false, true] : [true]);
  expect(url).not.toHaveBeenCalled();
});

test.each([false, true])('datasets retain the hidden source contract; initially collapsed=%s', async collapsed => {
  const { page, button, url } = mountNavbar(false, collapsed);
  await ensureNavbarVisible(page);
  expect(button.getAttribute('aria-hidden')).toBe('true');
  expect(button.classList.contains('menu-toggle-visible')).toBe(false);
  expect(clicks).toEqual(collapsed ? [false] : []);
  expect(url).not.toHaveBeenCalled();
});

test.each(['unexpanded', 'hidden', 'disabled', 'unfocusable', 'obstructed', 'inert', 'wrong-owner'])
('Home rejects a %s borrowed toggle', async defect => {
  const { page, button } = mountNavbar(true);
  if (defect === 'unexpanded') button.setAttribute('aria-expanded', 'false');
  if (defect === 'hidden') button.hidden = true;
  if (defect === 'disabled') button.disabled = true;
  if (defect === 'unfocusable') button.setAttribute('tabindex', '-1');
  if (defect === 'obstructed') button.dataset.obstructed = 'true';
  if (defect === 'inert') button.parentElement!.setAttribute('inert', '');
  if (defect === 'wrong-owner') document.body.append(button);
  await expect(ensureNavbarVisible(page)).rejects.toThrow();
});

test.each(['aria-hidden', 'menu-toggle-visible'])('datasets still reject an invalid %s source state', async defect => {
  const { page, button } = mountNavbar(false);
  if (defect === 'aria-hidden') button.setAttribute('aria-hidden', 'false');
  else button.classList.add('menu-toggle-visible');
  await expect(ensureNavbarVisible(page)).rejects.toThrow();
});

test.each([false, true])('rejects an offscreen open navbar on Home=%s', async home => {
  const { page, navbar } = mountNavbar(home);
  navbar.dataset.offscreen = 'true';
  await expect(ensureNavbarVisible(page)).rejects.toThrow();
});

test('a detached Home row cannot select the Home contract on a dataset', async () => {
  const { page, button } = mountNavbar(false);
  const row = document.createElement('div'); row.className = 'front-page-top-row';
  row.append(document.createElement('button'));
  await ensureNavbarVisible(page);
  expect(button.getAttribute('aria-hidden')).toBe('true');
  expect(clicks).toEqual([]);
});
