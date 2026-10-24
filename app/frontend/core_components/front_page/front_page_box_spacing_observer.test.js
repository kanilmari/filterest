// front_page_box_spacing_observer.test.js
// Proves box-only compensation across text resizing, anchor previews and teardown.
// Browser geometry is covered by G15; these controlled rectangles test observer ownership.
import { afterEach, expect, test, vi } from 'vitest';
import { mountHomeBoxSpacing } from './front_page_box_spacing_observer.js';

afterEach(() => { vi.unstubAllGlobals(); document.body.replaceChildren(); });

test('only boxes consume the measured tail; copy/viewport changes and anchor-only previews refresh it', async () => {
    let onResize;
    const observe = vi.fn(), disconnect = vi.fn();
    vi.stubGlobal('ResizeObserver', class {
        constructor(callback) { onResize = callback; }
        observe = observe;
        disconnect = disconnect;
    });
    const page = document.createElement('div');
    page.innerHTML = '<div data-anchor="center-left"><header data-alignment="start"></header></div>'
        + '<div class="front-page-blocks"></div>';
    document.body.append(page);
    const stage = page.firstElementChild, hero = stage.firstElementChild;
    let stageBottom = 900, heroBottom = 550;
    stage.getBoundingClientRect = () => ({ bottom: stageBottom });
    hero.getBoundingClientRect = () => ({ bottom: heroBottom });
    const stop = mountHomeBoxSpacing(page, stage, hero);
    const tail = () => page.style.getPropertyValue('--home-hero-trailing-space');
    expect(tail()).toBe('350px');
    expect(observe.mock.calls.map(([element]) => element)).toEqual([stage, hero]);
    expect(stage.dataset.anchor).toBe('center-left');
    expect(hero.dataset.alignment).toBe('start');
    expect(stage.getAttribute('style')).toBeNull();
    expect(hero.getAttribute('style')).toBeNull();
    // Long text expands the stage; only its bottom inset remains to trim.
    stageBottom = 1400; heroBottom = 1384; onResize();
    expect(tail()).toBe('16px');
    stageBottom = 900; heroBottom = 116;
    stage.dataset.anchor = 'top-left';
    await Promise.resolve();
    expect(tail()).toBe('784px');
    // Whole-page scrolling moves both rectangles equally, preserving the offset.
    stageBottom -= 200; heroBottom -= 200; onResize();
    expect(tail()).toBe('784px');
    stop();
    expect(disconnect).toHaveBeenCalledOnce();
    expect(tail()).toBe('');
    stage.dataset.anchor = 'bottom-left';
    await Promise.resolve();
    expect(tail()).toBe('');
});

test('Home without boxes installs no observers or inline geometry', () => {
    const observer = vi.fn();
    vi.stubGlobal('ResizeObserver', observer);
    const page = document.createElement('div');
    const stop = mountHomeBoxSpacing(page, null, null);
    expect(observer).not.toHaveBeenCalled();
    expect(page.hasAttribute('style')).toBe(false);
    stop();
});
