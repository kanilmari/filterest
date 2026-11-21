// @vitest-environment jsdom
// Exercises the frosted-bars experiment switch: stored choice, root mark, cross-tab sync and the administrator gate.
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import {
    BAR_SURFACE_ATTRIBUTE, BAR_SURFACE_STORAGE_KEY, applyBarSurfaceChoice, initBarSurfaceExperiment,
    mountBarSurfaceSwitch, readBarSurfaceChoice, storeBarSurfaceChoice,
} from './bar_surface_experiment.js';

const root = () => document.documentElement;
const memoryStorage = (initial = {}) => {
    const values = new Map(Object.entries(initial));
    return { getItem: (key) => (values.has(key) ? values.get(key) : null), setItem: (key, value) => values.set(key, String(value)) };
};
const blockedStorage = { getItem() { throw Error('denied'); }, setItem() { throw Error('denied'); } };
const container = () => document.body.appendChild(document.createElement('div'));
const quiet = { translate: () => {} };

beforeEach(() => {
    document.body.replaceChildren();
    root().removeAttribute(BAR_SURFACE_ATTRIBUTE);
    localStorage.clear();
});

describe('stored choice', () => {
    test('reads frosted and solid; anything else inherits the solid site default', () => {
        expect(readBarSurfaceChoice(memoryStorage({ [BAR_SURFACE_STORAGE_KEY]: 'frosted' }))).toBe('frosted');
        expect(readBarSurfaceChoice(memoryStorage({ [BAR_SURFACE_STORAGE_KEY]: 'solid' }))).toBe('solid');
        expect(readBarSurfaceChoice(memoryStorage({ [BAR_SURFACE_STORAGE_KEY]: 'glass; color:red' }))).toBeNull();
        expect(readBarSurfaceChoice(memoryStorage())).toBeNull();
        expect(readBarSurfaceChoice(blockedStorage)).toBeNull();
    });

    test('stores only the two explicit choices and survives blocked storage', () => {
        const storage = memoryStorage();
        expect(storeBarSurfaceChoice('solid', storage)).toBe(true);
        expect(storage.getItem(BAR_SURFACE_STORAGE_KEY)).toBe('solid');
        expect(storeBarSurfaceChoice('glass', storage)).toBe(false);
        expect(storage.getItem(BAR_SURFACE_STORAGE_KEY)).toBe('solid');
        expect(storeBarSurfaceChoice('frosted', blockedStorage)).toBe(false);
    });

    test('marks the root only for frosted', () => {
        applyBarSurfaceChoice('frosted');
        expect(root().getAttribute(BAR_SURFACE_ATTRIBUTE)).toBe('frosted');
        applyBarSurfaceChoice('solid');
        expect(root().hasAttribute(BAR_SURFACE_ATTRIBUTE)).toBe(false);
        applyBarSurfaceChoice('frosted');
        applyBarSurfaceChoice(null);
        expect(root().hasAttribute(BAR_SURFACE_ATTRIBUTE)).toBe(false);
    });

    test('init applies the stored choice and follows another tab through the storage event', () => {
        localStorage.setItem(BAR_SURFACE_STORAGE_KEY, 'frosted');
        const followBackdrop = vi.fn();
        initBarSurfaceExperiment({ storage: localStorage, followBackdrop });
        expect(root().getAttribute(BAR_SURFACE_ATTRIBUTE)).toBe('frosted');
        localStorage.setItem(BAR_SURFACE_STORAGE_KEY, 'solid');
        window.dispatchEvent(new StorageEvent('storage', { key: BAR_SURFACE_STORAGE_KEY }));
        expect(root().hasAttribute(BAR_SURFACE_ATTRIBUTE)).toBe(false);
        localStorage.setItem(BAR_SURFACE_STORAGE_KEY, 'frosted');
        window.dispatchEvent(new StorageEvent('storage', { key: 'unrelated_key' }));
        expect(root().hasAttribute(BAR_SURFACE_ATTRIBUTE)).toBe(false);
        window.dispatchEvent(new StorageEvent('storage', { key: null }));
        expect(root().getAttribute(BAR_SURFACE_ATTRIBUTE)).toBe('frosted');
        // The wide-screen picture layer runs only while the look is frosted.
        expect(followBackdrop.mock.calls).toEqual([[true], [false], [true]]);
    });
});

describe('administrator switch', () => {
    test('stays hidden when the server does not confirm an administrator, even for a route-grant holder', async () => {
        // A signed-in non-administrator can hold the menu permission and the route grant;
        // only the protected request's answer decides.
        const host = container();
        const verifyAdministrator = vi.fn(async () => { throw Object.assign(Error('Forbidden'), { status: 403 }); });
        expect(await mountBarSurfaceSwitch(host, { verifyAdministrator, ...quiet })).toBeNull();
        expect(verifyAdministrator).toHaveBeenCalledTimes(1);
        expect(host.querySelector('[data-testid="bar-surface-experiment-switch"]')).toBeNull();
    });

    test('appears after a confirmed administrator request, labelled through a language key', async () => {
        const host = container();
        host.appendChild(document.createElement('div')).id = 'navContainer';
        const translate = vi.fn();
        const row = await mountBarSurfaceSwitch(host, { verifyAdministrator: async () => ({}), translate });
        expect(host.firstElementChild).toBe(row);
        const label = row.querySelector('[data-lang-key="bar_surface_frosted_experiment"]');
        expect(label.textContent).toBe('Frosted bars (experiment)');
        expect(row.querySelector('input').getAttribute('role')).toBe('switch');
        await Promise.resolve(); await Promise.resolve();
        expect(translate).toHaveBeenCalled();
    });

    test('turning it on and off stores an explicit choice, marks the root and follows the picture layer', async () => {
        const storage = memoryStorage();
        const followBackdrop = vi.fn();
        const row = await mountBarSurfaceSwitch(container(), { verifyAdministrator: async () => ({}), storage, followBackdrop, ...quiet });
        const input = row.querySelector('input');
        expect(input.checked).toBe(false);
        input.click();
        expect(storage.getItem(BAR_SURFACE_STORAGE_KEY)).toBe('frosted');
        expect(root().getAttribute(BAR_SURFACE_ATTRIBUTE)).toBe('frosted');
        input.click();
        expect(storage.getItem(BAR_SURFACE_STORAGE_KEY)).toBe('solid');
        expect(root().hasAttribute(BAR_SURFACE_ATTRIBUTE)).toBe(false);
        expect(followBackdrop.mock.calls).toEqual([[true], [false]]);
    });

    test('mounts once, and not into a container removed while the request was pending', async () => {
        const host = container();
        const first = await mountBarSurfaceSwitch(host, { verifyAdministrator: async () => ({}), ...quiet });
        expect(await mountBarSurfaceSwitch(host, { verifyAdministrator: async () => ({}), ...quiet })).toBe(first);
        expect(host.querySelectorAll('.bar-surface-switch-row')).toHaveLength(1);
        const gone = container();
        let release;
        const pending = mountBarSurfaceSwitch(gone, { verifyAdministrator: () => new Promise((yes) => { release = yes; }), ...quiet });
        gone.remove();
        release({});
        expect(await pending).toBeNull();
    });
});

describe('page wiring', () => {
    const html = readFileSync('frontend/index.html', 'utf8');
    const bootstrap = html.match(/<script id="site-presentation-bootstrap"[^>]*>([\s\S]*?)<\/script>/)[1];

    test('the first-paint script marks the root from the same key before the stylesheet', () => {
        expect(html.indexOf('site-presentation-bootstrap')).toBeLessThan(html.indexOf('id="imports-css"'));
        localStorage.setItem(BAR_SURFACE_STORAGE_KEY, 'frosted');
        window.eval(bootstrap);
        expect(root().getAttribute(BAR_SURFACE_ATTRIBUTE)).toBe('frosted');
        root().removeAttribute(BAR_SURFACE_ATTRIBUTE);
        localStorage.setItem(BAR_SURFACE_STORAGE_KEY, 'solid');
        window.eval(bootstrap);
        expect(root().hasAttribute(BAR_SURFACE_ATTRIBUTE)).toBe(false);
    });

    test('the admin request is quiet, so a refused visitor sees no error or sign-in redirect', () => {
        const source = readFileSync('frontend/core_components/bar_surface/bar_surface_experiment.js', 'utf8');
        expect(source).toContain('fetchAdminUIFeatureFlags({ suppressErrorToast: true, suppressAuthRedirect: true })');
        expect(readFileSync('frontend/core_components/auth/post_auth_bootstrap.js', 'utf8'))
            .toContain('mountBarSurfaceSwitch(adminToolsContent)');
    });
});
