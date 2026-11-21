// @vitest-environment jsdom
// Exercises the frosted bars' wide-screen picture layer: reading the displayed view's picture,
// publishing it on the shell, and following view changes only while the look is frosted.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { BAR_BACKDROP_ATTRIBUTE, followBarBackdrop, syncBarBackdrop } from './bar_surface_backdrop.js';
import { resolveViewPresentationBackdrop } from '../navigation/main_tabs/view_presentation_media_resolver.js';

const picture = { image: 'url("https://example.test/a.png")', position: '50% 0%', opacity: '0.2', washColor: 'transparent', wash: '0' };
const PROPERTIES = ['--bar-backdrop-image', '--bar-backdrop-position', '--bar-backdrop-opacity', '--bar-backdrop-wash-color', '--bar-backdrop-wash'];

function shell() {
    const content = document.body.appendChild(document.createElement('div'));
    content.className = 'body_content';
    return content;
}

function datasetView(hidden = false) {
    const view = document.body.appendChild(document.createElement('div'));
    view.className = hidden ? 'content_div hidden' : 'content_div';
    const area = view.appendChild(document.createElement('div'));
    area.className = 'tab-content-area tab-content-area--has-dataset-background';
    return area;
}

// jsdom does not compute pseudo-elements; the view's own CSS decides these values in a browser.
const layers = (values) => (element, pseudo) => ({ ...getComputedStyle(element), ...values[pseudo] });

beforeEach(() => document.body.replaceChildren());
afterEach(() => { followBarBackdrop(false); vi.unstubAllGlobals(); });

describe('reading the displayed picture', () => {
    test('a dataset view gives its background layer\'s picture, position and strength', () => {
        datasetView();
        const computed = layers({ '::before': { backgroundImage: picture.image, backgroundPosition: '50% 0%', opacity: '0.2' } });
        expect(resolveViewPresentationBackdrop(computed)).toEqual(picture);
    });

    test('a hidden dataset view, a missing picture or a zero strength gives nothing', () => {
        datasetView(true);
        const visible = layers({ '::before': { backgroundImage: picture.image, opacity: '0.2' } });
        expect(resolveViewPresentationBackdrop(visible)).toBeNull();
        document.body.replaceChildren();
        datasetView();
        expect(resolveViewPresentationBackdrop(layers({ '::before': { backgroundImage: 'none', opacity: '0.2' } }))).toBeNull();
        expect(resolveViewPresentationBackdrop(layers({ '::before': { backgroundImage: picture.image, opacity: '0' } }))).toBeNull();
    });

    test('Home gives its image with the theme\'s strength and wash; a Home video gives nothing', () => {
        const home = document.body.appendChild(document.createElement('div'));
        home.id = 'front_page_container';
        const media = home.appendChild(document.createElement('div'));
        media.className = 'front-page-background';
        media.style.setProperty('--front-page-background-2160', picture.image);
        const computed = layers({
            '::before': { backgroundImage: picture.image, backgroundPosition: '40% 60%', opacity: '0.7' },
            '::after': { backgroundColor: 'rgb(20, 20, 30)', opacity: '0.25' },
        });
        expect(resolveViewPresentationBackdrop(computed)).toEqual({
            image: picture.image, position: '40% 60%', opacity: '0.7', washColor: 'rgb(20, 20, 30)', wash: '0.25' });
        media.appendChild(document.createElement('video')).setAttribute('src', '/home.webm');
        expect(resolveViewPresentationBackdrop(computed)).toBeNull();
    });
});

describe('publishing on the shell', () => {
    test('a picture sets the layer\'s values and marks the shell; nothing clears both', () => {
        const target = shell();
        expect(syncBarBackdrop(target, () => picture)).toBe(picture);
        expect(target.hasAttribute(BAR_BACKDROP_ATTRIBUTE)).toBe(true);
        expect(target.style.getPropertyValue('--bar-backdrop-image')).toBe(picture.image);
        expect(target.style.getPropertyValue('--bar-backdrop-opacity')).toBe('0.2');
        syncBarBackdrop(target, () => null);
        expect(target.hasAttribute(BAR_BACKDROP_ATTRIBUTE)).toBe(false);
        for (const property of PROPERTIES) expect(target.style.getPropertyValue(property)).toBe('');
    });

    test('follows a view change while frosted, and turning it off removes the layer', async () => {
        vi.stubGlobal('requestAnimationFrame', (callback) => setTimeout(callback, 0));
        vi.stubGlobal('cancelAnimationFrame', (id) => clearTimeout(id));
        const target = shell();
        const area = datasetView();
        const resolve = vi.fn(() => (area.closest('.content_div').classList.contains('hidden') ? null : picture));
        followBarBackdrop(true, resolve);
        await vi.waitFor(() => expect(target.hasAttribute(BAR_BACKDROP_ATTRIBUTE)).toBe(true));
        area.closest('.content_div').classList.add('hidden');
        await vi.waitFor(() => expect(target.hasAttribute(BAR_BACKDROP_ATTRIBUTE)).toBe(false));
        area.closest('.content_div').classList.remove('hidden');
        await vi.waitFor(() => expect(target.hasAttribute(BAR_BACKDROP_ATTRIBUTE)).toBe(true));
        followBarBackdrop(false);
        expect(target.hasAttribute(BAR_BACKDROP_ATTRIBUTE)).toBe(false);
        const calls = resolve.mock.calls.length;
        area.closest('.content_div').classList.add('hidden');
        await new Promise((done) => setTimeout(done, 5));
        expect(resolve.mock.calls.length).toBe(calls);
    });

    test('a resize reads the picture again while frosted, so Home\'s wide image variant replaces the narrow one', async () => {
        vi.stubGlobal('requestAnimationFrame', (callback) => setTimeout(callback, 0));
        vi.stubGlobal('cancelAnimationFrame', (id) => clearTimeout(id));
        const target = shell();
        let variant = '1000';
        followBarBackdrop(true, () => ({ ...picture, image: `url("/front_page/${variant}/a.png")` }));
        await vi.waitFor(() => expect(target.style.getPropertyValue('--bar-backdrop-image')).toContain('/1000/'));
        variant = '2160';
        window.dispatchEvent(new Event('resize'));
        await vi.waitFor(() => expect(target.style.getPropertyValue('--bar-backdrop-image')).toContain('/2160/'));
        followBarBackdrop(false);
        variant = '1000';
        window.dispatchEvent(new Event('resize'));
        await new Promise((done) => setTimeout(done, 5));
        expect(target.hasAttribute(BAR_BACKDROP_ATTRIBUTE)).toBe(false);
    });

    test('its own writes on the shell do not wake it again', async () => {
        vi.stubGlobal('requestAnimationFrame', (callback) => setTimeout(callback, 0));
        vi.stubGlobal('cancelAnimationFrame', (id) => clearTimeout(id));
        shell();
        const resolve = vi.fn(() => picture);
        followBarBackdrop(true, resolve);
        await vi.waitFor(() => expect(resolve).toHaveBeenCalledTimes(1));
        await new Promise((done) => setTimeout(done, 10));
        expect(resolve).toHaveBeenCalledTimes(1);
    });
});
