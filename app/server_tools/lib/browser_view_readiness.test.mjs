// browser_view_readiness.test.mjs
// Exercises visible rendering readiness without launching an application or browser.
// Bridges jsdom shell/media state and finite Web Animation lifecycle examples.
// Prevents SSE-independent waits from overlooking real rendering work or lazy media.
// @vitest-environment jsdom
/* global document, window, Element */

import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { isVisiblePageReady, waitForVisiblePageReady } from './browser_view_readiness.mjs';

const fontsDescriptor = Object.getOwnPropertyDescriptor(document, 'fonts');
const animationsDescriptor = Object.getOwnPropertyDescriptor(document, 'getAnimations');

beforeEach(() => {
    document.body.innerHTML = '<main><p>Ready rows</p></main>';
    document.body.className = '';
    Object.defineProperty(document, 'fonts', { configurable: true, value: { status: 'loaded' } });
    Object.defineProperty(document, 'getAnimations', { configurable: true, value: vi.fn(() => []) });
    vi.spyOn(Element.prototype, 'getClientRects').mockImplementation(function () {
        return this.closest('[hidden]') ? [] : [{}];
    });
});

afterEach(() => {
    delete window.__filterestShellBoot;
    if (fontsDescriptor) Object.defineProperty(document, 'fonts', fontsDescriptor);
    else delete document.fonts;
    if (animationsDescriptor) Object.defineProperty(document, 'getAnimations', animationsDescriptor);
    else delete document.getAnimations;
    vi.restoreAllMocks();
});

test('waits for shell boot, fonts and visible busy content', () => {
    expect(isVisiblePageReady()).toBe(true);
    window.__filterestShellBoot = { status: () => ({ ready: false }) };
    expect(isVisiblePageReady()).toBe(false);
    window.__filterestShellBoot.status = () => ({ ready: true });
    document.body.classList.add('loading');
    expect(isVisiblePageReady()).toBe(false);
    document.body.classList.remove('loading');
    document.fonts.status = 'loading';
    expect(isVisiblePageReady()).toBe(false);
    document.fonts.status = 'loaded';
    const content = document.querySelector('main');
    content.setAttribute('aria-busy', 'true');
    expect(isVisiblePageReady()).toBe(false);
    content.removeAttribute('aria-busy');
    content.innerHTML = '<div class="loading-indicator-spinner"></div>';
    expect(isVisiblePageReady()).toBe(false);
    content.hidden = true;
    expect(isVisiblePageReady()).toBe(true);
});

test('waits for visible finite transitions, including delayed ones, but ignores infinite decoration', () => {
    const target = document.querySelector('main');
    const transition = { playState: 'running', pending: false,
        effect: { target, getTiming: () => ({ iterations: 1 }) } };
    document.getAnimations.mockReturnValue([transition]);
    expect(isVisiblePageReady()).toBe(false);
    transition.playState = 'finished';
    expect(isVisiblePageReady()).toBe(true);
    transition.playState = 'idle'; transition.pending = true;
    expect(isVisiblePageReady()).toBe(false);
    transition.effect.getTiming = () => ({ iterations: Infinity });
    expect(isVisiblePageReady()).toBe(true);
    transition.effect.getTiming = () => ({ iterations: 1 });
    target.hidden = true;
    expect(isVisiblePageReady()).toBe(true);
});

test('waits for requested images but not an offscreen lazy image', () => {
    const image = document.createElement('img');
    document.querySelector('main').append(image);
    Object.defineProperty(image, 'complete', { configurable: true, value: false });
    expect(isVisiblePageReady()).toBe(false);
    image.loading = 'lazy';
    image.getBoundingClientRect = () => ({ top: 2000, bottom: 2100, left: 0, right: 100 });
    expect(isVisiblePageReady()).toBe(true);
    image.getBoundingClientRect = () => ({ top: 10, bottom: 110, left: 0, right: 100 });
    expect(isVisiblePageReady()).toBe(false);
    Object.defineProperty(image, 'complete', { configurable: true, value: true });
    expect(isVisiblePageReady()).toBe(true);
});

test('polls concrete rendering conditions on animation frames and propagates failure', async () => {
    const waitForFunction = vi.fn(async predicate => expect(predicate()).toBe(true));
    await waitForVisiblePageReady({ waitForFunction }, { timeout: 3000 });
    expect(waitForFunction).toHaveBeenCalledWith(isVisiblePageReady, null, { polling: 'raf', timeout: 3000 });
    waitForFunction.mockRejectedValue(new Error('Visible view never finished loading'));
    await expect(waitForVisiblePageReady({ waitForFunction })).rejects.toThrow('never finished loading');
});
